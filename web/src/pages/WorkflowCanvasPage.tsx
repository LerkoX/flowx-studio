import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronLeft, Play, Loader2 } from 'lucide-react'
import WorkflowCanvas from '@/features/workflow-canvas/WorkflowCanvas'
import WorkflowConfigPanel from '@/features/workflow-canvas/WorkflowConfigPanel'
import LogViewer from '@/components/LogViewer'
import { useAppStore } from '@/stores/appStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useExecutionStore } from '@/stores/executionStore'
import { runWorkflow } from '@/services/workflowService'
import { useIsMobile } from '@/hooks/useMediaQuery'

type TabType = 'params' | 'yaml' | 'metadata' | 'history' | 'logs'

export default function WorkflowCanvasPage() {
  const [rightPanelTab, setRightPanelTab] = useState<TabType>('params')
  const { paramsPanelCollapsed, toggleParamsPanel, mobileParamsOpen, setMobileParamsOpen } = useAppStore()
  const isMobile = useIsMobile()
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow)
  const params = useWorkflowStore((s) => s.params)
  const isExecuting = useExecutionStore((s) => s.isExecuting)
  const [starting, setStarting] = useState(false)

  // 内页运行：携带参数面板中的参数触发执行，SSE 事件会驱动画布状态与日志，
  // 运行后自动切到日志标签
  const handleRun = async () => {
    if (!currentWorkflow || starting || isExecuting) return
    setStarting(true)
    try {
      const runParams: Record<string, unknown> = {}
      Object.values(params).forEach((p) => {
        runParams[p.key] = p.value
      })
      await runWorkflow(currentWorkflow.id, runParams)
      setRightPanelTab('logs')
      if (isMobile) setMobileParamsOpen(true)
    } catch (err) {
      console.error('Failed to run workflow:', err)
    } finally {
      setStarting(false)
    }
  }

  const runButton = currentWorkflow ? (
    <button
      onClick={handleRun}
      disabled={starting || isExecuting}
      className="absolute top-3 right-3 z-40 flex items-center gap-1.5 px-4 py-2 rounded-xl
                 bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium
                 backdrop-blur-xl border border-indigo-400/30 shadow-lg shadow-indigo-500/20
                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title={isExecuting ? '执行中' : '运行流水线'}
    >
      {starting || isExecuting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
      {isExecuting ? '执行中' : '运行'}
    </button>
  ) : null

  const tabs: { key: TabType; label: string }[] = [
    { key: 'params', label: '参数' },
    { key: 'yaml', label: 'YAML' },
    { key: 'metadata', label: '元数据' },
    { key: 'history', label: '历史' },
    { key: 'logs', label: '日志' },
  ]

  const renderTabContent = () => {
    switch (rightPanelTab) {
      case 'logs':
        return <LogViewer />
      case 'yaml':
      case 'metadata':
      case 'history':
      case 'params':
      default:
        return <WorkflowConfigPanel view={rightPanelTab} />
    }
  }

  // 移动端：底部抽屉式面板
  if (isMobile) {
    return (
      <div className="h-full flex relative">
        {/* 中央画布区域 */}
        <div className="flex-1 relative">
          <WorkflowCanvas />
          {runButton}
        </div>

        {/* 移动端底部标签栏 */}
        <div className="fixed inset-x-0 bottom-0 z-50 h-12
                        bg-[#0f172a]/95 backdrop-blur-2xl border-t border-white/10
                        flex items-center justify-around px-2 pb-safe">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                if (rightPanelTab === tab.key && mobileParamsOpen) {
                  setMobileParamsOpen(false)
                } else {
                  setRightPanelTab(tab.key)
                  setMobileParamsOpen(true)
                }
              }}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                rightPanelTab === tab.key && mobileParamsOpen
                  ? 'text-indigo-300'
                  : 'text-white/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 移动端参数面板抽屉 */}
        <AnimatePresence>
          {mobileParamsOpen && (
            <>
              <motion.div
                key="params-overlay"
                className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileParamsOpen(false)}
              />
              <motion.div
                key="params-drawer"
                className="fixed inset-x-0 bottom-0 z-30 h-[75vh]
                           bg-[#0f172a]/95 backdrop-blur-2xl
                           border-t border-white/10 rounded-t-2xl
                           flex flex-col"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              >
                {/* 标签切换 */}
                <div className="flex border-b border-white/10 items-center">
                  {tabs.map((tab) => (
                    <TabButton
                      key={tab.key}
                      active={rightPanelTab === tab.key}
                      onClick={() => setRightPanelTab(tab.key)}
                      label={tab.label}
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
                      key={rightPanelTab}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`h-full ${rightPanelTab === 'logs' ? 'pb-14' : 'overflow-auto p-4 pb-14'}`}
                    >
                      {renderTabContent()}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </>
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
        <WorkflowCanvas />
        {runButton}
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
            {/* 标签切换 */}
            <div className="flex border-b border-white/10">
              {tabs.map((tab) => (
                <TabButton
                  key={tab.key}
                  active={rightPanelTab === tab.key}
                  onClick={() => setRightPanelTab(tab.key)}
                  label={tab.label}
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
                  key={rightPanelTab}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`h-full ${rightPanelTab === 'logs' ? '' : 'overflow-auto p-4'}`}
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
