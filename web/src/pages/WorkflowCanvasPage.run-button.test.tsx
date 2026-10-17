// @ts-nocheck — 回归测试：运行按钮状态语义（完全开放）。
// 编辑态（未选中执行）**总是可点**：不受全局 isExecuting、也不受本流水线/别的
// 流水线存活执行（running/paused）影响——同流水线允许多次并发发起。
// 运行态只跟随「选中执行自身的状态」：选中正在运行的执行才禁用并转圈。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// jsdom 无 matchMedia（useMediaQuery 依赖），补最小桩
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })
}

// 可控路由：跨流水线用例需要切换到另一条流水线详情页
let routeWorkflowId = '113'

// 可控的「服务端」执行列表：测试用 setServerExecutions 切换场景
let serverExecutions = []
function setServerExecutions(items) {
  serverExecutions = items
}

vi.mock('@/services/workflowService', async (importOriginal) => {
  const orig = await importOriginal()
  return {
    ...orig,
    getExecutions: vi.fn(async () => ({
      data: { items: serverExecutions, total: serverExecutions.length, page: 1, pageSize: 10 },
    })),
    getWorkflow: vi.fn(async () => ({ data: null })),
    // 本端运行：接口返回新执行 id（handleRun 据此本地进入回放态）
    runWorkflow: vi.fn(async () => ({
      code: 200,
      data: { executionId: 900, status: 'running', streamUrl: '/api/v1/executions/900/stream' },
    })),
    getExecution: vi.fn(async () => ({
      code: 200,
      data: { id: 900, workflow_id: 113, status: 'running', trigger: 'manual' },
    })),
    getExecutionYaml: vi.fn(async () => ({ code: 200, data: { hasSnapshot: true, yaml: WF.yamlConfig } })),
    getExecutionNodes: vi.fn(async () => ({ code: 200, data: [] })),
    getExecutionLogs: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
    continueExecution: vi.fn(async () => ({})),
    pauseExecution: vi.fn(async () => ({})),
    resumeExecution: vi.fn(async () => ({})),
    cancelExecution: vi.fn(async () => ({})),
  }
})

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal()
  return {
    ...orig,
    useParams: () => ({ id: routeWorkflowId }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    Navigate: () => null,
  }
})

// 重子组件 mock：画布保留 action 出口（运行按钮渲染在画布工具栏内）
vi.mock('@/features/workflow-canvas/WorkflowCanvas', () => ({
  default: (props) => React.createElement('div', null, props.action),
  flushNodeParamsPersist: vi.fn(async () => {}),
}))
vi.mock('@/features/workflow-canvas/WorkflowConfigPanel', () => ({ default: () => null }))
vi.mock('@/features/workflow-canvas/ExecutionContextBar', () => ({ default: () => null }))
vi.mock('@/features/workflow-canvas/ExecutionNodesPanel', () => ({ default: () => null }))
vi.mock('@/components/LogViewer', () => ({ default: () => null }))

import '@/i18n'
import WorkflowCanvasPage from '@/pages/WorkflowCanvasPage'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useExecutionStore } from '@/stores/executionStore'

const WF = {
  id: '113',
  name: 'demo-wf',
  status: 'draft',
  yamlConfig: 'Name: demo\nGraph: |\n  stateDiagram-v2\n    [*] --> A\n    A --> [*]\nNodes:\n  A:\n    config:\n      nodeRef: echo\n',
}

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

function findRunButton(container) {
  return [...container.querySelectorAll('button')].find((b) =>
    b.querySelector('svg.lucide-play, svg.lucide-loader-circle, svg.lucide-loader2')
  )
}

describe('WorkflowCanvasPage 运行按钮状态（编辑态完全开放）', () => {
  let container
  let root

  beforeEach(() => {
    setServerExecutions([])
    routeWorkflowId = '113'
    useWorkflowStore.getState().setCurrentWorkflow({ ...WF })
    useExecutionStore.setState({
      isExecuting: false,
      runningExecutionId: null,
      runningWorkflowId: null,
      selectedExecutionId: null,
      selectedExecution: null,
      executionNodes: [],
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount())
      root = null
    }
    container?.remove()
    container = null
  })

  async function renderPage() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(WorkflowCanvasPage))
    })
    await settle(30)
  }

  it('编辑态：无任何执行时按钮可点', async () => {
    setServerExecutions([{ id: '580', status: 'success' }])
    await renderPage()
    const btn = findRunButton(container)
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(false)
  })

  it('编辑态：本流水线有 running 执行时按钮仍可点、不转圈（没选中就不锁）', async () => {
    setServerExecutions([{ id: '582', status: 'running' }])
    await renderPage()
    const btn = findRunButton(container)
    expect(btn.disabled, '编辑态不得被存活执行锁死').toBe(false)
    expect(btn.querySelector('svg.animate-spin')).toBeFalsy()
  })

  it('编辑态：本流水线有 paused 执行时按钮同样可点', async () => {
    setServerExecutions([{ id: '582', status: 'paused' }])
    await renderPage()
    expect(findRunButton(container).disabled).toBe(false)
  })

  it('编辑态：本端已发起过运行（isExecuting 为 true）也不锁按钮', async () => {
    useExecutionStore.setState({
      isExecuting: true,
      runningExecutionId: '700',
      runningWorkflowId: '113',
    })
    await renderPage()
    const btn = findRunButton(container)
    expect(btn.disabled, '编辑态只认选中执行，不认全局运行态').toBe(false)
    expect(btn.querySelector('svg.animate-spin')).toBeFalsy()
  })

  it('编辑态：别的流水线在跑不影响本流水线按钮', async () => {
    useExecutionStore.setState({
      isExecuting: true,
      runningExecutionId: '700',
      runningWorkflowId: '999',
    })
    await renderPage()
    const btn = findRunButton(container)
    expect(btn.disabled).toBe(false)
    expect(btn.querySelector('svg.animate-spin')).toBeFalsy()
  })

  it('本端点运行：按接口返回的 execution_id 直接进入该执行回放态（不依赖 SSE 事件）', async () => {
    await renderPage()
    const btn = findRunButton(container)
    expect(btn.disabled).toBe(false)

    await act(async () => {
      btn.click()
      await new Promise((r) => setTimeout(r, 50))
    })

    const exec = useExecutionStore.getState()
    expect(exec.selectedExecutionId, '本端运行后应选中新执行（回放态）').toBe('900')
    expect(exec.runningExecutionId, '同时标记为运行中，暂停按钮/停跑才正确').toBe('900')
    expect(exec.isExecuting).toBe(true)
  })

  it('回放态：选中正在运行的执行 → 按钮禁用并转圈', async () => {
    useExecutionStore.setState({
      selectedExecutionId: '900',
      selectedExecution: { id: '900', workflowId: '113', status: 'running', trigger: 'manual' },
    })
    await renderPage()
    const btn = findRunButton(container)
    expect(btn.disabled, '选中执行正在运行，按钮跟随该执行的状态').toBe(true)
    expect(btn.querySelector('svg.animate-spin')).toBeTruthy()
  })

  it('回放态：选中已结束执行且无新增节点 → 按钮禁用但不转圈', async () => {
    useExecutionStore.setState({
      selectedExecutionId: '905',
      selectedExecution: { id: '905', workflowId: '113', status: 'success', trigger: 'manual' },
      executionNodes: [{ nodeId: 'A', status: 'success' }],
    })
    await renderPage()
    const btn = findRunButton(container)
    expect(btn.disabled, '无节点可跑').toBe(true)
    expect(btn.querySelector('svg.animate-spin')).toBeFalsy()
  })
})
