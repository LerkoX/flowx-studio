import { motion } from 'framer-motion'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import ChatInputBar from './ChatInputBar'
import ChatPanel from '@/features/chat/ChatPanel'

export default function Layout() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-[#0a0e27] via-[#1a1f3a] to-[#0f172a]">
      {/* 左侧 Sidebar */}
      <Sidebar />

      {/* 主内容区 — marginLeft 固定为 sidebar 收缩宽度，不受展开影响 */}
      <main
        className="h-full flex flex-col"
        style={{ marginLeft: 48 }}
      >
        {/* 顶部 Toolbar（悬浮胶囊） */}
        <FloatingToolbar />

        {/* 内容区域：左侧聊天 + 中间画布 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧 AI 聊天历史 — 固定显示 */}
          <div className="w-[420px] flex-shrink-0 h-full overflow-hidden border-r border-white/10 bg-black/20">
            <ChatPanel compact />
          </div>

          {/* 中间页面内容 */}
          <div className="flex-1 overflow-hidden relative">
            <Outlet />
          </div>
        </div>

        {/* 底部 AI 对话输入栏 */}
        <div className="flex-shrink-0 flex justify-center px-4 py-3 border-t border-white/10 bg-black/20">
          <div className="w-full max-w-2xl">
            <ChatInputBar />
          </div>
        </div>
      </main>
    </div>
  )
}

function FloatingToolbar() {
  return (
    <motion.div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-50
                 flex items-center gap-2 px-4 py-2
                 bg-white/5 backdrop-blur-2xl
                 border border-white/10 rounded-full"
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      <ToolbarButton icon="Play" label="运行" />
      <ToolbarButton icon="Pause" label="暂停" />
      <div className="w-px h-5 bg-white/10" />
      <ToolbarButton icon="ZoomIn" label="放大" />
      <ToolbarButton icon="ZoomOut" label="缩小" />
      <ToolbarButton icon="Maximize" label="全屏" />
    </motion.div>
  )
}

function ToolbarButton({ icon, label }: { icon: string; label: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    Play: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
    Pause: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="4" width="4" height="16" />
        <rect x="14" y="4" width="4" height="16" />
      </svg>
    ),
    ZoomIn: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    ZoomOut: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    Maximize: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
      </svg>
    ),
  }

  return (
    <button
      className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-all"
      title={label}
    >
      {iconMap[icon] || icon}
    </button>
  )
}
