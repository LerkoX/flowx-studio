import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassPanel from '@/components/GlassPanel'

interface WorkflowConfigPanelProps {
  view: 'graph' | 'yaml'
}

export default function WorkflowConfigPanel({ view }: WorkflowConfigPanelProps) {
  const [yamlContent] = useState(`Version: "1.0"
Name: demo-pipeline

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
        run: echo "Building..."
  Test:
    executor: local
    steps:
      - name: test
        run: echo "Testing..."
  Deploy:
    executor: local
    steps:
      - name: deploy
        run: echo "Deploying..."`)

  if (view === 'yaml') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <GlassPanel className="p-4">
          <pre className="text-xs text-white/70 font-mono whitespace-pre-wrap overflow-auto">
            {yamlContent}
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
      <GlassPanel className="p-4">
        <h3 className="text-white/90 font-semibold text-sm mb-3">节点列表</h3>
        <div className="space-y-2">
          {['Start', 'Build', 'Test', 'Deploy'].map((node, i) => (
            <div
              key={node}
              className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/30 to-purple-500/30
                              flex items-center justify-center text-white/70 text-xs font-mono">
                {i + 1}
              </div>
              <div>
                <div className="text-white/80 text-sm font-medium">{node}</div>
                <div className="text-white/40 text-xs">{['入口', '构建', '测试', '部署'][i]}</div>
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>

      <GlassPanel className="p-4">
        <h3 className="text-white/90 font-semibold text-sm mb-3">执行状态</h3>
        <div className="space-y-2">
          <StatusBadge status="success" label="成功" count={1} />
          <StatusBadge status="running" label="运行中" count={1} />
          <StatusBadge status="idle" label="等待中" count={2} />
        </div>
      </GlassPanel>
    </motion.div>
  )
}

function StatusBadge({ status, label, count }: { status: string; label: string; count: number }) {
  const colors: Record<string, string> = {
    success: 'bg-emerald-400/20 text-emerald-400 border-emerald-400/30',
    running: 'bg-cyan-400/20 text-cyan-400 border-cyan-400/30',
    idle: 'bg-slate-400/20 text-slate-400 border-slate-400/30',
    failed: 'bg-rose-400/20 text-rose-400 border-rose-400/30',
  }

  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${colors[status] || colors.idle}`}>
      <span className="text-xs font-medium">{label}</span>
      <span className="text-xs font-mono">{count}</span>
    </div>
  )
}
