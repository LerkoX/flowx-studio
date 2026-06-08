import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import NodeVisualizer from '@/features/node-visualization/NodeVisualizer'
import NodeConfigPanel from '@/features/node-visualization/NodeConfigPanel'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useAppStore } from '@/stores/appStore'

export default function NodeGeneratorPage() {
  const [rightPanelTab, setRightPanelTab] = useState<'params' | 'code' | 'mock'>('params')
  const { mobileParamsOpen, setMobileParamsOpen } = useAppStore()
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div className="h-full flex relative">
        {/* 中央节点可视化区域 */}
        <div className="flex-1 relative p-4 overflow-auto">
          <NodeVisualizer />
        </div>

        {/* 移动端参数面板抽屉 */}
        <AnimatePresence>
          {mobileParamsOpen && (
            <>
              <motion.div
                key="node-overlay"
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileParamsOpen(false)}
              />
              <motion.div
                key="node-drawer"
                className="fixed inset-x-0 bottom-0 z-40 h-[75vh]
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
                  {[
                    { key: 'params' as const, label: '参数' },
                    { key: 'code' as const, label: '代码' },
                    { key: 'mock' as const, label: 'Mock' },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setRightPanelTab(tab.key)}
                      className={`
                        flex-1 py-3 text-sm font-medium transition-all relative
                        ${rightPanelTab === tab.key ? 'text-white' : 'text-white/40 hover:text-white/60'}
                      `}
                    >
                      {tab.label}
                      {rightPanelTab === tab.key && (
                        <motion.div
                          className="absolute bottom-0 left-4 right-4 h-[2px] bg-gradient-to-r from-indigo-400 to-purple-400 rounded-full"
                          layoutId="nodeTabMobile"
                        />
                      )}
                    </button>
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
                <div className="flex-1 overflow-auto p-4">
                  <NodeConfigPanel tab={rightPanelTab} />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="h-full flex relative">
      {/* 中央节点可视化区域 */}
      <div className="flex-1 relative p-6 overflow-auto">
        <NodeVisualizer />
      </div>

      {/* 右侧面板（参数 / 代码 / Mock 切换） */}
      <motion.div
        className="w-[400px] flex-shrink-0 border-l border-white/10
                   bg-white/5 backdrop-blur-2xl flex flex-col"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        {/* 标签切换 */}
        <div className="flex border-b border-white/10">
          {[
            { key: 'params' as const, label: '参数' },
            { key: 'code' as const, label: '代码' },
            { key: 'mock' as const, label: 'Mock' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setRightPanelTab(tab.key)}
              className={`
                flex-1 py-3 text-sm font-medium transition-all relative
                ${rightPanelTab === tab.key ? 'text-white' : 'text-white/40 hover:text-white/60'}
              `}
            >
              {tab.label}
              {rightPanelTab === tab.key && (
                <motion.div
                  className="absolute bottom-0 left-4 right-4 h-[2px] bg-gradient-to-r from-indigo-400 to-purple-400 rounded-full"
                  layoutId="nodeTab"
                />
              )}
            </button>
          ))}
        </div>

        {/* 面板内容 */}
        <div className="flex-1 overflow-auto p-4">
          <NodeConfigPanel tab={rightPanelTab} />
        </div>
      </motion.div>
    </div>
  )
}
