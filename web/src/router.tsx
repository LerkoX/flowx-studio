import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import Layout from '@/components/Layout'
import WorkflowListPage from '@/pages/WorkflowListPage'
import WorkflowCanvasPage from '@/pages/WorkflowCanvasPage'
import NodeManagerPage from '@/pages/NodeManagerPage'
import ExecutorConfigPage from '@/pages/ExecutorConfigPage'
import SettingsPage from '@/pages/SettingsPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: '/', element: <WorkflowListPage /> },
      { path: '/canvas', element: <WorkflowCanvasPage /> },
      { path: '/nodes', element: <NodeManagerPage /> },
      { path: '/executors', element: <ExecutorConfigPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
