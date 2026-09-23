// @ts-nocheck — 回归测试：折叠态下切换/取消选中历史执行后，节点间距必须保持
// 「实测折叠尺寸」的排布，不能回退到图重建时的估算尺寸（展开态量级）。
// jsdom 没有布局引擎，这里劫持 offsetWidth/offsetHeight 模拟节点实测尺寸，
// 并用手动触发的 ResizeObserver 让 React Flow 走完「测量 → dimensions change →
// 实测尺寸重排」链路。
import { describe, it, expect, vi, beforeAll } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

class MockEventSource {
  constructor(url) {
    this.url = url
    this.listeners = {}
  }
  addEventListener(type, fn) {
    ;(this.listeners[type] ||= []).push(fn)
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

// 执行快照与模板同图但字符串不同，确保切换执行时画布重新解析
const SNAPSHOT_YAML = TEMPLATE_YAML + '# snapshot\n'

const EXECUTIONS = {
  '201': {
    id: 201,
    workflow_id: 58,
    status: 'success',
    trigger: 'manual',
    started_at: '2026-09-20T01:00:00Z',
    metadata: JSON.stringify({ metadata: { 'Encode.conditioning': 'abc123' } }),
  },
}

vi.mock('@/services/workflowService', () => ({
  updateWorkflow: vi.fn(async () => ({ code: 200 })),
  getWorkflowExecutors: vi.fn(async () => ({
    code: 200,
    data: { source: 'workflow', executors: {}, nodes: {} },
  })),
  getWorkflow: vi.fn(async () => ({ code: 200, data: null })),
  getExecutions: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
  getExecution: vi.fn(async (id) => ({ code: 200, data: EXECUTIONS[String(id)] })),
  getExecutionYaml: vi.fn(async () => ({
    code: 200,
    data: { hasSnapshot: true, yaml: SNAPSHOT_YAML },
  })),
  getExecutionNodes: vi.fn(async () => ({
    code: 200,
    data: [
      { id: 1, execution_id: 201, node_id: 'Encode', status: 'success', completed_at: '2026-09-20T01:00:10Z' },
      { id: 2, execution_id: 201, node_id: 'SaveImage', status: 'success', completed_at: '2026-09-20T01:00:20Z' },
    ],
  })),
  getExecutionLogs: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
}))
vi.mock('@/services/nodeService', () => ({
  getNodes: vi.fn(async () => ({ code: 200, data: { items: [] } })),
  // 不返回 ui 配置：节点走原生外壳，估算尺寸恒为 220x100，与实测尺寸明显不同
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

// —— 可控测量：ResizeObserver + 节点实测尺寸 ——
const resizeObservers = []
class MockResizeObserver {
  constructor(cb) {
    this.cb = cb
    this.targets = new Set()
    resizeObservers.push(this)
  }
  observe(el) {
    this.targets.add(el)
  }
  unobserve(el) {
    this.targets.delete(el)
  }
  disconnect() {
    this.targets.clear()
  }
}

// 折叠态实测 160x60；展开态实测 320x400。两者都远大于/小于估算尺寸 220x100
const dims = { collapsed: false }

beforeAll(() => {
  global.DOMMatrixReadOnly = class {
    constructor(transform) {
      const m = /scale\(([-\d.]+)/.exec(transform || '')
      this.m22 = m ? Number(m[1]) : 1
    }
  }
  global.ResizeObserver = MockResizeObserver
  global.EventSource = MockEventSource
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      if (!this.classList?.contains('react-flow__node')) return 0
      return dims.collapsed ? 160 : 320
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (!this.classList?.contains('react-flow__node')) return 0
      return dims.collapsed ? 60 : 400
    },
  })
})

async function settle(ms) {
  const rounds = Math.max(1, Math.ceil(ms / 100))
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })
  }
}

// 触发所有 ResizeObserver 回调：模拟浏览器把当前元素尺寸上报给 React Flow
async function flushResize() {
  await act(async () => {
    resizeObservers.forEach((ro) => {
      const targets = [...ro.targets]
      if (targets.length) ro.cb(targets.map((t) => ({ target: t })), ro)
    })
  })
  await settle(200)
}

// 读取节点在画布中的 y 坐标（React Flow 把位置写成内联 translate）
function nodeTop(id) {
  const el = document.querySelector(`.react-flow__node[data-id="${id}"]`)
  if (!el) return null
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform || '')
  return m ? Number(m[2]) : null
}

function rankGap() {
  return nodeTop('SaveImage') - nodeTop('Encode')
}

import '@/i18n'
import WorkflowCanvas from '@/features/workflow-canvas/WorkflowCanvas'
import { selectExecutionAndSync } from '@/features/workflow-canvas/executionSelection'
import { useWorkflowStore } from '@/stores/workflowStore'

describe('折叠态下切换历史执行的画布间距', () => {
  it('选中/取消选中历史执行后，间距保持折叠实测尺寸（不回退到估算尺寸）', async () => {
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
    await settle(500)
    await flushResize()

    // 展开态：实测 400 高 + 48 rank 间距
    const expandedGap = rankGap()
    expect(expandedGap).toBeGreaterThan(400)

    // 折叠所有节点：实测尺寸变小，实测尺寸重排后间距应收紧
    dims.collapsed = true
    await act(async () => {
      useWorkflowStore.getState().setNodesCollapsed(true)
    })
    await settle(300)
    await flushResize()
    const collapsedGap = rankGap()
    expect(collapsedGap, '折叠后应按实测尺寸收紧间距').toBeLessThan(200)

    // 选中历史执行（回放态，图按执行快照重建）：位置一度来自估算尺寸，
    // 实测尺寸重排必须重新跑一次，间距保持折叠值
    await act(async () => {
      await selectExecutionAndSync('201')
    })
    await settle(600)
    await flushResize()
    expect(rankGap(), '选中历史执行后间距不应回退到估算尺寸（≈148）').toBe(collapsedGap)

    // 取消选中（回到模板重建）：同样必须保持折叠间距
    await act(async () => {
      await selectExecutionAndSync(null)
    })
    await settle(600)
    await flushResize()
    expect(rankGap(), '取消选中历史执行后间距不应回退到估算尺寸（≈148）').toBe(collapsedGap)

    await act(async () => root.unmount())
  }, 30000)
})
