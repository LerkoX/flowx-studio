import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Settings,
  Sparkles,
  ChevronRight,
  X,
  Cog,
} from 'lucide-react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useAppStore } from '@/stores/appStore'

const navItems = [
  { path: '/', icon: Sparkles, labelKey: 'nav.workflows' },
  { path: '/nodes', icon: Box, labelKey: 'nav.nodes' },
  { path: '/executors', icon: Settings, labelKey: 'nav.executors' },
  { path: '/settings', icon: Cog, labelKey: 'nav.settings' },
]

export default function Sidebar() {
  const { t } = useTranslation()
  const location = useLocation()
  const isMobile = useIsMobile()
  const { mobileSidebarOpen, setMobileSidebarOpen } = useAppStore()
  const [collapsed, setCollapsed] = useState(true)

  // 移动端：汉堡菜单 + 全屏抽屉
  if (isMobile) {
    return (
      <>
        {/* 移动端菜单拉手：左边缘垂直居中的贴边小方块，> 图标提示可拉出菜单。
            抽屉展开时隐藏，避免与抽屉叠加 */}
        {!mobileSidebarOpen && (
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="fixed left-0 top-1/2 -translate-y-1/2 z-50 w-6 h-16
                     bg-white/5 backdrop-blur-xl
                     border border-white/10 border-l-0 rounded-r-lg
                     flex items-center justify-center
                     text-white/40 hover:text-white/70 transition-colors"
            aria-label="打开菜单"
          >
            <ChevronRight size={16} />
          </button>
        )}

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
                           bg-panel/95 backdrop-blur-2xl
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
                                    flex items-center justify-center text-on-accent font-bold text-xs">
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
                        <span className="text-sm font-medium">{t(item.labelKey)}</span>
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
                        flex items-center justify-center text-on-accent font-bold text-xs flex-shrink-0">
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
                  {t(item.labelKey)}
                </motion.span>
              )}
            </Link>
          )
        })}
      </nav>
    </motion.aside>
  )
}
