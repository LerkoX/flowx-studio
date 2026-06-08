import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import {
  Box,
  Settings,
  Sparkles,
  Menu,
  X,
  Cog,
} from 'lucide-react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useAppStore } from '@/stores/appStore'

const navItems = [
  { path: '/', icon: Sparkles, label: '工作流' },
  { path: '/nodes', icon: Box, label: '节点管理' },
  { path: '/executors', icon: Settings, label: '执行器' },
  { path: '/settings', icon: Cog, label: '设置' },
]

export default function Sidebar() {
  const location = useLocation()
  const isMobile = useIsMobile()
  const { mobileSidebarOpen, setMobileSidebarOpen } = useAppStore()
  const [collapsed, setCollapsed] = useState(true)

  // 移动端：汉堡菜单 + 全屏抽屉
  if (isMobile) {
    return (
      <>
        {/* 移动端顶部汉堡按钮 */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="fixed top-3 left-3 z-50 w-10 h-10 rounded-xl
                     bg-white/10 backdrop-blur-xl
                     border border-white/10
                     flex items-center justify-center
                     text-white/70 hover:text-white transition-colors"
        >
          <Menu size={20} />
        </button>

        <AnimatePresence>
          {mobileSidebarOpen && (
            <>
              {/* 遮罩层 */}
              <motion.div
                key="sidebar-overlay"
                className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileSidebarOpen(false)}
              />

              {/* 抽屉 */}
              <motion.aside
                key="sidebar-drawer"
                className="fixed left-0 top-0 h-full z-50
                           bg-[#0f172a]/95 backdrop-blur-2xl
                           border-r border-white/10
                           flex flex-col w-[220px]"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              >
                {/* Logo + 关闭按钮 */}
                <div className="h-14 flex items-center justify-between px-4 border-b border-white/10 flex-shrink-0">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500
                                    flex items-center justify-center text-white font-bold text-xs">
                      FX
                    </div>
                    <span className="ml-2 text-white/90 font-semibold text-sm">FlowX</span>
                  </div>
                  <button
                    onClick={() => setMobileSidebarOpen(false)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center
                               text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* 导航项 */}
                <nav className="flex-1 py-4 px-3 space-y-1">
                  {navItems.map((item) => {
                    const isActive = location.pathname === item.path
                    const Icon = item.icon

                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setMobileSidebarOpen(false)}
                        className={`
                          flex items-center gap-3 px-3 py-3 rounded-xl
                          transition-all duration-200 relative
                          ${isActive
                            ? 'bg-white/10 text-white'
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                          }
                        `}
                      >
                        {isActive && (
                          <motion.div
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-white rounded-r-full"
                            layoutId="sidebarIndicatorMobile"
                            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                          />
                        )}
                        <Icon size={20} />
                        <span className="text-sm font-medium">{item.label}</span>
                      </Link>
                    )
                  })}
                </nav>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </>
    )
  }

  // 桌面端：悬浮展开侧边栏
  return (
    <motion.aside
      className="fixed left-0 top-0 h-full z-40
                 bg-white/5 backdrop-blur-2xl
                 border-r border-white/10
                 flex flex-col"
      animate={{ width: collapsed ? 48 : 160 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25, mass: 0.8 }}
      onMouseEnter={() => setCollapsed(false)}
      onMouseLeave={() => setCollapsed(true)}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-3 border-b border-white/10 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500
                        flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
          FX
        </div>
        {!collapsed && (
          <motion.span
            className="ml-2 text-white/90 font-semibold text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            FlowX
          </motion.span>
        )}
      </div>

      {/* 导航项 */}
      <nav className="flex-1 py-3 px-1.5 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path
          const Icon = item.icon

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`
                flex items-center gap-2 px-2.5 py-2 rounded-xl
                transition-all duration-200 relative
                ${isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
                }
              `}
            >
              {/* 激活指示条 */}
              {isActive && (
                <motion.div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-white rounded-r-full"
                  layoutId="sidebarIndicator"
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                />
              )}

              <Icon size={18} />
              {!collapsed && (
                <motion.span
                  className="text-xs font-medium whitespace-nowrap"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                >
                  {item.label}
                </motion.span>
              )}
            </Link>
          )
        })}
      </nav>
    </motion.aside>
  )
}
