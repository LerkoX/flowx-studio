import { useState, useRef, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { Send, Sparkles, Loader2, Cpu, ChevronDown } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useAppStore } from '@/stores/appStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function ChatInputBar() {
  const [input, setInput] = useState('')
  const [showProviderMenu, setShowProviderMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { isGenerating, sendMessage } = useChatStore()
  const { setMobileChatOpen } = useAppStore()
  const { aiProviders, setActiveAIProvider, getActiveAIProvider } = useSettingsStore()
  const isMobile = useIsMobile()

  const activeProvider = getActiveAIProvider()
  const enabledProviders = aiProviders.filter((p) => p.isEnabled)

  const handleSend = () => {
    if (!input.trim() || isGenerating) return
    sendMessage(input.trim())
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    if (isMobile) {
      setMobileChatOpen(true)
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
        className={`flex items-end gap-2 px-3 py-2
                   bg-white/5 backdrop-blur-2xl
                   border border-white/10 rounded-2xl
                   focus-within:border-white/20 focus-within:bg-white/[0.07]
                   transition-all duration-200
                   ${isMobile ? 'rounded-xl' : 'rounded-2xl'}`}
      >
        <Sparkles size={isMobile ? 16 : 18} className="text-indigo-400 flex-shrink-0 mt-2" />

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={isMobile ? '描述你的需求...' : '描述你的需求，例如：帮我做一个图片处理工作流...'}
          disabled={isGenerating}
          className="flex-1 bg-transparent text-white/90 text-sm
                     placeholder:text-white/30 resize-none outline-none
                     min-h-[24px] max-h-[120px] py-1"
          rows={1}
        />

        <motion.button
          onClick={handleSend}
          disabled={isGenerating || !input.trim()}
          className={`rounded-xl flex items-center justify-center flex-shrink-0
                     bg-gradient-to-br from-indigo-500 to-purple-500
                     text-white disabled:opacity-40 disabled:cursor-not-allowed
                     hover:shadow-lg hover:shadow-indigo-500/30 transition-all
                     ${isMobile ? 'w-8 h-8' : 'w-9 h-9'}`}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {isGenerating ? (
            <Loader2 size={isMobile ? 14 : 16} className="animate-spin" />
          ) : (
            <Send size={isMobile ? 14 : 16} />
          )}
        </motion.button>
      </div>

      {/* 底部工具栏：快捷提示 + AI 供应商切换 */}
      {!isMobile && (
        <div className="flex items-center gap-2 mt-2 justify-center relative">
          {/* 快捷提示 */}
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

          {/* AI 供应商切换 */}
          <div className="relative ml-2">
            <button
              onClick={() => setShowProviderMenu(!showProviderMenu)}
              className="flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full
                         bg-white/5 text-white/40 border border-white/5
                         hover:bg-white/10 hover:text-white/60 transition-all"
            >
              <Cpu size={10} />
              {activeProvider ? activeProvider.name : '未配置'}
              <ChevronDown size={10} />
            </button>

            {showProviderMenu && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                            bg-[#1a1f3a] border border-white/10 rounded-xl
                            shadow-xl shadow-black/50 overflow-hidden
                            min-w-[180px] z-50"
              >
                {enabledProviders.length === 0 ? (
                  <div className="px-4 py-3 text-white/30 text-xs text-center">
                    暂无可用提供商
                  </div>
                ) : (
                  enabledProviders.map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => {
                        setActiveAIProvider(provider.id)
                        setShowProviderMenu(false)
                      }}
                      className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs
                                transition-all text-left
                                ${provider.isActive
                                  ? 'bg-indigo-500/10 text-indigo-300'
                                  : 'text-white/60 hover:bg-white/5 hover:text-white'
                                }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        provider.isActive ? 'bg-indigo-400' : 'bg-white/20'
                      }`} />
                      <span className="flex-1">{provider.name}</span>
                      {provider.isActive && (
                        <span className="text-[10px] text-indigo-400">当前</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}
