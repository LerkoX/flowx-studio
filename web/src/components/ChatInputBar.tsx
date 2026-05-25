import { useState, useRef, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { Send, Sparkles, Loader2 } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'

export default function ChatInputBar() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { isGenerating, sendMessage } = useChatStore()

  const handleSend = () => {
    if (!input.trim() || isGenerating) return
    sendMessage(input.trim())
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }

  return (
    <motion.div
      className="w-full"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      <div
        className="flex items-end gap-3 px-5 py-3
                   bg-white/5 backdrop-blur-2xl
                   border border-white/10 rounded-2xl
                   focus-within:border-white/20 focus-within:bg-white/[0.07]
                   transition-all duration-200"
      >
        <Sparkles size={18} className="text-indigo-400 flex-shrink-0 mt-2" />

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="描述你的需求，例如：帮我做一个图片处理工作流..."
          disabled={isGenerating}
          className="flex-1 bg-transparent text-white/90 text-sm
                     placeholder:text-white/30 resize-none outline-none
                     min-h-[24px] max-h-[120px] py-1"
          rows={1}
        />

        <motion.button
          onClick={handleSend}
          disabled={isGenerating || !input.trim()}
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
                     bg-gradient-to-br from-indigo-500 to-purple-500
                     text-white disabled:opacity-40 disabled:cursor-not-allowed
                     hover:shadow-lg hover:shadow-indigo-500/30 transition-all"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {isGenerating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
        </motion.button>
      </div>

      {/* 快捷提示 */}
      <div className="flex gap-2 mt-2 justify-center">
        {['生成节点', '创建工作流', 'Mock 测试', '查看日志'].map((hint) => (
          <button
            key={hint}
            onClick={() => { setInput(hint); textareaRef.current?.focus(); }}
            className="text-[11px] px-3 py-1 rounded-full
                       bg-white/5 text-white/40 border border-white/5
                       hover:bg-white/10 hover:text-white/60 transition-all"
          >
            {hint}
          </button>
        ))}
      </div>
    </motion.div>
  )
}
