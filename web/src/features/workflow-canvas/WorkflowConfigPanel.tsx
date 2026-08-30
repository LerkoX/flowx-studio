import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, RotateCcw, FileJson, AlertCircle } from 'lucide-react'
import GlassPanel from '@/components/GlassPanel'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useExecutionStore } from '@/stores/executionStore'
import { updateWorkflow } from '@/services/workflowService'
import ExecutionHistoryPanel from '@/features/workflow-canvas/ExecutionHistoryPanel'
import type { PipelineParam, Workflow } from '@/types/workflow'
import type { ExecutionStatus } from '@/types/execution'

interface WorkflowConfigPanelProps {
  view: 'params' | 'yaml' | 'metadata' | 'history'
}

export default function WorkflowConfigPanel({ view }: WorkflowConfigPanelProps) {
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow)
  const params = useWorkflowStore((s) => s.params)
  const syncParamsFromYAML = useWorkflowStore((s) => s.syncParamsFromYAML)
  const updateParam = useWorkflowStore((s) => s.updateParam)

  const [editingValues, setEditingValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

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
    } finally {
      setSaving(false)
    }
  }

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
        <GlassPanel className="p-4">
          <pre className="text-xs text-white/70 font-mono whitespace-pre-wrap overflow-auto">
            {currentWorkflow?.yamlConfig || defaultYAML}
          </pre>
        </GlassPanel>
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

  if (view === 'history') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="h-full"
      >
        <ExecutionHistoryPanel workflowId={currentWorkflow?.id} />
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
        <h3 className="text-white/90 font-semibold text-sm">流水线参数</h3>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                       bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80
                       transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            重置
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                       bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30
                       border border-indigo-500/30 transition-colors disabled:opacity-50"
          >
            <Save className="w-3 h-3" />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {Object.keys(params).length === 0 ? (
        <GlassPanel className="p-4">
          <div className="text-white/40 text-sm text-center py-8">
            当前流水线没有定义参数
            <br />
            <span className="text-xs text-white/20 mt-1 block">
              在 YAML 配置中添加 Param 字段
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
                已修改
              </span>
            )}
            {isCurrentValueDifferent && !isModified && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
                编辑中
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
            placeholder={`当前值: ${String(param.originalValue)}`}
          />
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-white/20">
              类型: {typeof param.value}
            </span>
            <span className="text-[10px] text-white/20">
              原始值: {String(param.originalValue)}
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
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function MetadataView({ currentWorkflow }: { currentWorkflow: Workflow | null }) {
  const selectedExecution = useExecutionStore((s) => s.selectedExecution)
  const executions = useExecutionStore((s) => s.executions)
  const loadExecutions = useExecutionStore((s) => s.loadExecutions)

  useEffect(() => {
    if (currentWorkflow?.id && executions.length === 0) {
      loadExecutions(currentWorkflow.id)
    }
  }, [currentWorkflow?.id, executions.length, loadExecutions])

  const execution = selectedExecution || (executions.length > 0 ? executions[0] : null)

  if (execution) {
    return <RuntimeMetadataPanel execution={execution} />
  }

  return <StaticMetadataPanel workflow={currentWorkflow} />
}

function RuntimeMetadataPanel({ execution }: { execution: ExecutionStatus }) {
  const metadata = (execution.metadata || {}) as Record<string, unknown>
  const params = (metadata.params || {}) as Record<string, unknown>
  const runtime = (metadata.metadata || {}) as Record<string, unknown>
  const status = String(metadata.status || execution.status || 'pending')
  const error = execution.errorMessage || (metadata.error as string) || undefined

  return (
    <div className="space-y-3">
      <GlassPanel className="p-4 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-white/40">当前执行</span>
          <StatusBadge status={status} />
        </div>
        <MetadataRow label="执行 ID" value={`#${execution.id}`} />
        <MetadataRow label="触发方式" value={execution.trigger || (metadata.trigger as string)} />
        <MetadataRow label="开始时间" value={execution.startedAt ? formatDate(execution.startedAt) : '-'} />
        <MetadataRow label="结束时间" value={execution.completedAt ? formatDate(execution.completedAt) : '-'} />
        <MetadataRow label="耗时" value={execution.durationMs ? formatDuration(execution.durationMs) : '-'} />
      </GlassPanel>

      {error && (
        <GlassPanel className="p-4 border-rose-500/20">
          <div className="flex items-center gap-2 text-rose-400 text-xs font-medium mb-1">
            <AlertCircle className="w-3.5 h-3.5" />
            错误信息
          </div>
          <div className="text-xs text-rose-300/80 break-all font-mono">{error}</div>
        </GlassPanel>
      )}

      <GlassPanel className="p-4">
        <div className="flex items-center gap-2 text-xs text-white/60 font-medium mb-2">
          <FileJson className="w-3.5 h-3.5" />
          渲染后的参数
        </div>
        {Object.keys(params).length === 0 ? (
          <div className="text-xs text-white/30">暂无参数</div>
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
          运行时元数据
        </div>
        {Object.keys(runtime).length === 0 ? (
          <div className="text-xs text-white/30">暂无运行时数据</div>
        ) : (
          <MetadataTree data={runtime} />
        )}
      </GlassPanel>
    </div>
  )
}

function StaticMetadataPanel({ workflow }: { workflow: Workflow | null }) {
  return (
    <div className="space-y-3">
      <GlassPanel className="p-4 space-y-2">
        <MetadataRow label="名称" value={workflow?.name} />
        <MetadataRow label="ID" value={workflow?.id} />
        <MetadataRow label="状态" value={workflow?.status} />
        <MetadataRow
          label="创建时间"
          value={workflow?.createdAt ? formatDate(workflow.createdAt) : '-'}
        />
        <MetadataRow
          label="更新时间"
          value={workflow?.updatedAt ? formatDate(workflow.updatedAt) : '-'}
        />
      </GlassPanel>
      {workflow?.description && (
        <GlassPanel className="p-4">
          <div className="text-xs text-white/40 mb-1">描述</div>
          <div className="text-sm text-white/80">{workflow.description}</div>
        </GlassPanel>
      )}
      {workflow?.intent && (
        <GlassPanel className="p-4">
          <div className="text-xs text-white/40 mb-1">意图</div>
          <div className="text-sm text-white/80">{workflow.intent}</div>
        </GlassPanel>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    failed: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
    running: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
    pending: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    cancelled: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  }
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[status] || colors.pending}`}
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

const defaultYAML = `Version: "1.0"
Name: demo-pipeline

Param:
  env: "production"  # 部署环境
  appName: "myapp"   # 应用名称
  namespace: "myapp-production"  # 命名空间

Executors:
  local:
    type: local
    config:
      shell: bash

Graph: |
  stateDiagram-v2
    [*] --> Build
    Build --> Test
    Test --> Deploy
    Deploy --> [*]

Nodes:
  Build:
    executor: local
    steps:
      - name: build
        run: echo "Building {{ Param.appName }}..."
  Test:
    executor: local
    steps:
      - name: test
        run: echo "Testing {{ Param.appName }}..."
  Deploy:
    executor: local
    steps:
      - name: deploy
        run: echo "Deploying {{ Param.appName }} to {{ Param.namespace }}..."`
