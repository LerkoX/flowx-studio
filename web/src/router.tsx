import { Suspense, lazy, type ReactNode } from 'react'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import Layout from '@/components/Layout'

// server 更新后旧 hash 的懒加载 chunk 在新版本中不存在，直接加载会白屏；
// 失败时自动刷新一次拉取新 index 与新 bundle（sessionStorage 防止刷新死循环）
const CHUNK_RELOAD_KEY = 'flowx-chunk-reload'

function lazyWithReload(factory: () => Promise<{ default: React.ComponentType<object> }>) {
  return lazy(async () => {
    try {
      const mod = await factory()
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
      return mod
    } catch (err) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
        window.location.reload()
        return new Promise<{ default: React.ComponentType<object> }>(() => {})
      }
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
      throw err
    }
  })
}

// 路由级代码分割：各页面按需加载，首屏列表页不再打包画布（xyflow）等重依赖
const WorkflowListPage = lazyWithReload(() => import('@/pages/WorkflowListPage'))
const WorkflowCanvasPage = lazyWithReload(() => import('@/pages/WorkflowCanvasPage'))
const NodeManagerPage = lazyWithReload(() => import('@/pages/NodeManagerPage'))
const ExecutorConfigPage = lazyWithReload(() => import('@/pages/ExecutorConfigPage'))
const SettingsPage = lazyWithReload(() => import('@/pages/SettingsPage'))

const pageFallback = (
  <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-white/30">
    Loading…
  </div>
)

const lazyPage = (element: ReactNode) => (
  <Suspense fallback={pageFallback}>{element}</Suspense>
)

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: '/', element: lazyPage(<WorkflowListPage />) },
      { path: '/canvas/:id?', element: lazyPage(<WorkflowCanvasPage />) },
      { path: '/nodes', element: lazyPage(<NodeManagerPage />) },
      { path: '/executors', element: lazyPage(<ExecutorConfigPage />) },
      { path: '/settings', element: lazyPage(<SettingsPage />) },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
