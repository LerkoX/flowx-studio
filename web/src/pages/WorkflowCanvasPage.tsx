import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronLeft, Play, Loader2, History } from 'lucide-react'
import WorkflowCanvas from '@/features/workflow-canvas/WorkflowCanvas'
import WorkflowConfigPanel from '@/features/workflow-canvas/WorkflowConfigPanel'
import ExecutionContextBar from '@/features/workflow-canvas/ExecutionContextBar'
import ExecutionNodesPanel from '@/features/workflow-canvas/ExecutionNodesPanel'
import { selectExecutionAndSync } from '@/features/workflow-canvas/executionSelection'
import LogViewer from '@/components/LogViewer'
import { useAppStore } from '@/stores/appStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useExecutionStore } from '@/stores/executionStore'
import { runWorkflow, getWorkflow } from '@/services/workflowService'
import { useIsMobile } from '@/hooks/useMediaQuery'

// 编辑态 tab：流水线定义级数据；回放态 tab：单次执行级数据。
// 历史不再作为平级 tab，而是顶部执行上下文条的选择入口
type EditingTab = 'params' | 'yaml' | 'metadata'
type PlaybackTab = 'logs' | 'metadata' | 'nodes'
type TabType = EditingTab | PlaybackTab

const editingTabs: { key: EditingTab; label: string }[] = [
  { key: 'params', label: '参数' },
  { key: 'yaml', label: 'YAML' },
  { key: 'metadata', label: '元数据' },
]

const playbackTabs: { key: PlaybackTab; label: string }[] = [
  { key: 'logs', label: '日志' },
  { key: 'metadata', label: '元数据' },
  { key: 'nodes', label: '节点' },
]

export default function WorkflowCanvasPage() {
  const [tab, setTab] = useState<TabType>('params')
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const { paramsPanelCollapsed, toggleParamsPanel, mobileParamsOpen, setMobileParamsOpen } = useAppStore()
  const isMobile = useIsMobile()
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow)
  const setCurrentWorkflow = useWorkflowStore((s) => s.setCurrentWorkflow)
  const params = useWorkflowStore((s) => s.params)
  const isExecuting = useExecutionStore((s) => s.isExecuting)
  const selectedExecutionId = useExecutionStore((s) => s.selectedExecutionId)
  const selectedExecution = useExecutionStore((s) => s.selectedExecution)
  const [starting, setStarting] = useState(false)
  const { id: routeWorkflowId } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  // 回放态 = 已选中某次执行；执行是回放态下其他 tab 的数据主体
  const isPlayback = !!selectedExecutionId
  const tabs = isPlayback ? playbackTabs : editingTabs

  // 路由携带工作流 ID：浏览器刷新后内存中的 currentWorkflow 丢失，
  // 此处按 URL 中的 id 重新拉取并恢复，保证刷新后仍停留在流水线内页
  useEffect(() => {
    if (!routeWorkflowId) return
    if (currentWorkflow && String(currentWorkflow.id) === routeWorkflowId) return
    let cancelled = false
    getWorkflow(routeWorkflowId)
      .then((resp) => {
        if (cancelled || !resp.data) return
        setCurrentWorkflow({ ...resp.data, id: String(resp.data.id) })
      })
      .catch((err) => console.error('Failed to restore workflow:', err))
    return () => {
      cancelled = true
    }
  }, [routeWorkflowId, currentWorkflow, setCurrentWorkflow])

  // URL 携带 ?execution=xx：刷新后恢复回放态
  useEffect(() => {
    const routeExecutionId = searchParams.get('execution')
    if (!routeExecutionId || routeExecutionId === selectedExecutionId) return
    selectExecutionAndSync(routeExecutionId)
    // 仅在 URL 执行 id 变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // 选中执行变化时回写 URL（replace，不产生历史记录堆叠）
  // 注意读取 getState() 实时状态：挂载时上面的恢复 effect 已同步设置 selectedExecutionId，
  // 此处若用渲染快照（仍为 null）会误清 URL 参数
  useEffect(() => {
    const routeExecutionId = searchParams.get('execution')
    const currentId = useExecutionStore.getState().selectedExecutionId
    if (currentId && currentId !== routeExecutionId) {
      setSearchParams({ execution: currentId }, { replace: true })
    } else if (!currentId && routeExecutionId) {
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExecutionId])

  // 切换流水线时若选中的执行属于其他流水线，退出回放态
  useEffect(() => {
    if (
      routeWorkflowId &&
      selectedExecution?.workflowId &&
      selectedExecution.workflowId !== routeWorkflowId
    ) {
      selectExecutionAndSync(null)
    }
  }, [routeWorkflowId, selectedExecution?.workflowId])

  // 模式切换时校正 tab：进入回放态默认看日志，回到编辑态默认看参数
  useEffect(() => {
    setTab((prev) => {
      if (isPlayback && (prev === 'params' || prev === 'yaml')) return 'logs'
      if (!isPlayback && (prev === 'logs' || prev === 'nodes')) return 'params'
      return prev
    })
  }, [isPlayback])

  // 内页运行：携带参数面板中的参数触发执行，SSE 事件会驱动画布状态与日志，
  // 运行后自动进入新执行的回放态（execution.started 事件会设置 selectedExecutionId）
  const handleRun = async () => {
    if (!currentWorkflow || starting || isExecuting) return
    setStarting(true)
    try {
      const runParams: Record<string, unknown> = {}
      Object.values(params).forEach((p) => {
        runParams[p.key] = p.value
      })
      await runWorkflow(currentWorkflow.id, runParams)
      setTab('logs')
      if (isMobile) setMobileParamsOpen(true)
    } catch (err) {
      console.error('Failed to run workflow:', err)
    } finally {
      setStarting(false)
    }
  }

  // 运行按钮渲染在画布右上角的 Panel 行内（与流水线名、方向切换按钮并排），
  // 不再使用绝对定位，避免遮挡状态面板
  const runButton = currentWorkflow ? (
    <button
      onClick={handleRun}
      disabled={starting || isExecuting}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                 bg-indigo-500/80 hover:bg-indigo-500 text-white text-xs font-medium
                 backdrop-blur-xl border border-indigo-400/30 shadow-lg shadow-indigo-500/20
                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title={isExecuting ? '执行中' : '运行流水线'}
    >
      {starting || isExecuting ? <Loader2 size={isMobile ? 13 : 14} className="animate-spin" /> : <Play size={isMobile ? 13 : 14} />}
      {isExecuting ? '执行中' : '运行'}
    </button>
  ) : null

  const renderTabContent = () => {
    switch (tab) {
      case 'logs':
        return <LogViewer />
      case 'nodes':
        return <ExecutionNodesPanel onNodeFiltered={() => setTab('logs')} />
      case 'yaml':
      case 'metadata':
      case 'params':
      default:
        return <WorkflowConfigPanel view={tab} />
    }
  }

  const contextBar = (
    <ExecutionContextBar
      workflowId={currentWorkflow?.id || routeWorkflowId}
      open={switcherOpen}
      onOpenChange={setSwitcherOpen}
    />
  )

  // 移动端：底部抽屉式面板
  if (isMobile) {
    return (
      <div className="h-full flex relative">
        {/* 中央画布区域 */}
        <div className="flex-1 relative">
          <WorkflowCanvas action={runButton} />
        </div>

        {/* 移动端底部标签栏：当前模式的 tab + 历史执行入口 */}
        <div className="fixed inset-x-0 bottom-0 z-50 h-12
                        bg-[#0f172a]/95 backdrop-blur-2xl border-t border-white/10
                        flex items-center justify-around px-2 pb-safe">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                if (tab === t.key && mobileParamsOpen) {
                  setMobileParamsOpen(false)
                } else {
                  setTab(t.key)
                  setMobileParamsOpen(true)
                }
              }}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === t.key && mobileParamsOpen
                  ? 'text-indigo-300'
                  : 'text-white/50'
              }`}
            >
              {t.label}
            </button>
          ))}
          {/* 历史执行入口：打开抽屉并展开执行选择器 */}
          <button
            onClick={() => {
              setSwitcherOpen(true)
              setMobileParamsOpen(true)
            }}
            className={`flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
              switcherOpen && mobileParamsOpen ? 'text-indigo-300' : 'text-white/50'
            }`}
          >
            <History size={13} />
            历史
          </button>
        </div>

        {/* 遮罩层：不放进 AnimatePresence，关闭时立即从 DOM 移除。
            若参与退出动画编排，移动端时序下偶发退出不完成、元素以 opacity:0
            残留 DOM，不可见但仍拦截整个画布的触摸事件 */}
        {mobileParamsOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileParamsOpen(false)}
          />
        )}

        {/* 移动端参数面板抽屉 */}
        <AnimatePresence>
          {mobileParamsOpen && (
              <motion.div
                key="params-drawer"
                className="fixed inset-x-0 bottom-0 z-30 h-[75vh]
                           bg-[#0f172a]/95 backdrop-blur-2xl
                           border-t border-white/10 rounded-t-2xl
                           flex flex-col"
                // 关闭期间立即禁用指针事件：即使退出动画被打断导致元素残留，
                // 也不会拦截画布触摸
                style={{ pointerEvents: mobileParamsOpen ? 'auto' : 'none' }}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              >
                {/* 执行上下文条 */}
                {contextBar}

                {/* 标签切换 */}
                <div className="flex border-b border-white/10 items-center">
                  {tabs.map((t) => (
                    <TabButton
                      key={t.key}
                      active={tab === t.key}
                      onClick={() => setTab(t.key)}
                      label={t.label}
                    />
                  ))}
                  <button
                    onClick={() => setMobileParamsOpen(false)}
                    className="px-4 flex items-center justify-center
                             text-white/40 hover:text-white/70
                             hover:bg-white/5 transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                {/* 面板内容 */}
                <div className="flex-1 overflow-hidden pb-14">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`${isPlayback ? 'playback' : 'editing'}-${tab}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`h-full ${tab === 'logs' ? 'pb-14' : 'overflow-auto p-4 pb-14'}`}
                    >
                      {renderTabContent()}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  // 桌面端布局
  return (
    <div className="h-full flex relative">
      {/* 中央画布区域 */}
      <div className="flex-1 relative">
        <WorkflowCanvas action={runButton} />
      </div>

      {/* 右侧面板 */}
      <AnimatePresence initial={false}>
        {!paramsPanelCollapsed && (
          <motion.div
            className="flex-shrink-0 border-l border-white/10
                       bg-white/5 backdrop-blur-2xl flex flex-col"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 400, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* 执行上下文条：选择历史执行进入回放态 */}
            {contextBar}

            {/* 标签切换 */}
            <div className="flex border-b border-white/10">
              {tabs.map((t) => (
                <TabButton
                  key={t.key}
                  active={tab === t.key}
                  onClick={() => setTab(t.key)}
                  label={t.label}
                />
              ))}
              {/* 收起按钮 */}
              <button
                onClick={toggleParamsPanel}
                className="px-3 flex items-center justify-center
                         text-white/40 hover:text-white/70
                         hover:bg-white/5 transition-colors"
                title="收起参数面板"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* 面板内容 */}
            <div className="flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${isPlayback ? 'playback' : 'editing'}-${tab}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`h-full ${tab === 'logs' ? '' : 'overflow-auto p-4'}`}
                >
                  {renderTabContent()}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 参数面板收起后的展开按钮 */}
      <AnimatePresence>
        {paramsPanelCollapsed && (
          <motion.button
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            onClick={toggleParamsPanel}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-40
                     w-6 h-16 flex items-center justify-center
                     bg-white/5 hover:bg-white/10
                     border border-white/10 rounded-l-lg
                     text-white/40 hover:text-white/70
                     transition-colors"
            title="展开参数面板"
          >
            <ChevronLeft className="w-4 h-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex-1 py-3 text-sm font-medium transition-all relative
        ${active ? 'text-white' : 'text-white/40 hover:text-white/60'}
      `}
    >
      {label}
      {active && (
        <motion.div
          className="absolute bottom-0 left-4 right-4 h-[2px] bg-gradient-to-r from-indigo-400 to-purple-400 rounded-full"
          layoutId="workflowTab"
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        />
      )}
    </button>
  )
}
