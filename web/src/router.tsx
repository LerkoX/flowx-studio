import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import Layout from '@/components/Layout'
import WorkflowCanvasPage from '@/pages/WorkflowCanvasPage'
import NodeGeneratorPage from '@/pages/NodeGeneratorPage'
import ExecutorConfigPage from '@/pages/ExecutorConfigPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: '/', element: <WorkflowCanvasPage /> },
      { path: '/node-generator', element: <NodeGeneratorPage /> },
      { path: '/executors', element: <ExecutorConfigPage /> },
    ],
  },
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
