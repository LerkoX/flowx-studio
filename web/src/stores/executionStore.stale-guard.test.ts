// @ts-nocheck — 回归测试：executionStore 的异步加载在响应落地前必须校验「当前选中」。
// 执行间严格隔离：加载 A 的节点/日志期间用户取消选中或改选 B，迟到的响应
// 一律丢弃——否则 A 的数据会串进未选中的画布或 B 的视图。
import { describe, it, expect, vi, beforeEach } from 'vitest'

let resolveNodes: (v: unknown) => void
let resolveLogs: (v: unknown) => void

vi.mock('@/services/workflowService', () => ({
  getExecutions: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
  getExecution: vi.fn(async () => ({ code: 200, data: null })),
  getExecutionYaml: vi.fn(async () => ({ code: 200, data: { hasSnapshot: false } })),
  getExecutionNodes: vi.fn(
    () =>
      new Promise((resolve) => {
        resolveNodes = resolve
      }),
  ),
  getExecutionLogs: vi.fn(
    () =>
      new Promise((resolve) => {
        resolveLogs = resolve
      }),
  ),
}))

import { useExecutionStore } from '@/stores/executionStore'

const NODE_201 = { id: 1, execution_id: 201, node_id: 'Encode', status: 'success' }
const LOG_201 = { id: 'l1', execution_id: 201, node_id: 'Encode', level: 'info', message: 'A 的日志' }

function resetStore() {
  useExecutionStore.setState({
    isExecuting: false,
    runningExecutionId: null,
    liveLogGapExecutionId: null,
    selectedExecutionId: null,
    selectedExecution: null,
    selectedExecutionYaml: null,
    executionNodes: [],
    executionLog: [],
    logsTotal: 0,
    loadingNodes: false,
    loadingLogs: false,
    loadingOlder: false,
  })
}

describe('executionStore 异步迟到响应守卫（执行间严格隔离）', () => {
  beforeEach(resetStore)

  it('loadExecutionNodes：响应到达前取消选中，迟到的节点记录被丢弃', async () => {
    useExecutionStore.setState({ selectedExecutionId: '201' })
    const p = useExecutionStore.getState().loadExecutionNodes('201')

    // 等待响应期间用户取消选中（selectExecution(null) 会清空节点记录）
    useExecutionStore.setState({ selectedExecutionId: null, executionNodes: [] })
    resolveNodes({ code: 200, data: [NODE_201] })
    await p

    expect(
      useExecutionStore.getState().executionNodes,
      '取消选中后迟到的节点记录不得落地',
    ).toEqual([])
  })

  it('loadExecutionNodes：响应到达前改选其他执行，迟到的节点记录被丢弃', async () => {
    useExecutionStore.setState({ selectedExecutionId: '201' })
    const p = useExecutionStore.getState().loadExecutionNodes('201')

    useExecutionStore.setState({ selectedExecutionId: '202', executionNodes: [] })
    resolveNodes({ code: 200, data: [NODE_201] })
    await p

    expect(useExecutionStore.getState().executionNodes).toEqual([])
  })

  it('loadLatestLogs：响应到达前改选其他执行，迟到的日志被丢弃', async () => {
    useExecutionStore.setState({ selectedExecutionId: '201' })
    const p = useExecutionStore.getState().loadLatestLogs('201')

    useExecutionStore.setState({ selectedExecutionId: '202', executionLog: [] })
    resolveLogs({ code: 200, data: { items: [LOG_201], total: 1 } })
    await p

    expect(
      useExecutionStore.getState().executionLog,
      'A 的迟到日志不得串进 B 的日志视图',
    ).toEqual([])
  })

  it('loadOlderLogs：翻页加载期间改选其他执行，A 的旧日志不得 prepend 进 B', async () => {
    useExecutionStore.setState({
      selectedExecutionId: '201',
      executionLog: [],
      logsTotal: 100,
    })
    const p = useExecutionStore.getState().loadOlderLogs()

    useExecutionStore.setState({ selectedExecutionId: '202', executionLog: [] })
    resolveLogs({ code: 200, data: { items: [LOG_201], total: 100 } })
    await p

    expect(useExecutionStore.getState().executionLog).toEqual([])
  })

  it('loadOlderLogs：选中未变化时正常 prepend（回归保护）', async () => {
    useExecutionStore.setState({
      selectedExecutionId: '201',
      executionLog: [],
      logsTotal: 100,
    })
    const p = useExecutionStore.getState().loadOlderLogs()

    resolveLogs({ code: 200, data: { items: [LOG_201], total: 100 } })
    await p

    expect(useExecutionStore.getState().executionLog.map((l) => l.message)).toContain('A 的日志')
  })
})
