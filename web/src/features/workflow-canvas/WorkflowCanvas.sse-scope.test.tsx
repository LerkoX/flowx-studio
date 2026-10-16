// @ts-nocheck — 回归测试：SSE 是**全局流**（/api/v1/events 推所有流水线的执行事件），
// 画布必须只处理「本画布关心的执行」的事件。
//
// 事故：选中运行中的执行（回放态）后过一会自己取消了选中——别的流水线开始运行
// （execution.started）被无差别处理 → selectExecution(别人的 id) → 页面的
// 「选中执行不属于本流水线 ⇒ 退出回放态」effect 立即生效。同理别人完成时的
// stopExecution() 会把本端运行态一起清掉；别人的 node_start/node_complete/
// execution.log 因节点 id 跨流水线重名会点亮本画布节点、污染日志面板。
//
// 圈定规则（用户确认的语义）：只有「回放态选中的」或「本页点运行发起的」那个执行
// 在画布上有特效；**编辑态必须完全干净**——他端（CLI/另一台设备）发起的运行
// 不点亮节点、不出预览帧、不进日志面板。本页点运行后的自动进入回放态由页面
// handleRun 依接口返回的 execution_id 本地完成（用例在 WorkflowCanvasPage.run-button.test.tsx）。
import { describe, it, expect, vi, beforeAll } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

const esInstances = []
class MockEventSource {
  constructor(url) {
    this.url = url
    this.listeners = {}
    this.onmessage = null
    this.onerror = null
    esInstances.push(this)
  }
  addEventListener(type, fn) {
    ;(this.listeners[type] ||= []).push(fn)
  }
  emit(type, dataObj) {
    const event = { type, data: JSON.stringify(dataObj) }
    this.onmessage?.(event)
    ;(this.listeners[type] || []).forEach((fn) => fn(event))
  }
  close() {}
}

const TEMPLATE_YAML = `Name: demo
Graph: |
  stateDiagram-v2
    [*] --> Encode
    Encode --> SaveImage
    SaveImage --> [*]
Nodes:
  Encode:
    config:
      nodeRef: clip-text-encode
  SaveImage:
    config:
      nodeRef: save-image
`

const WF_ID = '58'
const EXEC = {
  id: 201,
  workflow_id: 58,
  status: 'running',
  trigger: 'manual',
  started_at: '2026-10-11T05:46:43Z',
}

vi.mock('@/services/workflowService', () => ({
  updateWorkflow: vi.fn(async () => ({ code: 200 })),
  // 媒体产物清单（节点预览/输入原图恢复）：本用例不涉及，返回空清单
  getExecutionMedia: vi.fn(async () => ({ code: 200, data: { media: [] } })),
  getWorkflowExecutors: vi.fn(async () => ({ code: 200, data: { source: 'workflow', executors: {}, nodes: {} } })),
  getWorkflow: vi.fn(async () => ({ code: 200, data: null })),
  getExecutions: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
  getExecution: vi.fn(async () => ({ code: 200, data: EXEC })),
  getExecutionYaml: vi.fn(async () => ({ code: 200, data: { hasSnapshot: true, yaml: TEMPLATE_YAML } })),
  getExecutionNodes: vi.fn(async () => ({
    code: 200,
    data: [{ id: 1, execution_id: 201, node_id: 'Encode', status: 'success', completed_at: '2026-10-11T05:46:50Z' }],
  })),
  getExecutionLogs: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
}))
vi.mock('@/services/nodeService', () => ({
  getNodes: vi.fn(async () => ({ code: 200, data: { items: [] } })),
  resolveNodes: vi.fn(async (refs) => ({
    code: 200,
    data: { items: Object.fromEntries(refs.map((r) => [r, null])) },
  })),
}))
vi.mock('@/utils/mermaidParser', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    parseWorkflowGraph: vi.fn(async (yamlConfig) => {
      const ids = [...yamlConfig.matchAll(/^  (\w+):$/gm)].map((m) => m[1])
      const nodes = [
        { id: '__start__', label: 'start' },
        ...ids.map((id) => ({ id, label: id })),
        { id: '__end__', label: 'end' },
      ]
      const edges = []
      for (let i = 0; i < nodes.length - 1; i++) edges.push({ source: nodes[i].id, target: nodes[i + 1].id })
      return { nodes, edges }
    }),
  }
})

import '@/i18n'
import WorkflowCanvas from '@/features/workflow-canvas/WorkflowCanvas'
import { selectExecutionAndSync } from '@/features/workflow-canvas/executionSelection'
import { getExecutionLogs } from '@/services/workflowService'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useExecutionStore } from '@/stores/executionStore'

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.EventSource = MockEventSource
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
})

async function settle(ms) {
  const rounds = Math.max(1, Math.ceil(ms / 200))
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
  }
}

async function mountCanvas() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(WorkflowCanvas))
  })
  await settle(600)
  return { container, root }
}

// 每个用例前把 store 与画布重置到「编辑态 + 本流水线」
function resetState() {
  useWorkflowStore.getState().setCurrentWorkflow({
    id: WF_ID,
    name: 'demo',
    yamlConfig: TEMPLATE_YAML,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  useExecutionStore.setState({
    isExecuting: false,
    runningExecutionId: null,
    selectedExecutionId: null,
    selectedExecution: null,
    selectedExecutionYaml: null,
    executionLog: [],
    logsTotal: 0,
    executions: [],
  })
  useWorkflowStore.getState().setNodeStatuses({})
  useWorkflowStore.getState().resetNodeRuntimeData()
}

describe('SSE 事件按流水线/执行圈定（全局流不得改写本画布）', () => {
  it('别的流水线开始运行：不得抢走本端回放态选中的执行', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(400)
    expect(useExecutionStore.getState().selectedExecutionId).toBe('201')

    // 别的流水线（wf 777）开始运行（用户场景：13:49 的 wf123 execution 611）
    await act(async () => {
      es.emit('execution.started', { execution_id: 999, workflow_id: 777, status: 'running' })
    })
    await settle(400)

    expect(
      useExecutionStore.getState().selectedExecutionId,
      '别的流水线的 execution.started 不得改写选中执行',
    ).toBe('201')
    expect(useExecutionStore.getState().isExecuting, '不得把本端置成运行中').toBe(false)
    expect(useExecutionStore.getState().runningExecutionId).toBeNull()

    await act(async () => root.unmount())
  }, 20000)

  it('别的流水线完成：不得清掉本端运行态与选中执行', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    // 本端正在运行（选中 = 运行中）
    await act(async () => {
      useExecutionStore.getState().startExecution('201')
      await selectExecutionAndSync('201')
    })
    await settle(400)

    await act(async () => {
      es.emit('execution.completed', { execution_id: 999, workflow_id: 777, status: 'success' })
      // 别的流水线的收尾事件（underscore 版）同样不得停掉本端运行态
      es.emit('execution_complete', { execution_id: 999, status: 'SUCCESS' })
    })
    await settle(600)

    expect(useExecutionStore.getState().isExecuting, '本端运行态不该被别人的收尾清掉').toBe(true)
    expect(useExecutionStore.getState().runningExecutionId).toBe('201')
    expect(useExecutionStore.getState().selectedExecutionId).toBe('201')

    await act(async () => root.unmount())
  }, 20000)

  it('别的流水线的节点事件与日志：不得点亮本画布、不得进日志面板', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(400)
    const before = useWorkflowStore.getState().nodeStatuses

    await act(async () => {
      // 节点 id 跨流水线重名是常态（Encode/SaveImage/Save/MaskPaint…）
      es.emit('node_start', { execution_id: 999, node_id: 'Encode' })
      es.emit('node_complete', { execution_id: 999, node_id: 'Encode', status: 'success', outputs: { x: '1' } })
      es.emit('execution.log', { execution_id: 999, node_id: 'Encode', level: 'INFO', message: '别的流水线的日志' })
    })
    await settle(600)

    expect(
      useWorkflowStore.getState().nodeStatuses,
      '别的执行的 node 事件不得改写本画布节点状态',
    ).toEqual(before)
    expect(
      useExecutionStore.getState().executionLog.map((l) => l.message),
      '别的执行的日志不得进本执行的日志面板',
    ).not.toContain('别的流水线的日志')

    await act(async () => root.unmount())
  }, 20000)

  it('编辑态：他端（CLI）发起本流水线的运行也不得在画布上留下任何特效', async () => {
    resetState() // 编辑态：无选中、无本端运行
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    await act(async () => {
      // CLI 发起的本流水线运行（exec 301 / wf 58）：节点事件带 workflow_id
      es.emit('node_start', { execution_id: 301, workflow_id: Number(WF_ID), node_id: 'Encode' })
      es.emit('node_complete', {
        execution_id: 301,
        workflow_id: Number(WF_ID),
        node_id: 'SaveImage',
        status: 'success',
        outputs: { file_path: '/tmp/exec-301.png' },
      })
      es.emit('node_preview', {
        execution_id: 301,
        workflow_id: Number(WF_ID),
        node_id: 'Encode',
        progress: 0.5,
      })
      es.emit('execution.log', {
        execution_id: 301,
        workflow_id: Number(WF_ID),
        node_id: 'Encode',
        level: 'INFO',
        message: '他端发起的本流水线日志',
      })
    })
    await settle(600)

    expect(
      useWorkflowStore.getState().nodeStatuses,
      '编辑态下他端发起的运行不得点亮节点（要看效果就选中它进回放态）',
    ).toEqual({})
    expect(
      useWorkflowStore.getState().nodeRuntimeData,
      '也不得挂预览帧',
    ).toEqual({})
    expect(
      useExecutionStore.getState().executionLog.map((l) => l.message),
      '也不得进日志面板',
    ).not.toContain('他端发起的本流水线日志')
    expect(
      useExecutionStore.getState().selectedExecutionId,
      '更不得把画布拽进那个执行的回放态',
    ).toBeNull()

    await act(async () => root.unmount())
  }, 20000)

  it('编辑态：别的流水线的运行仍不得点亮本画布（同一条规则的反面）', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]
    const before = useWorkflowStore.getState().nodeStatuses

    await act(async () => {
      es.emit('node_start', { execution_id: 999, workflow_id: 777, node_id: 'Encode' })
      es.emit('node_preview', { execution_id: 999, workflow_id: 777, node_id: 'Encode', progress: 0.5 })
      es.emit('execution.log', { execution_id: 999, workflow_id: 777, node_id: 'Encode', level: 'INFO', message: '别的流水线的日志' })
    })
    await settle(600)

    expect(useWorkflowStore.getState().nodeStatuses).toEqual(before)
    expect(useWorkflowStore.getState().nodeRuntimeData).toEqual({})
    expect(
      useExecutionStore.getState().executionLog.map((l) => l.message),
    ).not.toContain('别的流水线的日志')

    await act(async () => root.unmount())
  }, 20000)

  it('回放态：本流水线另一条执行（他端起的）也不得改写正在看的执行', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(400)
    const before = useWorkflowStore.getState().nodeStatuses

    await act(async () => {
      // 同流水线、但不是正在回放的 201：画布显示的是 201 的状态，不能被 301 覆盖
      es.emit('node_start', { execution_id: 301, workflow_id: Number(WF_ID), node_id: 'SaveImage' })
    })
    await settle(600)

    expect(
      useWorkflowStore.getState().nodeStatuses,
      '回放态只认被选中的那个执行',
    ).toEqual(before)

    await act(async () => root.unmount())
  }, 20000)

  it('回放态/本页运行中的事件仍按原语义处理（回归保护）', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    // execution.started 本身不再改选中态：本端运行由页面本地选中，他端运行不该被拽进回放态
    await act(async () => {
      es.emit('execution.started', { execution_id: 202, workflow_id: Number(WF_ID), status: 'running' })
    })
    await settle(300)
    expect(
      useExecutionStore.getState().selectedExecutionId,
      'execution.started 事件本身不得自动选中（无论哪条流水线）',
    ).toBeNull()

    // 本页发起运行（页面本地选中）后，该执行的事件照常生效
    await act(async () => {
      useExecutionStore.getState().startExecution('202')
      await selectExecutionAndSync('202')
    })
    await settle(300)
    expect(useExecutionStore.getState().selectedExecutionId).toBe('202')

    // 本流水线自己的节点事件与日志照常生效
    await act(async () => {
      es.emit('node_start', { execution_id: 202, node_id: 'Encode' })
      es.emit('execution.log', { execution_id: 202, node_id: 'Encode', level: 'INFO', message: '本流水线的日志' })
    })
    await settle(600)
    expect(useWorkflowStore.getState().nodeStatuses.Encode).toBe('running')
    expect(
      useExecutionStore.getState().executionLog.map((l) => l.message),
      '本执行的日志应正常进面板',
    ).toContain('本流水线的日志')

    await act(async () => root.unmount())
  }, 20000)

  it('运行中取消选中：后续节点事件/预览/日志不再触碰画布（零痕迹），停跑仍正常', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    // 本端发起运行并自动选中（= 用户点运行后的状态）
    await act(async () => {
      useExecutionStore.getState().startExecution('201')
      await selectExecutionAndSync('201')
    })
    await settle(400)
    await act(async () => {
      es.emit('node_start', { execution_id: 201, node_id: 'Encode' })
    })
    await settle(400)
    expect(useWorkflowStore.getState().nodeStatuses.Encode, '选中时运行特效正常').toBe('running')

    // 用户取消选中：画布着色与运行时数据被清空
    await act(async () => {
      await selectExecutionAndSync(null)
    })
    await settle(400)
    expect(useExecutionStore.getState().selectedExecutionId).toBeNull()
    expect(useWorkflowStore.getState().nodeStatuses).toEqual({})

    // 该执行后续的事件：一律不得再出现在未选中的画布上
    await act(async () => {
      es.emit('node_start', { execution_id: 201, node_id: 'SaveImage' })
      es.emit('node_complete', {
        execution_id: 201,
        node_id: 'Encode',
        status: 'success',
        outputs: { file_path: '/tmp/exec-201.png' },
      })
      es.emit('node_preview', { execution_id: 201, node_id: 'SaveImage', progress: 0.5 })
      es.emit('execution.log', { execution_id: 201, node_id: 'Encode', level: 'INFO', message: '取消选中后的日志' })
    })
    await settle(600)

    expect(
      useWorkflowStore.getState().nodeStatuses,
      '取消选中后运行中的执行不得再点亮画布',
    ).toEqual({})
    expect(
      useWorkflowStore.getState().nodeRuntimeData,
      '取消选中后不得挂输出/预览帧',
    ).toEqual({})
    expect(
      useExecutionStore.getState().executionLog.map((l) => l.message),
      '取消选中后日志不得进面板',
    ).not.toContain('取消选中后的日志')

    // 生命周期不受「零痕迹」约束：执行结束仍须正常停跑（否则运行按钮永远禁用）
    await act(async () => {
      es.emit('execution_complete', { execution_id: 201, status: 'SUCCESS' })
    })
    await settle(400)
    expect(useExecutionStore.getState().isExecuting, '执行结束后运行态应复位').toBe(false)
    expect(useExecutionStore.getState().runningExecutionId).toBeNull()
    expect(useExecutionStore.getState().selectedExecutionId, '不得被拽进回放态').toBeNull()

    await act(async () => root.unmount())
  }, 20000)

  it('运行中取消选中：execution.completed 不得强制重新选中该执行', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    await act(async () => {
      useExecutionStore.getState().startExecution('201')
      await selectExecutionAndSync('201')
      await selectExecutionAndSync(null)
    })
    await settle(400)

    await act(async () => {
      es.emit('execution.completed', { execution_id: 201, status: 'success' })
    })
    await settle(600)

    expect(useExecutionStore.getState().isExecuting, '收尾事件仍应停跑').toBe(false)
    expect(
      useExecutionStore.getState().selectedExecutionId,
      '用户刻意留在编辑态时，执行完成不得把画布拽进回放态',
    ).toBeNull()
    expect(useWorkflowStore.getState().nodeStatuses).toEqual({})

    await act(async () => root.unmount())
  }, 20000)

  it('运行中改选历史执行：正在跑的那条不得污染回放画布与日志', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    // 本端跑着 201，用户却选中历史执行 202 看回放
    await act(async () => {
      useExecutionStore.getState().startExecution('201')
      await selectExecutionAndSync('202')
    })
    await settle(400)
    expect(useExecutionStore.getState().selectedExecutionId).toBe('202')
    const before = useWorkflowStore.getState().nodeStatuses

    await act(async () => {
      es.emit('node_start', { execution_id: 201, node_id: 'Encode' })
      es.emit('node_preview', { execution_id: 201, node_id: 'Encode', progress: 0.5 })
      es.emit('execution.log', { execution_id: 201, node_id: 'Encode', level: 'INFO', message: '运行中执行的日志' })
    })
    await settle(600)

    expect(
      useWorkflowStore.getState().nodeStatuses,
      '正在跑的 201 不得点亮 202 的回放画布',
    ).toEqual(before)
    expect(useWorkflowStore.getState().nodeRuntimeData).toEqual({})
    expect(
      useExecutionStore.getState().executionLog.map((l) => l.message),
      '201 的实时日志不得混进 202 的日志面板',
    ).not.toContain('运行中执行的日志')

    await act(async () => root.unmount())
  }, 20000)

  it('取消选中期间丢弃的实时日志：重新选中时从 DB 重载补齐缺口', async () => {
    resetState()
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    await act(async () => {
      useExecutionStore.getState().startExecution('201')
      await selectExecutionAndSync('201')
      await selectExecutionAndSync(null)
    })
    await settle(400)

    // 取消选中期间来了实时日志：丢弃并标记缺口
    await act(async () => {
      es.emit('execution.log', { execution_id: 201, node_id: 'Encode', level: 'INFO', message: '缺口期间的日志' })
    })
    await settle(400)
    expect(
      useExecutionStore.getState().liveLogGapExecutionId,
      '未选中期间丢弃本端运行中执行的日志应标记缺口',
    ).toBe('201')

    // 重新选中：live 执行本跳过重载（竞态保护），但有缺口时必须从 DB 补齐
    vi.mocked(getExecutionLogs).mockClear()
    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(400)
    expect(
      vi.mocked(getExecutionLogs),
      '有日志缺口时重新选中应从 DB 重载日志',
    ).toHaveBeenCalled()
    expect(useExecutionStore.getState().liveLogGapExecutionId, '补齐后缺口标记应清除').toBeNull()

    await act(async () => root.unmount())
  }, 20000)
})
