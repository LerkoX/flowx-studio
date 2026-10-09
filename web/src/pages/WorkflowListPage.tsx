import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Activity, CheckCircle2, FileText, Search, Trash2, X, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getWorkflows, deleteWorkflow } from '@/services/workflowService'
import { getNodes } from '@/services/nodeService'
import Select from '@/components/Select'
import { useEventStream } from '@/services/eventService'
import { useWorkflowStore } from '@/stores/workflowStore'
import { toast } from '@/stores/toastStore'
import { useConfirm } from '@/hooks/useConfirm'
import WorkflowThumbnail from '@/components/WorkflowThumbnail'
import type { Workflow, WorkflowStats } from '@/types/workflow'

// 列表分页大小：滚动到底时按 50 条一页懒加载
const PAGE_SIZE = 50

const EMPTY_STATS: WorkflowStats = { total: 0, running: 0, success: 0, failed: 0, cancelled: 0 }

// 事件里 workflow_id 为数字，工作流 id 在 JSON 里同样是数字，统一转字符串比较
function normalizeStats(stats?: WorkflowStats): WorkflowStats {
  return { ...EMPTY_STATS, ...(stats || {}) }
}

/** 执行事件就地累加统计，避免整页刷新（running 归零下限保护） */
function applyExecutionEvent(
  stats: WorkflowStats,
  type: 'started' | 'completed',
  status: string
): WorkflowStats {
  if (type === 'started') {
    return { ...stats, total: stats.total + 1, running: stats.running + 1 }
  }
  const next: WorkflowStats = { ...stats, running: Math.max(0, stats.running - 1) }
  switch (status) {
    case 'success':
      next.success += 1
      break
    case 'failed':
      next.failed += 1
      break
    case 'cancelled':
      next.cancelled += 1
      break
  }
  return next
}

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
  const [descWorkflow, setDescWorkflow] = useState<Workflow | null>(null)
  const setCurrentWorkflow = useWorkflowStore((s) => s.setCurrentWorkflow)
  const { confirm, dialog } = useConfirm()

  // 过滤：关键字（防抖后入 filters）+ 状态下拉 + 最近运行下拉 + 包含节点下拉
  const [searchInput, setSearchInput] = useState('')
  const [filters, setFilters] = useState({ search: '', status: '', execStatus: '', node: '' })
  const [nodeOptions, setNodeOptions] = useState<string[]>([])

  // 关键字防抖 300ms，避免每敲一个字符就请求
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // 节点下拉选项一次性拉取（节点名列表，跨页聚合）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const names = new Set<string>()
        for (let page = 1; page <= 10; page++) {
          const res = await getNodes({ page, page_size: 100 })
          const items = res.data?.items || []
          for (const n of items) names.add(n.name)
          if (page * 100 >= (res.data?.total ?? 0)) break
        }
        if (!cancelled) setNodeOptions([...names].sort())
      } catch {
        // 节点列表拉取失败不阻塞搜索主流程
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadPage = useCallback(
    async (page: number, append: boolean) => {
      if (loadingRef.current) return
      loadingRef.current = true
      if (append) setLoadingMore(true)
      else setLoading(true)
      try {
        const res = await getWorkflows({
          page,
          page_size: PAGE_SIZE,
          search: filters.search || undefined,
          status: filters.status || undefined,
          exec_status: filters.execStatus || undefined,
          node: filters.node || undefined,
        })
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
    },
    [filters]
  )

  // 过滤条件变化 → 重置分页从头加载
  useEffect(() => {
    loadPage(1, false)
  }, [loadPage])

  // 卡片上的「运行中/成功/失败」随执行事件实时更新，不触发整页刷新
  useEventStream('/api/v1/events', (type, data) => {
    if (type !== 'execution.started' && type !== 'execution.completed') return
    const payload = data as { workflow_id?: number | string; status?: string } | null
    if (!payload || payload.workflow_id === undefined || payload.workflow_id === null) return
    const workflowId = String(payload.workflow_id)
    const status = (payload.status || '').toLowerCase()
    setWorkflows((prev) =>
      prev.map((w) =>
        String(w.id) === workflowId
          ? {
              ...w,
              stats: applyExecutionEvent(
                normalizeStats(w.stats),
                type === 'execution.started' ? 'started' : 'completed',
                status
              ),
            }
          : w
      )
    )
  })

  // 滚动到底部附近时懒加载下一页
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (!hasMoreRef.current || loadingRef.current) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      void loadPage(pageRef.current + 1, true)
    }
  }

  const openDescription = (wf: Workflow, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDescWorkflow(wf)
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
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white/90">{t('workflow.listTitle')}</h1>
          <p className="text-white/40 text-sm mt-1">{t('workflow.listSubtitle')}</p>
        </div>

        {/* 过滤工具条：关键字（名称/备注/配置全文）+ 状态 + 最近运行 + 包含节点 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('workflow.searchPlaceholder')}
              className="w-full pl-8 pr-8 py-2 rounded-lg bg-white/5 border border-white/10
                         text-sm text-white/85 placeholder-white/30 outline-none
                         focus:border-white/25 transition-colors"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-white/40
                           hover:text-white hover:bg-white/10 transition-colors"
                title={t('common.close')}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <Select
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={[
              { value: '', label: t('workflow.filterStatusAll') },
              { value: 'draft', label: t('workflow.statusDraft') },
              { value: 'active', label: t('workflow.statusActive') },
              { value: 'archived', label: t('workflow.statusArchived') },
            ]}
            triggerClassName="px-2.5 py-2 rounded-lg text-sm text-white/75"
          />
          <Select
            value={filters.execStatus}
            onChange={(v) => setFilters((f) => ({ ...f, execStatus: v }))}
            options={[
              { value: '', label: t('workflow.filterExecAll') },
              { value: 'success', label: t('workflow.statSuccess') },
              { value: 'failed', label: t('workflow.statFailed') },
              { value: 'running', label: t('workflow.statRunning') },
              { value: 'cancelled', label: t('workflow.execCancelled') },
              { value: 'never', label: t('workflow.execNever') },
            ]}
            triggerClassName="px-2.5 py-2 rounded-lg text-sm text-white/75"
          />
          <Select
            value={filters.node}
            onChange={(v) => setFilters((f) => ({ ...f, node: v }))}
            options={[
              { value: '', label: t('workflow.filterNodeAll') },
              ...nodeOptions.map((n) => ({ value: n, label: n })),
            ]}
            className="max-w-[200px]"
            triggerClassName="px-2.5 py-2 rounded-lg text-sm text-white/75"
          />
        </div>

        {loading ? (
          <div className="text-white/40 text-sm">{t('common.loading')}</div>
        ) : workflows.length === 0 ? (
          <div className="glass-panel p-8 text-center text-white/40">
            {t('workflow.empty')}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {workflows.map((wf) => {
              const stats = normalizeStats(wf.stats)
              return (
                <Link
                  key={wf.id}
                  to={`/canvas/${wf.id}`}
                  onClick={() => setCurrentWorkflow(wf)}
                  className="glass-panel p-4 rounded-xl flex flex-col gap-3
                             hover:bg-white/5 hover:border-white/15 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="shrink-0 font-mono text-[11px] px-1.5 py-0.5 rounded
                                     bg-white/10 text-white/50"
                          title={`${t('workflow.idLabel')}: ${wf.id}`}
                        >
                          #{wf.id}
                        </span>
                        <h3 className="text-white/90 font-medium truncate">{wf.name}</h3>
                      </div>
                      <div className="h-5 mt-1.5 flex items-center">
                        {stats.running > 0 && (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300/90">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            </span>
                            {t('workflow.running')} · {stats.running}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => openDescription(wf, e)}
                        className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10
                                   transition-colors"
                        title={t('workflow.viewDescription')}
                      >
                        <FileText size={16} />
                      </button>
                      <button
                        onClick={(e) => handleDelete(wf, e)}
                        className="p-2 rounded-lg text-white/50 hover:text-red-400 hover:bg-white/10
                                   transition-colors"
                        title={t('common.delete')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* 结构缩略图：只读小图，直观看出节点与连线 */}
                  <WorkflowThumbnail yamlConfig={wf.yamlConfig} className="h-32" />

                  <div className="flex items-center gap-4 text-[11px] text-white/45">
                    <span className="inline-flex items-center gap-1">
                      <Activity size={12} />
                      {t('workflow.statTotal')} {stats.total}
                    </span>
                    <span className="inline-flex items-center gap-1 text-emerald-400/80">
                      <CheckCircle2 size={12} />
                      {t('workflow.statSuccess')} {stats.success}
                    </span>
                    <span className="inline-flex items-center gap-1 text-rose-400/80">
                      <XCircle size={12} />
                      {t('workflow.statFailed')} {stats.failed}
                    </span>
                  </div>
                </Link>
              )
            })}
            {loadingMore && (
              <div className="col-span-full text-center py-3 text-white/30 text-sm">
                {t('common.loading')}
              </div>
            )}
            {!loadingMore && workflows.length < total && (
              <div className="col-span-full text-center py-3 text-white/20 text-xs">
                {t('common.loadedCount', { loaded: workflows.length, total })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 描述弹窗：列表不再内联展示描述，按需查看 */}
      <AnimatePresence>
        {descWorkflow && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDescWorkflow(null)}
              className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="fixed inset-0 z-[90] flex items-center justify-center p-4 pointer-events-none"
            >
              <div
                className="w-full max-w-lg max-h-[70vh] flex flex-col bg-panel/95 backdrop-blur-2xl
                           border border-white/10 rounded-2xl p-5 pointer-events-auto
                           shadow-2xl shadow-black/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-white/90 font-semibold text-sm truncate">
                      {descWorkflow.name}
                    </h3>
                    <span className="font-mono text-[11px] text-white/40">
                      {t('workflow.descriptionTitle')} · #{descWorkflow.id}
                    </span>
                  </div>
                  <button
                    onClick={() => setDescWorkflow(null)}
                    className="shrink-0 p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10
                               transition-colors"
                    title={t('common.close')}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="mt-3 overflow-auto text-sm text-white/70 whitespace-pre-wrap break-words">
                  {descWorkflow.description || t('workflow.noDescription')}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {dialog}
    </motion.div>
  )
}
