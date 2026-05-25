import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import WorkflowCanvas from '@/features/workflow-canvas/WorkflowCanvas'
import WorkflowConfigPanel from '@/features/workflow-canvas/WorkflowConfigPanel'

export default function WorkflowCanvasPage() {
  const [rightPanelTab, setRightPanelTab] = useState<'graph' | 'yaml'>('graph')

  return (
    <div className="h-full flex relative">
      {/* 中央画布区域 */}
      <div className="flex-1 relative">
        <WorkflowCanvas />
      </div>

      {/* 右侧面板（工作流图 / YAML 切换） */}
      <motion.div
        className="w-[400px] flex-shrink-0 border-l border-white/10
                   bg-white/5 backdrop-blur-2xl flex flex-col"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        {/* 标签切换 */}
        <div className="flex border-b border-white/10">
          <TabButton
            active={rightPanelTab === 'graph'}
            onClick={() => setRightPanelTab('graph')}
            label="流程图"
          />
          <TabButton
            active={rightPanelTab === 'yaml'}
            onClick={() => setRightPanelTab('yaml')}
            label="YAML"
          />
        </div>

        {/* 面板内容 */}
        <div className="flex-1 overflow-auto p-4">
          <AnimatePresence mode="wait">
            {rightPanelTab === 'graph' ? (
              <motion.div
                key="graph"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <WorkflowConfigPanel view="graph" />
              </motion.div>
            ) : (
              <motion.div
                key="yaml"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <WorkflowConfigPanel view="yaml" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
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
