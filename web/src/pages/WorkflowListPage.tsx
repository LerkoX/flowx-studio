import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Play, Trash2, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getWorkflows, runWorkflow, deleteWorkflow } from '@/services/workflowService'
import { useWorkflowStore } from '@/stores/workflowStore'
import { toast } from '@/stores/toastStore'
import { useConfirm } from '@/hooks/useConfirm'
import type { Workflow } from '@/types/workflow'

export default function WorkflowListPage() {
  const { t } = useTranslation()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const setCurrentWorkflow = useWorkflowStore((s) => s.setCurrentWorkflow)
  const { confirm, dialog } = useConfirm()

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
      toast.success(t('workflow.runStarted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async (wf: Workflow, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const ok = await confirm({
      title: t('workflow.deleteConfirmTitle'),
      message: t('workflow.deleteConfirmMessage', { name: wf.name }),
      confirmText: t('common.delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await deleteWorkflow(wf.id)
      setWorkflows((prev) => prev.filter((w) => w.id !== wf.id))
      toast.success(t('workflow.deleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full overflow-auto p-6"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white/90">{t('workflow.listTitle')}</h1>
          <p className="text-white/40 text-sm mt-1">{t('workflow.listSubtitle')}</p>
        </div>

        {loading ? (
          <div className="text-white/40 text-sm">{t('common.loading')}</div>
        ) : workflows.length === 0 ? (
          <div className="glass-panel p-8 text-center text-white/40">
            {t('workflow.empty')}
          </div>
        ) : (
          <div className="grid gap-3">
            {workflows.map((wf) => (
              <Link
                key={wf.id}
                to={`/canvas/${wf.id}`}
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
                    <p className="text-white/40 text-sm">{wf.description || t('workflow.noDescription')}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => handleRun(wf.id, e)}
                    className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10
                               transition-colors"
                    title={t('common.run')}
                  >
                    <Play size={18} />
                  </button>
                  <button
                    onClick={(e) => handleDelete(wf, e)}
                    className="p-2 rounded-lg text-white/60 hover:text-red-400 hover:bg-white/10
                               transition-colors"
                    title={t('common.delete')}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {dialog}
    </motion.div>
  )
}
