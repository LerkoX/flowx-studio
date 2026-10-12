// @ts-nocheck — 回归测试：编辑态下探测到存活执行（running/paused）时，
// 运行按钮必须禁用并转圈——防止 isExecuting 内存态丢失（浏览器刷新 /
// CLI 或其他端发起运行）后按钮回弹，误触重复发起执行。
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
    useParams: () => ({ id: '113' }),
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

describe('WorkflowCanvasPage 运行按钮禁用态（存活执行探测）', () => {
  let container
  let root

  beforeEach(() => {
    setServerExecutions([])
    useWorkflowStore.getState().setCurrentWorkflow({ ...WF })
    useExecutionStore.setState({
      isExecuting: false,
      runningExecutionId: null,
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
    await settle(30) // 等存活执行探测的 effect + fetch 落地
  }

  it('无存活执行：运行按钮可点击', async () => {
    setServerExecutions([{ id: '580', status: 'success' }])
    await renderPage()
    const btn = findRunButton(container)
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(false)
  })

  it('存在 running 执行：运行按钮禁用且转圈', async () => {
    setServerExecutions([{ id: '582', status: 'running' }])
    await renderPage()
    const btn = findRunButton(container)
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(true)
    expect(btn.querySelector('svg.animate-spin')).toBeTruthy()
  })

  it('存在 paused 执行：运行按钮同样禁用', async () => {
    setServerExecutions([{ id: '582', status: 'paused' }])
    await renderPage()
    const btn = findRunButton(container)
    expect(btn).toBeTruthy()
    expect(btn.disabled).toBe(true)
  })

  it('本端点运行：按接口返回的 execution_id 直接进入该执行回放态（不依赖 SSE 事件）', async () => {
    setServerExecutions([])
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

  it('存活执行进入终态后：按钮恢复可点击（轮询复查）', async () => {
    vi.useFakeTimers()
    try {
      setServerExecutions([{ id: '582', status: 'running' }])
      // fake timers 下不能用 settle（内部 setTimeout 被接管），
      // 渲染与微任务冲刷统一走 advanceTimersByTimeAsync
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      await act(async () => {
        root.render(React.createElement(WorkflowCanvasPage))
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(findRunButton(container).disabled).toBe(true)

      // 服务端执行结束 → 下一次 15s 轮询探测后按钮恢复
      setServerExecutions([{ id: '582', status: 'failed' }])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(findRunButton(container).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
