// @ts-nocheck — 回归：实测尺寸重排必须能落地。
// 场景：图重建后先按估算尺寸占位，ResizeObserver 上报真实尺寸触发重排；此时若
// 任意 setNodes/setEdges（执行状态同步、运行时数据注入、连线动画…）让 effect 重跑，
// 旧实现会「命中同一尺寸 key 提前 return + cleanup 取消在飞布局」，两次都落不了地，
// 画布永久停在估算尺寸布局上（节点挤成一团），只有手动收缩再展开才自愈。
// 这里把 AutoLayout mock 成手动 resolve 的 Promise，制造确定性的「布局在飞」窗口。
import { describe, it, expect, vi, beforeAll } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 可手动 resolve 的布局调用记录
const layout = vi.hoisted(() => ({ calls: [], resolve: null }))
vi.mock('@/features/workflow-canvas/AutoLayout', () => ({
  autoLayout: (nodes, edges) =>
    new Promise((resolve) => {
      layout.calls.push({ nodes, edges, resolve })
    }),
}))

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

vi.mock('@/services/workflowService', () => ({
  updateWorkflow: vi.fn(async () => ({ code: 200 })),
  getWorkflowExecutors: vi.fn(async () => ({
    code: 200,
    data: { source: 'workflow', executors: {}, nodes: {} },
  })),
  getWorkflow: vi.fn(async () => ({ code: 200, data: null })),
  getExecutions: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
  getExecution: vi.fn(async () => ({ code: 200, data: null })),
  getExecutionYaml: vi.fn(async () => ({ code: 200, data: { hasSnapshot: false, yaml: '' } })),
  getExecutionNodes: vi.fn(async () => ({ code: 200, data: [] })),
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
    parseWorkflowGraph: vi.fn(async () => ({
      nodes: [
        { id: '__start__', label: 'start' },
        { id: 'Encode', label: 'Encode' },
        { id: 'SaveImage', label: 'SaveImage' },
        { id: '__end__', label: 'end' },
      ],
      edges: [
        { source: '__start__', target: 'Encode' },
        { source: 'Encode', target: 'SaveImage' },
        { source: 'SaveImage', target: '__end__' },
      ],
    })),
  }
})

// —— 可控测量：ResizeObserver + 节点实测尺寸（展开态 320x400）——
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
      return 320
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (!this.classList?.contains('react-flow__node')) return 0
      return 400
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

// 触发所有 ResizeObserver 回调：模拟浏览器把节点真实尺寸上报给 React Flow
async function flushResize() {
  await act(async () => {
    resizeObservers.forEach((ro) => {
      const targets = [...ro.targets]
      if (targets.length) ro.cb(targets.map((t) => ({ target: t })), ro)
    })
  })
  await settle(150)
}

// 用 mock 收到的节点尺寸排一列，位置可反推布局用的是估算还是实测尺寸
function resolveLayoutCall(index) {
  const call = layout.calls[index]
  let y = 0
  const nodes = call.nodes.map((n) => {
    const positioned = { ...n, position: { x: 0, y } }
    // 估算尺寸：节点还没有 measured 时为 100（AutoLayout 的 NODE_HEIGHT）
    y += (n.measured?.height ?? 100) + 16
    return positioned
  })
  call.resolve({ nodes, edges: call.edges })
}

function resolveAllPending() {
  for (let i = 0; i < layout.calls.length; i++) {
    if (!layout.calls[i].settled) {
      layout.calls[i].settled = true
      resolveLayoutCall(i)
    }
  }
}

// 反复 resolve 直到没有在飞的布局（图重建可能触发多次解析/布局）
async function drainLayout() {
  for (let i = 0; i < 6; i++) {
    if (!layout.calls.some((c) => !c.settled)) break
    await act(async () => {
      resolveAllPending()
    })
    await settle(200)
  }
}

function measuredHeights(index) {
  return layout.calls[index].nodes.map((n) => n.measured?.height ?? 100)
}

function rankGap() {
  const top = (id) => {
    const el = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    if (!el) return null
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform || '')
    return m ? Number(m[2]) : null
  }
  const a = top('Encode')
  const b = top('SaveImage')
  if (a === null || b === null) return null
  return b - a
}

import '@/i18n'
import WorkflowCanvas from '@/features/workflow-canvas/WorkflowCanvas'
import { useWorkflowStore } from '@/stores/workflowStore'

describe('实测尺寸重排的落地可靠性', () => {
  it('布局在飞时被状态更新打断，最终仍按实测尺寸排布（不退回估算布局）', async () => {
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
    await settle(300)

    // 图重建会触发多次解析/布局（nodeRefs resolve 完成后 effect 重跑）：全部落地，
    // 让节点真正挂载并开始被 ResizeObserver 观察。此时只有估算尺寸（无 measured）
    await drainLayout()
    expect(
      document.querySelectorAll('.react-flow__node').length,
      '节点应已挂载'
    ).toBeGreaterThan(0)

    // ResizeObserver 上报真实尺寸 320x400 → 触发实测尺寸重排（防抖后在飞）
    await flushResize()
    await settle(200)
    const pending = layout.calls.filter((c) => !c.settled)
    expect(pending.length, '实测尺寸上报后应触发一次重排').toBeGreaterThan(0)
    expect(
      measuredHeights(layout.calls.length - 1),
      '重排必须按实测尺寸（400）而非估算尺寸（100）'
    ).toContain(400)

    // 打断：执行状态同步引发 setNodes（尺寸不变），旧实现会在此丢掉在飞的重排
    await act(async () => {
      useWorkflowStore.getState().updateNodeStatus('Encode', 'running')
    })
    await settle(300)

    // 让所有排布的 Promise 落地（被取消的那次不会被应用）
    await act(async () => {
      resolveAllPending()
    })
    await settle(300)

    // 实测高 400 + rank 间距 16 = 416；估算布局只有 100 + 16 = 116
    const gap = rankGap()
    expect(gap, '节点间距必须按实测尺寸排布').not.toBeNull()
    expect(gap, '间距退回估算布局：实测重排被状态更新打断后丢失').toBeGreaterThan(400)

    await act(async () => root.unmount())
  }, 30000)
})
