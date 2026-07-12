import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Play, Flag } from 'lucide-react'

interface TerminalNodeData {
  id: string
  name: string
  direction?: 'TB' | 'LR'
}

const TerminalNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as TerminalNodeData
  const isStart = nodeData.id === '__start__'
  const Icon = isStart ? Play : Flag
  const isHorizontal = nodeData.direction === 'LR'

  const targetPosition = isHorizontal ? Position.Left : Position.Top
  const sourcePosition = isHorizontal ? Position.Right : Position.Bottom

  return (
    <div className="flex flex-col items-center gap-1">
      {/* 输入连接点（结束节点需要） */}
      {!isStart && (
        <Handle
          type="target"
          position={targetPosition}
          id="target"
          className="w-2 h-2 !bg-white/20 !border-white/30"
        />
      )}

      {/* 圆形节点 */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center
                   bg-white/10 border border-white/20 backdrop-blur-xl
                   shadow-[0_0_12px_rgba(99,102,241,0.25)]"
      >
        <Icon className="w-4 h-4 text-white/80" fill="currentColor" />
      </div>

      <span className="text-[10px] text-white/50 whitespace-nowrap">
        {nodeData.name}
      </span>

      {/* 输出连接点（开始节点需要） */}
      {isStart && (
        <Handle
          type="source"
          position={sourcePosition}
          id="source"
          className="w-2 h-2 !bg-white/20 !border-white/30"
        />
      )}
    </div>
  )
})


TerminalNode.displayName = 'TerminalNode'

export default TerminalNode
