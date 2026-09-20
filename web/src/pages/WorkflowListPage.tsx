import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Play, Trash2, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getWorkflows, runWorkflow, deleteWorkflow } from '@/services/workflowService'
import { useWorkflowStore } from '@/stores/workflowStore'
import { toast } from '@/stores/toastStore'
import { useConfirm } from '@/hooks/useConfirm'
import type { Workflow } from '@/types/workflow'

// 列表分页大小：滚动到底时按 50 条一页懒加载
const PAGE_SIZE = 50

export default function WorkflowListPage() {
  const { t } = useTranslation()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // 已加载页码与并发保护用 ref：滚动事件高频触发，state 闭包可能读到旧值
  const pageRef = useRef(0)
  const loadingRef = useRef(false)
  const hasMoreRef = useRef(true)
  const [expandedDescId, setExpandedDescId] = useState<string | null>(null)
  const setCurrentWorkflow = useWorkflowStore((s) => s.setCurrentWorkflow)
  const { confirm, dialog } = useConfirm()

  const loadPage = useCallback(async (page: number, append: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (append) setLoadingMore(true)
    else setLoading(true)
    try {
      const res = await getWorkflows({ page, page_size: PAGE_SIZE })
      const items = res.data?.items || []
      const totalCount = res.data?.total ?? 0
      pageRef.current = page
      hasMoreRef.current = page * PAGE_SIZE < totalCount
      setTotal(totalCount)
      setWorkflows((prev) => {
        if (!append) return items
        const existing = new Set(prev.map((w) => w.id))
        return [...prev, ...items.filter((w) => !existing.has(w.id))]
      })
    } catch (err) {
      console.error('Failed to load workflows:', err)
    } finally {
      loadingRef.current = false
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    loadPage(1, false)
  }, [loadPage])

  // 滚动到底部附近时懒加载下一页
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (!hasMoreRef.current || loadingRef.current) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      void loadPage(pageRef.current + 1, true)
    }
  }

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
      setTotal((prev) => Math.max(0, prev - 1))
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
      onScroll={handleScroll}
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
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-white/5 flex items-center justify-center text-white/70">
                    <GitBranch size={20} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-white/90 font-medium truncate">{wf.name}</h3>
                    <p
                      className={`text-white/40 text-sm ${
                        expandedDescId === wf.id ? '' : 'truncate'
                      }`}
                      title={wf.description || undefined}
                      onClick={(e) => {
                        if (!wf.description) return
                        e.preventDefault()
                        e.stopPropagation()
                        setExpandedDescId((prev) => (prev === wf.id ? null : wf.id))
                      }}
                    >
                      {wf.description || t('workflow.noDescription')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
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
            {loadingMore && (
              <div className="text-center py-3 text-white/30 text-sm">{t('common.loading')}</div>
            )}
            {!loadingMore && workflows.length < total && (
              <div className="text-center py-3 text-white/20 text-xs">
                {t('common.loadedCount', { loaded: workflows.length, total })}
              </div>
            )}
          </div>
        )}
      </div>
      {dialog}
    </motion.div>
  )
}
