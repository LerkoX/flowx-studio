import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronLeft, Play, Pause, Loader2, History } from 'lucide-react'
import WorkflowCanvas, { flushNodeParamsPersist } from '@/features/workflow-canvas/WorkflowCanvas'
import WorkflowConfigPanel from '@/features/workflow-canvas/WorkflowConfigPanel'
import ExecutionContextBar from '@/features/workflow-canvas/ExecutionContextBar'
import ExecutionNodesPanel from '@/features/workflow-canvas/ExecutionNodesPanel'
import { selectExecutionAndSync } from '@/features/workflow-canvas/executionSelection'
import LogViewer from '@/components/LogViewer'
import { useAppStore } from '@/stores/appStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useExecutionStore } from '@/stores/executionStore'
import { runWorkflow, continueExecution, pauseExecution, resumeExecution, getWorkflow } from '@/services/workflowService'
import { parseNodeRefs } from '@/utils/mermaidParser'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useTranslation } from 'react-i18next'
import { toast } from '@/stores/toastStore'

// 编辑态 tab：流水线定义级数据；回放态 tab：单次执行级数据。
// 历史不再作为平级 tab，而是顶部执行上下文条的选择入口
type EditingTab = 'params' | 'yaml' | 'metadata'
type PlaybackTab = 'logs' | 'metadata' | 'yaml' | 'nodes'
type TabType = EditingTab | PlaybackTab

const editingTabs: { key: EditingTab; labelKey: string }[] = [
  { key: 'params', labelKey: 'canvas.tabParams' },
  { key: 'yaml', labelKey: 'canvas.tabYaml' },
  { key: 'metadata', labelKey: 'canvas.tabMetadata' },
]

const playbackTabs: { key: PlaybackTab; labelKey: string }[] = [
  { key: 'logs', labelKey: 'canvas.tabLogs' },
  { key: 'metadata', labelKey: 'canvas.tabMetadata' },
  { key: 'yaml', labelKey: 'canvas.tabYaml' },
  { key: 'nodes', labelKey: 'canvas.tabNodes' },
]

export default function WorkflowCanvasPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<TabType>('params')
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const { paramsPanelCollapsed, toggleParamsPanel, mobileParamsOpen, setMobileParamsOpen } = useAppStore()
  const isMobile = useIsMobile()
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow)
  const setCurrentWorkflow = useWorkflowStore((s) => s.setCurrentWorkflow)
  const params = useWorkflowStore((s) => s.params)
  const isExecuting = useExecutionStore((s) => s.isExecuting)
  const runningExecutionId = useExecutionStore((s) => s.runningExecutionId)
  const selectedExecutionId = useExecutionStore((s) => s.selectedExecutionId)
  const selectedExecution = useExecutionStore((s) => s.selectedExecution)
  const selectedExecutionYaml = useExecutionStore((s) => s.selectedExecutionYaml)
  const executionNodes = useExecutionStore((s) => s.executionNodes)
  const beginContinue = useExecutionStore((s) => s.beginContinue)
  const [starting, setStarting] = useState(false)
  const [pausePending, setPausePending] = useState(false)
  const { id: routeWorkflowId } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  // 回放态 = 已选中某次执行；执行是回放态下其他 tab 的数据主体
  const isPlayback = !!selectedExecutionId
  const tabs = isPlayback ? playbackTabs : editingTabs

  // 回放态下图中尚未执行的节点（YAML Nodes 键即图节点 ID）。
  // 优先基于该执行的快照 YAML 判定（执行实例与模板解耦后，快照才是
  // 该执行的图真相）；无快照的旧执行回退用模板
  const selectedFinished =
    !!selectedExecution && ['success', 'failed', 'cancelled'].includes(selectedExecution.status)
  const pendingNodeIds = useMemo(() => {
    if (!isPlayback) return []
    const source = selectedExecutionYaml || currentWorkflow?.yamlConfig
    if (!source) return []
    const refs = parseNodeRefs(source)
    const executed = new Set(executionNodes.map((n) => n.nodeId))
    return Object.keys(refs).filter((id) => !executed.has(id))
  }, [isPlayback, selectedExecutionYaml, currentWorkflow?.yamlConfig, executionNodes])

  // 运行按钮三态：
  // - 未选中执行：全新运行
  // - 选中已结束执行 + 图中有新增节点：续跑该执行
  // - 选中已结束执行 + 无新增节点：禁用（无节点可跑）
  const continueMode = isPlayback && selectedFinished && pendingNodeIds.length > 0
  const runDisabled = !currentWorkflow || starting || isExecuting || (isPlayback && !continueMode)

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
      if (isPlayback && prev === 'params') return 'logs'
      if (!isPlayback && (prev === 'logs' || prev === 'nodes')) return 'params'
      return prev
    })
  }, [isPlayback])

  // 前端不提供流水线编辑界面，无 ID 的空画布无意义，重定向回列表页。
  // 重定向判断放在所有 hooks 之后：/canvas 与 /canvas/:id 共用本组件，
  // 参数变化不触发卸载，提前 return 会破坏 hooks 顺序
  if (!routeWorkflowId) return <Navigate to="/" replace />

  // 内页运行：携带参数面板中的参数触发执行，SSE 事件会驱动画布状态与日志，
  // 运行后自动进入新执行的回放态（execution.started 事件会设置 selectedExecutionId）
  const handleRun = async () => {
    if (!currentWorkflow || starting || isExecuting) return
    setStarting(true)
    try {
      // 节点 UI 参数写回有 800ms 防抖：防抖窗口内运行会读到 DB 旧参数，先冲刷
      await flushNodeParamsPersist()
      if (isPlayback) {
        // 回放态续跑：执行实例是独立个体，图以 DB 中的运行时快照为准——
        // 有快照时不带 YAML（纯增量重跑未执行节点）；
        // 无快照的旧执行回退带模板 YAML（后端会报「无快照无法续跑」）
        if (!continueMode || !selectedExecutionId) return
        if (selectedExecutionYaml) {
          await continueExecution(selectedExecutionId)
        } else {
          await continueExecution(selectedExecutionId, currentWorkflow!.yamlConfig)
        }
        beginContinue(selectedExecutionId)
      } else {
        const runParams: Record<string, unknown> = {}
        Object.values(params).forEach((p) => {
          runParams[p.key] = p.value
        })
        await runWorkflow(currentWorkflow.id, runParams)
      }
      setTab('logs')
      if (isMobile) setMobileParamsOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  // 暂停/恢复：以选中执行的状态为准（running/paused），不依赖 isExecuting——
  // 浏览器刷新后 isExecuting 重置为 false，但 paused 执行仍需要恢复入口。
  // 状态由 SSE（execution_paused/execution_resumed）回写 selectedExecution.status，
  // 暂停为层边界生效——点击后当前层节点跑完才挂起，按钮先行进入 pending 反馈
  const liveExecutionId = selectedExecutionId ?? runningExecutionId
  const selectedStatus = selectedExecution?.status
  const isPaused = selectedStatus === 'paused'
  const showPauseResume =
    !!liveExecutionId && (selectedStatus === 'running' || selectedStatus === 'paused')
  const handlePauseResume = async () => {
    if (!liveExecutionId || pausePending) return
    setPausePending(true)
    try {
      if (isPaused) {
        await resumeExecution(liveExecutionId)
      } else {
        await pauseExecution(liveExecutionId)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setPausePending(false)
    }
  }
  const pauseResumeButton = showPauseResume ? (
    <button
      onClick={handlePauseResume}
      disabled={pausePending}
      className="flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0
                 text-amber-300 hover:bg-amber-400/15
                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title={isPaused ? t('canvas.resumeExecution') : t('canvas.pauseExecution')}
    >
      {pausePending ? (
        <Loader2 size={13} className="animate-spin" />
      ) : isPaused ? (
        <Play size={13} className="ml-px" />
      ) : (
        <Pause size={13} />
      )}
    </button>
  ) : null

  // 运行按钮渲染在画布顶部工具栏内（与流水线名/ID、方向切换按钮并排）。
  // 移动端为图标-only 按钮，桌面端保留文字
  const runTitle = isPlayback
    ? continueMode
      ? t('canvas.continueExecution')
      : t('canvas.noNewNodes')
    : isExecuting
      ? t('canvas.executing')
      : t('canvas.runPipeline')
  const runButton = currentWorkflow ? (
    isMobile ? (
      <button
        onClick={handleRun}
        disabled={runDisabled}
        className="flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0
                   bg-indigo-500/80 hover:bg-indigo-500 text-on-accent
                   disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title={runTitle}
      >
        {starting || isExecuting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} className="ml-px" />}
      </button>
    ) : (
      <button
        onClick={handleRun}
        disabled={runDisabled}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md flex-shrink-0
                   bg-indigo-500/80 hover:bg-indigo-500 text-on-accent text-xs font-medium
                   disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title={runTitle}
      >
        {starting || isExecuting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        {starting || isExecuting
          ? t('canvas.executing')
          : continueMode
            ? t('canvas.continueRun')
            : t('common.run')}
      </button>
    )
  ) : null

  // 顶部工具栏动作区：运行/续跑按钮 + 实时执行时的暂停/恢复按钮
  const canvasAction =
    runButton || pauseResumeButton ? (
      <>
        {runButton}
        {pauseResumeButton}
      </>
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

  // 顶部工具栏「当前执行」徽标/历史按钮：展开历史执行下拉。
  // 桌面端需确保右侧面板展开，移动端打开底部抽屉（与底部历史入口行为一致）
  const handleShowHistory = () => {
    setSwitcherOpen(true)
    if (isMobile) {
      setMobileParamsOpen(true)
    } else if (paramsPanelCollapsed) {
      toggleParamsPanel()
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
          <WorkflowCanvas action={canvasAction} onShowHistory={handleShowHistory} />
        </div>

        {/* 移动端底部标签栏：当前模式的 tab + 历史执行入口 */}
        <div className="fixed inset-x-0 bottom-0 z-50 h-12
                        bg-panel/95 backdrop-blur-2xl border-t border-white/10
                        flex items-center justify-around px-2 pb-safe">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => {
                if (tab === tabItem.key && mobileParamsOpen) {
                  setMobileParamsOpen(false)
                } else {
                  setTab(tabItem.key)
                  setMobileParamsOpen(true)
                }
              }}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === tabItem.key && mobileParamsOpen
                  ? 'text-indigo-300'
                  : 'text-white/50'
              }`}
            >
              {t(tabItem.labelKey)}
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
            {t('canvas.history')}
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
                           bg-panel/95 backdrop-blur-2xl
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
                  {tabs.map((tabItem) => (
                    <TabButton
                      key={tabItem.key}
                      active={tab === tabItem.key}
                      onClick={() => setTab(tabItem.key)}
                      label={t(tabItem.labelKey)}
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
        <WorkflowCanvas action={canvasAction} onShowHistory={handleShowHistory} />
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
              {tabs.map((tabItem) => (
                <TabButton
                  key={tabItem.key}
                  active={tab === tabItem.key}
                  onClick={() => setTab(tabItem.key)}
                  label={t(tabItem.labelKey)}
                />
              ))}
              {/* 收起按钮 */}
              <button
                onClick={toggleParamsPanel}
                className="px-3 flex items-center justify-center
                         text-white/40 hover:text-white/70
                         hover:bg-white/5 transition-colors"
                title={t('canvas.collapsePanel')}
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
            title={t('canvas.expandPanel')}
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
      )}
    </button>
  )
}
