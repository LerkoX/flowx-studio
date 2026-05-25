import { motion } from 'framer-motion'
import SpotlightCard from '@/components/SpotlightCard'
import { useNodeStore } from '@/stores/nodeStore'

export default function NodeVisualizer() {
  const { currentNode } = useNodeStore()

  if (!currentNode) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 opacity-30">🤖</div>
          <div className="text-white/40 text-sm">
            通过底部 AI 对话栏描述你的节点需求
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* 节点头部 */}
      <SpotlightCard className="p-6">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-xl"
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}
          >
            {currentNode.icon || '◆'}
          </div>
          <div>
            <h2 className="text-white/90 font-semibold text-lg">{currentNode.name}</h2>
            <p className="text-white/40 text-sm mt-1">{currentNode.description}</p>
          </div>
          <span className="ml-auto text-xs px-3 py-1 rounded-full bg-white/5 text-white/50 border border-white/10">
            {currentNode.language}
          </span>
        </div>
      </SpotlightCard>

      {/* 参数预览 */}
      <SpotlightCard className="p-6">
        <h3 className="text-white/70 font-medium text-sm mb-4">参数</h3>
        <div className="space-y-3">
          {currentNode.parameters.map((param) => (
            <motion.div
              key={param.name}
              className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <code className="text-indigo-400 text-sm font-mono">{param.name}</code>
              <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/40 border border-white/10">
                {param.type}
              </span>
              <span className="text-white/40 text-sm flex-1">{param.description}</span>
              {param.required && (
                <span className="text-rose-400 text-xs">*</span>
              )}
            </motion.div>
          ))}
        </div>
      </SpotlightCard>

      {/* Mock 测试结果 */}
      {currentNode.mockResult && (
        <SpotlightCard className="p-6">
          <h3 className="text-white/70 font-medium text-sm mb-4">Mock 测试结果</h3>
          <div className="rounded-xl bg-black/30 p-4 font-mono text-xs text-white/60 overflow-auto">
            <pre>{JSON.stringify(currentNode.mockResult, null, 2)}</pre>
          </div>
        </SpotlightCard>
      )}
    </div>
  )
}
