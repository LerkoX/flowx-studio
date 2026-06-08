import { motion } from 'framer-motion'
import { Bot, User } from 'lucide-react'
import type { ChatMessage as ChatMessageType } from '@/types/ai'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useIsMobile } from '@/hooks/useMediaQuery'

interface ChatMessageProps {
  message: ChatMessageType
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isMobile = useIsMobile()

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* 头像 */}
      <div
        className={`rounded-full flex items-center justify-center flex-shrink-0 ${
          isMobile ? 'w-7 h-7' : 'w-8 h-8'
        } ${
          isUser
            ? 'bg-white/10'
            : 'bg-gradient-to-br from-indigo-500 to-purple-500'
        }`}
      >
        {isUser ? <User size={isMobile ? 14 : 16} className="text-white/70" /> : <Bot size={isMobile ? 14 : 16} className="text-white" />}
      </div>

      {/* 消息内容 */}
      <div
        className={`rounded-2xl px-3 py-2 ${
          isMobile ? 'max-w-[85%]' : 'max-w-[80%]'
        } ${
          isUser
            ? 'bg-indigo-500/20 border border-indigo-500/30'
            : 'bg-white/5 border border-white/10'
        }`}
      >
        <div className={`text-white/90 prose prose-invert max-w-none ${isMobile ? 'prose-sm text-xs' : 'prose-sm'}`}>
          <ReactMarkdown
            components={{
              code({ node, inline, className, children, ...props }: {
                node?: unknown
                inline?: boolean
                className?: string
                children?: React.ReactNode
              } & React.HTMLAttributes<HTMLElement>) {
                const match = /language-(\w+)/.exec(className || '')
                return !inline && match ? (
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language={match[1]}
                    PreTag="div"
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className="bg-white/10 rounded px-1 py-0.5 text-xs" {...props}>
                    {children}
                  </code>
                )
              }
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        <div className={`text-white/30 mt-1 ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}>
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </motion.div>
  )
}
