import { useState } from 'react'
import { motion } from 'framer-motion'
import NodeVisualizer from '@/features/node-visualization/NodeVisualizer'
import NodeConfigPanel from '@/features/node-visualization/NodeConfigPanel'

export default function NodeGeneratorPage() {
  const [rightPanelTab, setRightPanelTab] = useState<'params' | 'code' | 'mock'>('params')

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
