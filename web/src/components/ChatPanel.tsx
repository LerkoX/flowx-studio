import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChatStore } from '@/stores/chatStore'
import ChatMessage from './ChatMessage'
import StreamingText from './StreamingText'

interface ChatPanelProps {
  compact?: boolean
}

export default function ChatPanel({ compact = false }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { messages, isGenerating, streamingContent } = useChatStore()

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingContent])

  return (
    <div className={`flex flex-col h-full ${compact ? '' : 'pb-32'}`}>
      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {/* 欢迎消息 */}
        {messages.length === 0 && (
          <WelcomeMessage />
        )}

        {/* 历史消息 */}
        <AnimatePresence>
          {messages.map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25, delay: index * 0.05 }}
            >
              <ChatMessage message={message} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* 流式输出 */}
        {isGenerating && streamingContent && (
          <StreamingText content={streamingContent} />
        )}

        {/* 加载指示器 */}
        {isGenerating && !streamingContent && (
          <LoadingIndicator />
        )}
      </div>
    </div>
  )
}

function WelcomeMessage() {
  return (
    <div className="text-center py-8">
      <motion.div
        className="text-4xl mb-4"
        animate={{ rotate: [0, 10, -10, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        🤖
      </motion.div>
      <h2 className="text-white/90 font-semibold mb-2">FlowX AI 助手</h2>
      <p className="text-white/40 text-sm max-w-xs mx-auto">
        告诉我你想要什么工作流或节点，我会帮你生成、编排和测试
      </p>
    </div>
  )
}

function LoadingIndicator() {
  return (
    <div className="flex items-center gap-2 text-white/40 text-sm">
      <div className="flex gap-1">
        {[0, 150, 300].map((delay) => (
          <motion.span
            key={delay}
            className="w-2 h-2 bg-indigo-400 rounded-full"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: delay / 1000 }}
          />
        ))}
      </div>
      <span>AI 正在思考...</span>
    </div>
  )
}
