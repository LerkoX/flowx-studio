// @ts-nocheck — 复现测试：回放态选中/切换/取消选中历史执行后，
// 画布节点上的运行时数据（如 save-image 的图片输出）是否完全清除
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

// 两次执行：exec 201 两节点都有输出；exec 202 只有 Encode 输出（SaveImage 未产出）
const EXECUTIONS = {
  '201': {
    id: 201,
    workflow_id: 58,
    status: 'success',
    trigger: 'manual',
    started_at: '2026-09-20T01:00:00Z',
    metadata: JSON.stringify({
      metadata: {
        'Encode.conditioning': 'abc123',
        'SaveImage.file_path': '/tmp/exec-201.png',
        'SaveImage.size_bytes': '12345',
      },
    }),
  },
  '202': {
    id: 202,
    workflow_id: 58,
    status: 'failed',
    trigger: 'manual',
    started_at: '2026-09-20T02:00:00Z',
    metadata: JSON.stringify({
      metadata: {
        'Encode.conditioning': 'def456',
      },
    }),
  },
}

// 可控延迟的 getExecution：slowExecutions[id] 存在时等待其 resolve
const mockState = vi.hoisted(() => ({
  slowExecutions: {} as Record<string, { promise: Promise<void>; resolve: () => void }>,
}))

vi.mock('@/services/workflowService', () => ({
  updateWorkflow: vi.fn(async () => ({ code: 200 })),
  // 画布执行器徽章查询：测试不涉及，返回空解析结果
  getWorkflowExecutors: vi.fn(async () => ({ code: 200, data: { source: 'workflow', executors: {}, nodes: {} } })),
  getWorkflow: vi.fn(async () => ({ code: 200, data: null })),
  getExecutions: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
  getExecution: vi.fn(async (id) => {
    const gate = mockState.slowExecutions[String(id)]
    if (gate) await gate.promise
    return { code: 200, data: EXECUTIONS[String(id)] }
  }),
  getExecutionYaml: vi.fn(async () => ({
    code: 200,
    // 快照与模板同图（未续跑追加节点的常见场景）
    data: { hasSnapshot: true, yaml: TEMPLATE_YAML },
  })),
  getExecutionNodes: vi.fn(async (id) => ({
    code: 200,
    data:
      String(id) === '201'
        ? [
            { id: 1, execution_id: 201, node_id: 'Encode', status: 'success', completed_at: '2026-09-20T01:00:10Z' },
            { id: 2, execution_id: 201, node_id: 'SaveImage', status: 'success', completed_at: '2026-09-20T01:00:20Z' },
          ]
        : [
            { id: 3, execution_id: 202, node_id: 'Encode', status: 'success', completed_at: '2026-09-20T02:00:10Z' },
            { id: 4, execution_id: 202, node_id: 'SaveImage', status: 'failed' },
          ],
  })),
  getExecutionLogs: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
}))
vi.mock('@/services/nodeService', () => ({
  getNodes: vi.fn(async () => ({ code: 200, data: { items: [] } })),
  // 不返回 ui 配置：节点走原生外壳，输出区直接渲染在 DOM 中便于断言
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
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({ source: nodes[i].id, target: nodes[i + 1].id })
      }
      return { nodes, edges }
    }),
  }
})

import '@/i18n'
import WorkflowCanvas from '@/features/workflow-canvas/WorkflowCanvas'
import { selectExecutionAndSync } from '@/features/workflow-canvas/executionSelection'
import { useWorkflowStore } from '@/stores/workflowStore'

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

// 展开所有节点的「返回」列表（幂等：已展开则跳过），由调用方读 textContent
async function expandOutputs(container) {
  await act(async () => {
    const btns = [...container.querySelectorAll('button')].filter((b) =>
      /返回 \d|Outputs \d/.test(b.textContent || ''),
    )
    // OutputExplorer 展开后会渲染输出 key 按钮（font-mono）；已展开的跳过避免 toggler 收起
    btns.forEach((b) => {
      const section = b.closest('.mt-2.pt-2') || b.parentElement
      if (section && section.querySelector('button.font-mono')) return
      b.click()
    })
  })
  await settle(400)
}

describe('回放态画布数据清除', () => {
  it('取消选中历史执行后，节点输出（save-image 图片）应从画布清除', async () => {
    useWorkflowStore.getState().setCurrentWorkflow({
      id: '58',
      name: 'demo',
      yamlConfig: TEMPLATE_YAML,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(WorkflowCanvas))
    })
    await settle(600)
    expect(container.textContent).toContain('SaveImage')

    // 选中执行 201（回放态）：SaveImage 输出应出现在画布
    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(800)
    await expandOutputs(container)
    expect(container.textContent, '回放态应能看到 SaveImage 的 file_path 输出').toContain('file_path')

    // 取消选中（退出回放态）：输出应完全清除
    await act(async () => {
      await selectExecutionAndSync(null)
    })
    await settle(800)
    expect(
      useWorkflowStore.getState().nodeRuntimeData,
      '退出回放态后 store 运行时数据应为空',
    ).toEqual({})
    await expandOutputs(container)
    expect(
      container.textContent,
      '退出回放态后画布不应残留 file_path',
    ).not.toContain('file_path')

    await act(async () => root.unmount())
  }, 20000)

  it('切换历史执行（A→B，B 缺少该节点输出）不应残留 A 的节点输出', async () => {
    useWorkflowStore.getState().setCurrentWorkflow({
      id: '58',
      name: 'demo',
      yamlConfig: TEMPLATE_YAML,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(WorkflowCanvas))
    })
    await settle(600)

    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(800)
    await expandOutputs(container)
    expect(container.textContent).toContain('file_path')
    expect(
      useWorkflowStore.getState().nodeRuntimeData.SaveImage?.outputs?.file_path,
      '回放 201 时 store 应有 SaveImage 输出',
    ).toBe('/tmp/exec-201.png')

    // 切到执行 202：SaveImage 没有产出，旧输出不应残留
    await act(async () => {
      await selectExecutionAndSync('202')
    })
    await settle(800)
    expect(
      useWorkflowStore.getState().nodeRuntimeData.SaveImage?.outputs,
      '切换到无 SaveImage 输出的执行后，store 不应残留旧输出',
    ).toBeUndefined()
    await expandOutputs(container)
    expect(
      container.textContent,
      '切换到无 SaveImage 输出的执行后不应残留旧 file_path',
    ).not.toContain('file_path')

    await act(async () => root.unmount())
  }, 20000)

  it('选中后立刻取消：迟到的执行详情响应不得重新播种节点输出', async () => {
    // getExecution(201) 被闸门挡住，模拟慢网络
    let release: () => void
    const gate = new Promise<void>((r) => (release = r))
    mockState.slowExecutions['201'] = { promise: gate, resolve: () => release() }

    useWorkflowStore.getState().setCurrentWorkflow({
      id: '58',
      name: 'demo',
      yamlConfig: TEMPLATE_YAML,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(WorkflowCanvas))
    })
    await settle(600)

    // 选中执行 201（详情加载中）→ 加载完成前立刻取消选中
    await act(async () => {
      void selectExecutionAndSync('201')
    })
    await act(async () => {
      await selectExecutionAndSync(null)
    })
    // 放行迟到的 201 响应
    await act(async () => {
      mockState.slowExecutions['201'].resolve()
    })
    await settle(800)

    expect(
      useWorkflowStore.getState().nodeRuntimeData,
      '取消选中后迟到的响应不得重新播种运行时数据',
    ).toEqual({})
    await expandOutputs(container)
    expect(
      container.textContent,
      '取消选中后画布不应因迟到的响应出现 file_path',
    ).not.toContain('file_path')

    delete mockState.slowExecutions['201']
    await act(async () => root.unmount())
  }, 20000)
})
