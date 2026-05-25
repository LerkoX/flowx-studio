import { motion } from 'framer-motion'
import GlassPanel from '@/components/GlassPanel'

interface NodeConfigPanelProps {
  tab: 'params' | 'code' | 'mock'
}

export default function NodeConfigPanel({ tab }: NodeConfigPanelProps) {
  if (tab === 'params') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <GlassPanel className="p-4">
          <h3 className="text-white/90 font-semibold text-sm mb-4">节点配置</h3>
          <div className="space-y-4">
            <FormField label="名称" placeholder="输入节点名称" />
            <FormField label="描述" placeholder="输入节点描述" />
            <FormField label="执行器" placeholder="选择执行器" />
            <FormField label="镜像" placeholder="输入容器镜像（可选）" />
          </div>
        </GlassPanel>
      </motion.div>
    )
  }

  if (tab === 'code') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <GlassPanel className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white/90 font-semibold text-sm">代码</h3>
            <div className="flex gap-2">
              <button className="text-xs px-2 py-1 rounded bg-white/5 text-white/50 hover:bg-white/10 transition-colors">代码</button>
              <button className="text-xs px-2 py-1 rounded bg-white/5 text-white/50 hover:bg-white/10 transition-colors">Mock</button>
            </div>
          </div>
          <pre className="text-xs text-white/70 font-mono whitespace-pre-wrap">
            {`package main

import "fmt"

func main() {
    fmt.Println("Hello, FlowX!")
}`}
          </pre>
        </GlassPanel>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <GlassPanel className="p-4">
        <h3 className="text-white/90 font-semibold text-sm mb-3">Mock 数据</h3>
        <pre className="text-xs text-white/70 font-mono whitespace-pre-wrap">
          {JSON.stringify({
            status: 'success',
            data: {
              message: 'Mock test passed',
              timestamp: new Date().toISOString(),
            }
          }, null, 2)}
        </pre>
      </GlassPanel>
    </motion.div>
  )
}

function FormField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <div>
      <label className="block text-white/60 text-xs mb-1.5">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10
                   text-white/90 text-sm placeholder:text-white/20
                   focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                   transition-all"
      />
    </div>
  )
}
