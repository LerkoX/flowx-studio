import { motion } from 'framer-motion'
import { GitBranch, Container, Code, Trash2, Eye } from 'lucide-react'
import type { NodeDefinition } from '@/types/node'

interface NodeCardProps {
  node: NodeDefinition
  onView: (node: NodeDefinition) => void
  onDelete: (nodeId: string) => void
}

export default function NodeCard({ node, onView, onDelete }: NodeCardProps) {
  const isImageNode = node.nodeType === 'image'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className="relative group rounded-2xl bg-white/[0.05] border border-white/10 
                 hover:border-white/20 hover:bg-white/[0.08] transition-all duration-300
                 p-5 flex flex-col gap-3"
    >
      {/* 头部：图标 + 名称 */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 
                        flex items-center justify-center text-xl flex-shrink-0">
          {node.icon || (isImageNode ? '🐳' : '⚙️')}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-white/90 font-semibold text-sm truncate">
            {node.displayName || node.name}
          </h3>
          <p className="text-white/40 text-xs mt-0.5 line-clamp-2">
            {node.description || '暂无描述'}
          </p>
        </div>
      </div>

      {/* 类型标签 */}
      <div className="flex items-center gap-2 flex-wrap">
        {isImageNode ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full 
                           bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Container size={10} />
            镜像节点
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full 
                           bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Code size={10} />
            {node.language || 'code'}
          </span>
        )}
        <span className="text-[10px] text-white/30">
          v{node.version || '1.0.0'}
        </span>
      </div>

      {/* 镜像地址（仅镜像节点） */}
      {isImageNode && node.image && (
        <div className="flex items-center gap-1.5 text-xs">
          <Container size={12} className="text-blue-400 flex-shrink-0" />
          <span className="text-blue-400/80 font-mono truncate">{node.image}</span>
        </div>
      )}

      {/* Git 地址（仅代码节点且有来源） */}
      {!isImageNode && node.sourceURL && (
        <div className="flex items-center gap-1.5 text-xs">
          <GitBranch size={12} className="text-white/30 flex-shrink-0" />
          <span className="text-white/30 font-mono truncate">{node.sourceURL}</span>
        </div>
      )}

      {/* 标签 */}
      {node.tags && node.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {node.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40 
                       border border-white/5"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-auto pt-2 border-t border-white/5">
        <button
          onClick={() => onView(node)}
          className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg
                     bg-white/5 text-white/60 hover:bg-white/10 hover:text-white
                     transition-all"
        >
          <Eye size={12} />
          查看
        </button>
        <button
          onClick={() => onDelete(node.id)}
          className="flex items-center gap-1 text-[11px] px-3 py-1.5 rounded-lg
                     bg-rose-500/5 text-rose-400 hover:bg-rose-500/10 
                     transition-all ml-auto"
        >
          <Trash2 size={12} />
          删除
        </button>
      </div>
    </motion.div>
  )
}
