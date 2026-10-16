// @ts-nocheck — 回归测试：node_preview 事件必须按 kind 分流。
//
// 事故：节点执行时会额外物化「输入原图」（FLOWX_MEDIA{kind:"input"}），而 SSE 处理
// 原来不区分 kind——任何 kind 都写进 nodeRuntimeData[node].preview，输入原图会把画布上
// 的过程帧/结果帧顶掉（预览显示成输入图，且后续 frame 事件才纠正回来，观感是闪一下）。
//
// 约定：只有 kind=frame（含缺省，兼容旧节点）驱动 preview；其它 kind 进 media 映射，
// 供 widget 的对比控件取「原图」侧（props.media.input）。
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
    [*] --> CannyPrep
    CannyPrep --> [*]
Nodes:
  CannyPrep:
    config:
      nodeRef: preprocess-canny
`

const WF_ID = '58'
const EXEC = {
  id: 201,
  workflow_id: 58,
  status: 'success',
  trigger: 'manual',
  started_at: '2026-10-16T03:01:19Z',
}

// 媒体清单（kind=frame 的物化帧 + kind=input 的物化原图）
const MEDIA_ITEMS = [
  { nodeId: 'CannyPrep', kind: 'frame', name: 'frame.png', path: '/cache/201/CannyPrep/frame.png', size: 10, updatedAt: '2026-10-16T03:10:00Z' },
  { nodeId: 'CannyPrep', kind: 'input', name: 'input.png', path: '/cache/201/CannyPrep/input.png', size: 10, updatedAt: '2026-10-16T03:09:00Z' },
]

vi.mock('@/services/workflowService', () => ({
  updateWorkflow: vi.fn(async () => ({ code: 200 })),
  getWorkflowExecutors: vi.fn(async () => ({ code: 200, data: { source: 'workflow', executors: {}, nodes: {} } })),
  getWorkflow: vi.fn(async () => ({ code: 200, data: null })),
  getExecutions: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
  getExecution: vi.fn(async () => ({ code: 200, data: EXEC })),
  getExecutionYaml: vi.fn(async () => ({ code: 200, data: { hasSnapshot: true, yaml: TEMPLATE_YAML } })),
  getExecutionNodes: vi.fn(async () => ({
    code: 200,
    data: [{ id: 1, execution_id: 201, node_id: 'CannyPrep', status: 'success', completed_at: '2026-10-16T03:30:00Z' }],
  })),
  getExecutionLogs: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
  getExecutionMedia: vi.fn(async () => ({ code: 200, data: { media: MEDIA_ITEMS } })),
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
import { getExecutionMedia } from '@/services/workflowService'
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

function resetState() {
  useWorkflowStore.getState().setCurrentWorkflow({
    id: WF_ID,
    name: 'demo',
    yamlConfig: TEMPLATE_YAML,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  useWorkflowStore.getState().resetNodeRuntimeData()
  useExecutionStore.setState({
    isExecuting: false,
    runningExecutionId: null,
    selectedExecutionId: null,
    selectedExecution: null,
    selectedExecutionYaml: null,
  })
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

describe('node_preview 按 kind 分流', () => {
  it('kind=input 不得顶掉预览帧，且落到 media.input', async () => {
    resetState()
    // 本用例只考察 SSE 分流：媒体清单置空，避免恢复 effect 先种下 preview/media
    getExecutionMedia.mockImplementation(async () => ({ code: 200, data: { media: [] } }))
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(400)

    await act(async () => {
      // 先来的输入原图物化（kind=input）
      es.emit('node_preview', { execution_id: 201, node_id: 'CannyPrep', kind: 'input', path: '/cache/201/CannyPrep/input.png' })
    })
    await settle(200)

    const afterInput = useWorkflowStore.getState().nodeRuntimeData['CannyPrep']
    expect(afterInput?.media?.input, 'kind=input 应写进 media.input').toContain('input.png')
    expect(afterInput?.preview, 'kind=input 不得写 preview').toBeUndefined()

    await act(async () => {
      // 过程帧（kind=frame）随后到
      es.emit('node_preview', { execution_id: 201, node_id: 'CannyPrep', kind: 'frame', path: '/cache/201/CannyPrep/frame.png', progress: 1 })
    })
    await settle(200)

    const afterFrame = useWorkflowStore.getState().nodeRuntimeData['CannyPrep']
    expect(afterFrame?.preview?.url, 'kind=frame 应写 preview').toContain('frame.png')
    expect(afterFrame?.media?.input, 'frame 事件不得清掉 media.input').toContain('input.png')

    await act(async () => root.unmount())
  }, 20000)

  it('缺省 kind（旧节点）仍按 frame 处理', async () => {
    resetState()
    getExecutionMedia.mockImplementation(async () => ({ code: 200, data: { media: [] } }))
    const { root } = await mountCanvas()
    const es = esInstances[esInstances.length - 1]

    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(400)

    await act(async () => {
      es.emit('node_preview', { execution_id: 201, node_id: 'CannyPrep', path: '/cache/201/CannyPrep/legacy.png', progress: 0.5 })
    })
    await settle(200)

    expect(
      useWorkflowStore.getState().nodeRuntimeData['CannyPrep']?.preview?.url,
      '无 kind 字段的旧事件必须仍被当作过程帧',
    ).toContain('legacy.png')

    await act(async () => root.unmount())
  }, 20000)

  it('媒体清单恢复：kind=frame 进 preview，其它 kind 进 media', async () => {
    resetState()
    getExecutionMedia.mockImplementation(async () => ({ code: 200, data: { media: MEDIA_ITEMS } }))
    const { root } = await mountCanvas()

    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(600)

    const rt = useWorkflowStore.getState().nodeRuntimeData['CannyPrep']
    expect(rt?.preview?.url, 'frame 应恢复为 preview').toContain('frame.png')
    expect(rt?.media?.input, 'input 应恢复到 media.input').toContain('input.png')
    expect(rt?.media?.frame, 'frame 也进 media（widget 可按 kind 取用）').toContain('frame.png')

    await act(async () => root.unmount())
  }, 20000)
})
