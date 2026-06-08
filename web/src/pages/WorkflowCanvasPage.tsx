import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import WorkflowCanvas from '@/features/workflow-canvas/WorkflowCanvas'
import WorkflowConfigPanel from '@/features/workflow-canvas/WorkflowConfigPanel'
import LogViewer from '@/components/LogViewer'
import { useAppStore } from '@/stores/appStore'
import { useIsMobile } from '@/hooks/useMediaQuery'

type TabType = 'params' | 'yaml' | 'logs'

export default function WorkflowCanvasPage() {
  const [rightPanelTab, setRightPanelTab] = useState<TabType>('params')
  const { paramsPanelCollapsed, toggleParamsPanel, mobileParamsOpen, setMobileParamsOpen } = useAppStore()
  const isMobile = useIsMobile()

  // 移动端：底部抽屉式面板
  if (isMobile) {
    return (
      <div className="h-full flex relative">
        {/* 中央画布区域 */}
        <div className="flex-1 relative">
          <WorkflowCanvas />
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
                  <TabButton
                    active={rightPanelTab === 'params'}
                    onClick={() => setRightPanelTab('params')}
                    label="参数"
                  />
                  <TabButton
                    active={rightPanelTab === 'yaml'}
                    onClick={() => setRightPanelTab('yaml')}
                    label="YAML"
                  />
                  <TabButton
                    active={rightPanelTab === 'logs'}
                    onClick={() => setRightPanelTab('logs')}
                    label="日志"
                  />
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
                <div className="flex-1 overflow-hidden">
                  <AnimatePresence mode="wait">
                    {rightPanelTab === 'params' && (
                      <motion.div
                        key="params"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="h-full overflow-auto p-4"
                      >
                        <WorkflowConfigPanel view="params" />
                      </motion.div>
                    )}
                    {rightPanelTab === 'yaml' && (
                      <motion.div
                        key="yaml"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="h-full overflow-auto p-4"
                      >
                        <WorkflowConfigPanel view="yaml" />
                      </motion.div>
                    )}
                    {rightPanelTab === 'logs' && (
                      <motion.div
                        key="logs"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="h-full"
                      >
                        <LogViewer />
                      </motion.div>
                    )}
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
              <TabButton
                active={rightPanelTab === 'params'}
                onClick={() => setRightPanelTab('params')}
                label="参数"
              />
              <TabButton
                active={rightPanelTab === 'yaml'}
                onClick={() => setRightPanelTab('yaml')}
                label="YAML"
              />
              <TabButton
                active={rightPanelTab === 'logs'}
                onClick={() => setRightPanelTab('logs')}
                label="日志"
              />
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
                {rightPanelTab === 'params' && (
                  <motion.div
                    key="params"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full overflow-auto p-4"
                  >
                    <WorkflowConfigPanel view="params" />
                  </motion.div>
                )}
                {rightPanelTab === 'yaml' && (
                  <motion.div
                    key="yaml"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full overflow-auto p-4"
                  >
                    <WorkflowConfigPanel view="yaml" />
                  </motion.div>
                )}
                {rightPanelTab === 'logs' && (
                  <motion.div
                    key="logs"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-full"
                  >
                    <LogViewer />
                  </motion.div>
                )}
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
