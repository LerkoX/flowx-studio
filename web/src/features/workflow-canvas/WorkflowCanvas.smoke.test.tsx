// @ts-nocheck — 冒烟测试：jsdom 中真实渲染 WorkflowCanvas，
// 模拟后台 CLI 更新（SSE workflow.updated）验证画布增量刷新、逐个入场与逐个删除
import { describe, it, expect, vi, beforeAll } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// 可手动派发事件的 EventSource mock：记录所有实例，测试里向最新实例发事件
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

// 当前「服务端」的 YAML：测试可通过 setServerYaml 模拟后台更新
let serverYaml = `Name: demo
Graph: |
  stateDiagram-v2
    [*] --> A
    A --> [*]
Nodes:
  A:
    config:
      nodeRef: echo
`
function setServerYaml(y) {
  serverYaml = y
}
const serverYamlInitial = serverYaml

// act() 会把非 React 上下文（setTimeout 回调里的 store 更新）触发的渲染/副作用
// 延迟到 act 作用域退出时才冲刷，真实浏览器无此行为。因此测试里用多轮短 act
// 让「SSE 防抖 → 回读 → store 更新 → 图解析 → stagger 定时器 → 渲染」逐级推进
async function settle(ms) {
  const rounds = Math.max(1, Math.ceil(ms / 200))
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
  }
}

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

vi.mock('@/services/workflowService', () => ({
  updateWorkflow: vi.fn(async () => ({ code: 200 })),
  getWorkflow: vi.fn(async (id) => ({
    code: 200,
    data: {
      id: Number(id),
      name: 'demo-workflow',
      yamlConfig: serverYaml,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })),
}))
vi.mock('@/services/nodeService', () => ({
  getNodes: vi.fn(async () => ({ code: 200, data: { items: [] } })),
}))
vi.mock('@/utils/mermaidParser', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    // mermaid 在 jsdom 中不可用：按 YAML 中 Nodes 的键 stub 出图结构
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
import { useWorkflowStore } from '@/stores/workflowStore'

const YAML_WITH_B = `Name: demo
Graph: |
  stateDiagram-v2
    [*] --> A
    A --> B
    B --> [*]
Nodes:
  A:
    config:
      nodeRef: echo
  B:
    config:
      nodeRef: echo
`

const YAML_WITH_BC = `Name: demo
Graph: |
  stateDiagram-v2
    [*] --> A
    A --> B
    B --> C
    C --> [*]
Nodes:
  A:
    config:
      nodeRef: echo
  B:
    config:
      nodeRef: echo
  C:
    config:
      nodeRef: echo
`

describe('WorkflowCanvas 外部更新', () => {
  it('SSE workflow.updated 后节点逐个入场、逐个删除（store 中 id 为 number）', async () => {
    // 复现列表页点击进入的场景：id 是 number 而非 string
    useWorkflowStore.getState().setCurrentWorkflow({
      id: 20,
      name: 'demo-workflow',
      yamlConfig: serverYaml,
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

    // 顶部工具栏渲染正常
    const toolbar = container.querySelector('.absolute.top-0.inset-x-0')
    expect(toolbar, '顶部工具栏应该渲染').toBeTruthy()
    expect(container.textContent).toContain('demo-workflow')
    // 初始只有节点 A
    expect(container.textContent).toContain('A')
    expect(container.textContent).not.toContain('B')

    const es = esInstances[esInstances.length - 1]
    expect(es, '画布应已订阅 SSE').toBeTruthy()

    // 模拟后台 CLI 更新：服务端 YAML 加了节点 B，推送 workflow.updated
    setServerYaml(YAML_WITH_B)
    await act(async () => {
      es.emit('workflow.updated', {
        Type: 'workflow.updated',
        Data: { id: 20, yamlConfig: YAML_WITH_B },
      })
    })
    await settle(1500)
    expect(
      useWorkflowStore.getState().currentWorkflow.yamlConfig,
      '外部更新应写回 store',
    ).toBe(YAML_WITH_B)
    expect(container.textContent, '新增节点 B 应出现在画布上').toContain('B')

    // 再加一个节点 C（A、B、C 都在）
    setServerYaml(YAML_WITH_BC)
    await act(async () => {
      es.emit('workflow.updated', {
        Type: 'workflow.updated',
        Data: { id: 20, yamlConfig: YAML_WITH_BC },
      })
    })
    await settle(1500)
    expect(container.textContent).toContain('B')
    expect(container.textContent, '新增节点 C 应出现在画布上').toContain('C')

    // 模拟后台同时删除 B、C：应从链尾到链头逐个淡出——
    // C 先消失（0ms 开始淡出，~320ms 移除），B 后消失（400ms 开始，~720ms 移除）
    setServerYaml(serverYamlInitial)
    await act(async () => {
      es.emit('workflow.updated', {
        Type: 'workflow.updated',
        Data: { id: 20, yamlConfig: serverYamlInitial },
      })
    })
    // 推进到 C 已移除、B 还在淡出队列中的时间点
    await settle(900)
    expect(container.textContent, 'C 应先被移除').not.toContain('C')
    expect(container.textContent, 'B 应仍在（还没轮到它淡出或正在淡出）').toContain('B')
    await settle(1200)
    expect(container.textContent, 'B 最终也应被移除').not.toContain('B')
    expect(container.textContent, '保留节点 A 不受影响').toContain('A')

    await act(async () => root.unmount())
  }, 20000)
})
