import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Play, Plus, Trash2, GitBranch } from 'lucide-react'
import { getWorkflows, runWorkflow } from '@/services/workflowService'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { Workflow } from '@/types/workflow'

export default function WorkflowListPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const { setCurrentWorkflow } = useWorkflowStore()

  const load = async () => {
    setLoading(true)
    try {
      const res = await getWorkflows({ page: 1, page_size: 100 })
      setWorkflows(res.data?.items || [])
    } catch (err) {
      console.error('Failed to load workflows:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleRun = async (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await runWorkflow(id)
    } catch (err) {
      console.error('Failed to run workflow:', err)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full overflow-auto p-6"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white/90">工作流列表</h1>
            <p className="text-white/40 text-sm mt-1">实时查看流水线</p>
          </div>
          <Link
            to="/canvas"
            onClick={() => setCurrentWorkflow(null)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-white/90
                       hover:bg-white/20 transition-colors border border-white/10"
          >
            <Plus size={18} />
            新建
          </Link>
        </div>

        {loading ? (
          <div className="text-white/40 text-sm">加载中...</div>
        ) : workflows.length === 0 ? (
          <div className="glass-panel p-8 text-center text-white/40">
            暂无工作流，请通过 MCP 客户端创建
          </div>
        ) : (
          <div className="grid gap-3">
            {workflows.map((wf) => (
              <Link
                key={wf.id}
                to="/canvas"
                onClick={() => setCurrentWorkflow(wf)}
                className="glass-panel p-4 rounded-xl flex items-center justify-between
                           hover:bg-white/5 transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-white/70">
                    <GitBranch size={20} />
                  </div>
                  <div>
                    <h3 className="text-white/90 font-medium">{wf.name}</h3>
                    <p className="text-white/40 text-sm">{wf.description || '无描述'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => handleRun(wf.id, e)}
                    className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10
                               transition-colors"
                    title="运行"
                  >
                    <Play size={18} />
                  </button>
                  <button
                    className="p-2 rounded-lg text-white/60 hover:text-red-400 hover:bg-white/10
                               transition-colors"
                    title="删除"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
