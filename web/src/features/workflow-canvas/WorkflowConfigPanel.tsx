import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, RotateCcw } from 'lucide-react'
import GlassPanel from '@/components/GlassPanel'
import { useWorkflowStore } from '@/stores/workflowStore'
import { updateWorkflowParams } from '@/services/workflowService'
import type { PipelineParam } from '@/types/workflow'

interface WorkflowConfigPanelProps {
  view: 'params' | 'yaml'
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

      await updateWorkflowParams(currentWorkflow.id, editingValues)
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
