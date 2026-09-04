import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, RotateCcw, FileJson, AlertCircle, Zap } from 'lucide-react'
import yaml from 'js-yaml'
import { useTranslation } from 'react-i18next'
import GlassPanel from '@/components/GlassPanel'
import YamlViewer from '@/components/YamlViewer'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useExecutionStore } from '@/stores/executionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { toast } from '@/stores/toastStore'
import { updateWorkflow } from '@/services/workflowService'
import i18n from '@/i18n'
import type { PipelineParam, Workflow } from '@/types/workflow'
import type { ExecutionStatus } from '@/types/execution'

interface WorkflowConfigPanelProps {
  view: 'params' | 'yaml' | 'metadata'
}

export default function WorkflowConfigPanel({ view }: WorkflowConfigPanelProps) {
  const { t } = useTranslation()
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow)
  const params = useWorkflowStore((s) => s.params)
  const syncParamsFromYAML = useWorkflowStore((s) => s.syncParamsFromYAML)
  const updateParam = useWorkflowStore((s) => s.updateParam)

  const [editingValues, setEditingValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const autoSave = useSettingsStore((s) => s.systemSettings.autoSave)
  const autoSaveInterval = useSettingsStore((s) => s.systemSettings.autoSaveInterval)

  useEffect(() => {
    if (currentWorkflow?.yamlConfig) {
      syncParamsFromYAML(currentWorkflow.yamlConfig)
    }
  }, [currentWorkflow?.yamlConfig, syncParamsFromYAML])

  useEffect(() => {
    const initial: Record<string, string> = {}
    Object.values(params).forEach((p) => {
      initial[p.key] = String(p.value)
    })
    setEditingValues(initial)
  }, [params])

  const handleValueChange = (key: string, value: string) => {
    setEditingValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!currentWorkflow) return
    setSaving(true)
    try {
      Object.entries(editingValues).forEach(([key, value]) => {
        const param = params[key]
        if (!param) return
        if (value !== String(param.value)) {
          const parsedValue = parseValue(value, typeof param.value)
          updateParam(key, parsedValue)
        }
      })

      // updateParam 已把参数同步写回内存中的 yamlConfig；
      // 持久化走已存在的全量更新接口 PUT /api/v1/workflows/:id
      // （原 updateWorkflowParams 指向的 /workflows/:id/config 路由后端不存在）
      const latest = useWorkflowStore.getState().currentWorkflow
      if (latest && latest.yamlConfig !== currentWorkflow.yamlConfig) {
        await updateWorkflow(latest.id, {
          name: latest.name,
          description: latest.description,
          intent: latest.intent,
          yamlConfig: latest.yamlConfig,
          status: latest.status,
        })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // 自动保存（系统偏好 autoSave/autoSaveInterval）：参数编辑防抖后触发持久化，
  // 仅参数 tab 生效；dirty 依据是编辑值与 store 当前值的差异
  const dirty = Object.entries(editingValues).some(
    ([key, value]) => params[key] && value !== String(params[key].value)
  )
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    if (!autoSave || view !== 'params' || !dirty) return
    const timer = setTimeout(() => {
      if (dirtyRef.current) handleSave()
    }, Math.max(5, autoSaveInterval) * 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingValues, autoSave, autoSaveInterval, view])

  const handleReset = () => {
    const initial: Record<string, string> = {}
    Object.values(params).forEach((p) => {
      initial[p.key] = String(p.originalValue)
    })
    setEditingValues(initial)
  }

  if (view === 'yaml') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <YamlTabView yamlConfig={currentWorkflow?.yamlConfig} />
      </motion.div>
    )
  }

  if (view === 'metadata') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="space-y-3"
      >
        <MetadataView currentWorkflow={currentWorkflow} />
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-white/90 font-semibold text-sm">{t('canvas.pipelineParams')}</h3>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                       bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80
                       transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            {t('common.reset')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                       bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30
                       border border-indigo-500/30 transition-colors disabled:opacity-50"
          >
            <Save className="w-3 h-3" />
            {saving ? t('executor.saving') : t('common.save')}
          </button>
        </div>
      </div>

      {Object.keys(params).length === 0 ? (
        <GlassPanel className="p-4">
          <div className="text-white/40 text-sm text-center py-8">
            {t('canvas.noParams')}
            <br />
            <span className="text-xs text-white/20 mt-1 block">
              {t('canvas.noParamsHint')}
            </span>
          </div>
        </GlassPanel>
      ) : (
        <div className="space-y-2">
          {Object.values(params).map((param) => (
            <ParamField
              key={param.key}
              param={param}
              editingValue={editingValues[param.key] ?? String(param.value)}
              onChange={(value) => handleValueChange(param.key, value)}
            />
          ))}
        </div>
      )}
    </motion.div>
  )
}

function ParamField({
  param,
  editingValue,
  onChange,
}: {
  param: PipelineParam
  editingValue: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const isModified = editingValue !== String(param.originalValue)
  const isCurrentValueDifferent = editingValue !== String(param.value)

  return (
    <GlassPanel className="p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-white/80 text-sm font-mono font-medium">
              {param.key}
            </span>
            {isModified && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                {t('canvas.modified')}
              </span>
            )}
            {isCurrentValueDifferent && !isModified && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
                {t('canvas.editing')}
              </span>
            )}
          </div>
          {param.description && (
            <div className="text-white/30 text-xs mb-2">{param.description}</div>
          )}
          <input
            type="text"
            value={editingValue}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10
                       text-white/80 text-sm font-mono
                       focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.07]
                       transition-colors placeholder:text-white/20"
            placeholder={t('canvas.currentValue', { value: String(param.originalValue) })}
          />
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-white/20">
              {t('canvas.typeLabel')}: {typeof param.value}
            </span>
            <span className="text-[10px] text-white/20">
              {t('canvas.originalValue')}: {String(param.originalValue)}
            </span>
          </div>
        </div>
      </div>
    </GlassPanel>
  )
}

function parseValue(value: string, originalType: string): string | number | boolean {
  if (originalType === 'number') {
    const num = Number(value)
    return isNaN(num) ? value : num
  }
  if (originalType === 'boolean') {
    return value === 'true'
  }
  return value
}

function MetadataRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/40">{label}</span>
      <span className="text-white/80 font-mono truncate max-w-[200px]">{value || '-'}</span>
    </div>
  )
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString(i18n.language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// 元数据视图按执行上下文显式区分：回放态（选中了执行）展示该执行的运行时元数据，
// 编辑态（未选中执行）展示流水线定义的静态元数据，不再隐式回退到最新一次执行
function MetadataView({ currentWorkflow }: { currentWorkflow: Workflow | null }) {
  const selectedExecution = useExecutionStore((s) => s.selectedExecution)

  if (selectedExecution) {
    return <RuntimeMetadataPanel execution={selectedExecution} />
  }

  return <StaticMetadataPanel workflow={currentWorkflow} />
}

function RuntimeMetadataPanel({ execution }: { execution: ExecutionStatus }) {
  const { t } = useTranslation()
  const metadata = (execution.metadata || {}) as Record<string, unknown>
  const params = (metadata.params || {}) as Record<string, unknown>
  const runtime = (metadata.metadata || {}) as Record<string, unknown>
  const status = String(metadata.status || execution.status || 'pending')
  const error = execution.errorMessage || (metadata.error as string) || undefined

  return (
    <div className="space-y-3">
      <GlassPanel className="p-4 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-white/40">{t('canvas.currentExecution')}</span>
          <StatusBadge status={status} />
        </div>
        <MetadataRow label={t('canvas.executionId')} value={`#${execution.id}`} />
        <MetadataRow label={t('canvas.trigger')} value={execution.trigger || (metadata.trigger as string)} />
        <MetadataRow label={t('canvas.startedAt')} value={execution.startedAt ? formatDate(execution.startedAt) : '-'} />
        <MetadataRow label={t('canvas.completedAt')} value={execution.completedAt ? formatDate(execution.completedAt) : '-'} />
        <MetadataRow label={t('canvas.duration')} value={execution.durationMs ? formatDuration(execution.durationMs) : '-'} />
      </GlassPanel>

      {error && (
        <GlassPanel className="p-4 border-rose-500/20">
          <div className="flex items-center gap-2 text-rose-400 text-xs font-medium mb-1">
            <AlertCircle className="w-3.5 h-3.5" />
            {t('canvas.errorInfo')}
          </div>
          <div className="text-xs text-rose-300/80 break-all font-mono">{error}</div>
        </GlassPanel>
      )}

      <GlassPanel className="p-4">
        <div className="flex items-center gap-2 text-xs text-white/60 font-medium mb-2">
          <FileJson className="w-3.5 h-3.5" />
          {t('canvas.renderedParams')}
        </div>
        {Object.keys(params).length === 0 ? (
          <div className="text-xs text-white/30">{t('canvas.noParamsData')}</div>
        ) : (
          <div className="space-y-1.5">
            {Object.entries(params).map(([key, value]) => (
              <div
                key={key}
                className="flex items-start justify-between gap-3 text-xs py-1 px-2 rounded bg-white/5"
              >
                <span className="text-white/50 font-mono shrink-0">{key}</span>
                <span className="text-white/80 font-mono break-all text-right">{formatValue(value)}</span>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>

      <GlassPanel className="p-4">
        <div className="flex items-center gap-2 text-xs text-white/60 font-medium mb-2">
          <FileJson className="w-3.5 h-3.5" />
          {t('canvas.runtimeMetadata')}
        </div>
        {Object.keys(runtime).length === 0 ? (
          <div className="text-xs text-white/30">{t('canvas.noRuntimeData')}</div>
        ) : (
          <MetadataTree data={runtime} />
        )}
      </GlassPanel>
    </div>
  )
}

function StaticMetadataPanel({ workflow }: { workflow: Workflow | null }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <GlassPanel className="p-4 space-y-2">
        <MetadataRow label={t('canvas.nameLabel')} value={workflow?.name} />
        <MetadataRow label="ID" value={workflow?.id} />
        <MetadataRow label={t('canvas.statusLabel')} value={workflow?.status} />
        <MetadataRow
          label={t('node.createdAt')}
          value={workflow?.createdAt ? formatDate(workflow.createdAt) : '-'}
        />
        <MetadataRow
          label={t('canvas.updatedAt')}
          value={workflow?.updatedAt ? formatDate(workflow.updatedAt) : '-'}
        />
      </GlassPanel>
      {workflow?.description && (
        <GlassPanel className="p-4">
          <div className="text-xs text-white/40 mb-1">{t('canvas.descLabel')}</div>
          <div className="text-sm text-white/80">{workflow.description}</div>
        </GlassPanel>
      )}
      {workflow?.intent && (
        <GlassPanel className="p-4">
          <div className="text-xs text-white/40 mb-1">{t('canvas.intentLabel')}</div>
          <div className="text-sm text-white/80">{workflow.intent}</div>
        </GlassPanel>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  const colors: Record<string, string> = {
    success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    failed: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
    running: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
    paused: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
    pending: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    cancelled: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  }
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[normalized] || colors.pending}`}
    >
      {status}
    </span>
  )
}

function MetadataTree({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(data).map(([key, value]) => (
        <div
          key={key}
          className="flex items-start justify-between gap-3 text-xs py-1 px-2 rounded bg-white/5"
        >
          <span className="text-white/50 font-mono shrink-0">{key}</span>
          <span className="text-white/80 font-mono break-all text-right">{formatValue(value)}</span>
        </div>
      ))}
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * YAML tab：语法高亮展示流水线定义。
 * 回放态（选中执行）时优先展示该执行的运行时快照 YAML——快照是执行实例的
 * 独立图定义（续跑追加节点后与模板已解耦，含物化的 steps 与实际生效的参数）；
 * 无快照的旧执行回退为「模板 YAML + 运行时 Param 覆写」；编辑态展示原始定义。
 */
function YamlTabView({ yamlConfig }: { yamlConfig?: string }) {
  const { t } = useTranslation()
  const selectedExecution = useExecutionStore((s) => s.selectedExecution)
  const selectedExecutionYaml = useExecutionStore((s) => s.selectedExecutionYaml)

  const runtimeParams = useMemo(() => {
    if (!selectedExecution) return null
    const meta = (selectedExecution.metadata || {}) as Record<string, unknown>
    const params = (meta.params || {}) as Record<string, unknown>
    return Object.keys(params).length > 0 ? params : null
  }, [selectedExecution])

  const { code, isRuntime } = useMemo(() => {
    // 有快照：直接展示快照 YAML（执行实例的单一事实来源）
    if (selectedExecution && selectedExecutionYaml) {
      return { code: selectedExecutionYaml, isRuntime: true }
    }
    // 无快照回退：模板 + 运行时 Param 覆写
    const source = yamlConfig || ''
    if (!runtimeParams || !source) return { code: source, isRuntime: false }
    try {
      const doc = yaml.load(source) as Record<string, unknown>
      if (!doc || typeof doc !== 'object') return { code: source, isRuntime: false }
      doc.Param = runtimeParams
      return {
        code: yaml.dump(doc, { lineWidth: -1, noRefs: true }),
        isRuntime: true,
      }
    } catch {
      return { code: source, isRuntime: false }
    }
  }, [selectedExecution, selectedExecutionYaml, yamlConfig, runtimeParams])

  return (
    <div className="space-y-3">
      {isRuntime && selectedExecution && (
        <div className="flex items-center gap-2 px-1">
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full
                           bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">
            <Zap className="w-3 h-3" />
            {t('canvas.runtimeYaml', { id: selectedExecution.id })}
          </span>
        </div>
      )}
      <GlassPanel className="p-4 overflow-auto">
        {code ? (
          <YamlViewer code={code} />
        ) : (
          <div className="text-white/30 text-xs text-center py-8">
            {t('canvas.noWorkflowSelected')}
          </div>
        )}
      </GlassPanel>
    </div>
  )
}
