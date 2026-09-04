import { Suspense, lazy, type ReactNode } from 'react'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import Layout from '@/components/Layout'

// 路由级代码分割：各页面按需加载，首屏列表页不再打包画布（xyflow）等重依赖
const WorkflowListPage = lazy(() => import('@/pages/WorkflowListPage'))
const WorkflowCanvasPage = lazy(() => import('@/pages/WorkflowCanvasPage'))
const NodeManagerPage = lazy(() => import('@/pages/NodeManagerPage'))
const ExecutorConfigPage = lazy(() => import('@/pages/ExecutorConfigPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))

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
