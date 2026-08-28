import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Play, Terminal, Loader2, AlertCircle, CheckCircle, Clock, Code, LayoutGrid } from 'lucide-react'
import type { NodeDefinition } from '@/types/node'
import type { NodeWidgetProps } from '@/types/nodeWidget'
import { mockTestNode } from '@/services/nodeService'
import ModuleNodeWidget, { buildWidgetUrl } from '@/components/ModuleNodeWidget'
import GlassPanel from '@/components/GlassPanel'

interface NodeTestPanelProps {
  node: NodeDefinition | null
  isOpen: boolean
  onClose: () => void
}

export default function NodeTestPanel({ node, isOpen, onClose }: NodeTestPanelProps) {
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [timeout, setTimeout] = useState(30)
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<{
    status: string
    duration_ms: number
    output: Record<string, unknown>
    stdout: string
    stderr: string
    logs: string
    error: string
    exit_code: number
  } | null>(null)

  if (!node) return null

  const isCodeNode = node.nodeType === 'code'
  const hasUI = !!(node.ui?.entry && node.id)

  // UI 预览用的合成 props：入参来自表单，输出来自最近一次 Mock 结果
  const previewProps: NodeWidgetProps = {
    nodeId: 'mock-preview',
    nodeRef: node.name,
    status: !result ? 'idle' : result.status === 'success' ? 'success' : 'failed',
    inputs: node.parameters.map((p) => p.name),
    outputs: Object.fromEntries(
      Object.entries(result?.output || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
    ),
    execution: null,
    theme: 'dark',
    locale: typeof navigator !== 'undefined' ? navigator.language : 'zh-CN',
  }

  const handleRun = async () => {
    if (!node.id) return
    
    setIsRunning(true)
    setResult(null)
    
    try {
      const response = await mockTestNode(String(node.id), paramValues, timeout)
      if (response.code === 200) {
        setResult(response.data)
      } else {
        setResult({
          status: 'failed',
          duration_ms: 0,
          output: {},
          stdout: '',
          stderr: '',
          logs: '',
          error: response.message || 'Unknown error',
          exit_code: -1
        })
      }
    } catch (err) {
      setResult({
        status: 'failed',
        duration_ms: 0,
        output: {},
        stdout: '',
        stderr: '',
        logs: '',
        error: err instanceof Error ? err.message : 'Network error',
        exit_code: -1
      })
    } finally {
      setIsRunning(false)
    }
  }

  const getStatusIcon = () => {
    if (!result) return null
    switch (result.status) {
      case 'success':
        return <CheckCircle size={16} className="text-emerald-400" />
      case 'timeout':
        return <Clock size={16} className="text-amber-400" />
      default:
        return <AlertCircle size={16} className="text-rose-400" />
    }
  }

  const getStatusColor = () => {
    if (!result) return 'text-white/60'
    switch (result.status) {
      case 'success':
        return 'text-emerald-400'
      case 'timeout':
        return 'text-amber-400'
      default:
        return 'text-rose-400'
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* 面板 */}
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg 
                       bg-[#0f172a]/95 backdrop-blur-2xl border-l border-white/10
                       flex flex-col"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-3">
                <Terminal size={18} className="text-indigo-400" />
                <div>
                  <h2 className="text-white/90 font-semibold text-sm">测试节点</h2>
                  <p className="text-white/40 text-xs">{node.displayName || node.name}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center
                         text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* 内容 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 不支持提示 */}
              {!isCodeNode && (
                <GlassPanel className="p-4 bg-amber-500/10 border-amber-500/20">
                  <div className="flex items-center gap-2 text-amber-400 text-sm">
                    <AlertCircle size={16} />
                    <span>镜像节点暂不支持测试</span>
                  </div>
                </GlassPanel>
              )}

              {/* 参数输入 */}
              {node.parameters.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-white/70 font-medium text-sm flex items-center gap-2">
                    <Code size={14} />
                    输入参数
                  </h3>
                  {node.parameters.map((param) => (
                    <GlassPanel key={param.name} className="p-3">
                      <div className="mb-2">
                        <div className="flex items-center gap-2">
                          <code className="text-indigo-400 text-sm font-mono">{param.name}</code>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 
                                         text-white/40 border border-white/10">
                            {param.type}
                          </span>
                          {param.required && (
                            <span className="text-[10px] text-rose-400">必填</span>
                          )}
                        </div>
                        <p className="text-white/30 text-xs mt-1">{param.description}</p>
                      </div>
                      <input
                        type="text"
                        value={paramValues[param.name] || ''}
                        onChange={(e) => 
                          setParamValues(prev => ({ ...prev, [param.name]: e.target.value }))
                        }
                        placeholder={param.default !== undefined ? String(param.default) : '输入值...'}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2
                                 text-white/80 text-sm placeholder:text-white/20
                                 focus:outline-none focus:border-indigo-500/50 focus:ring-1 
                                 focus:ring-indigo-500/20 transition-all"
                      />
                    </GlassPanel>
                  ))}
                </div>
              )}

              {/* 超时设置 */}
              <GlassPanel className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-white/60 text-sm">执行超时</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={timeout}
                      onChange={(e) => setTimeout(Math.max(1, Math.min(300, parseInt(e.target.value) || 30)))}
                      className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1
                               text-white/80 text-sm text-center
                               focus:outline-none focus:border-indigo-500/50"
                    />
                    <span className="text-white/40 text-xs">秒</span>
                  </div>
                </div>
              </GlassPanel>

              {/* 自定义 UI 组件预览（flowx.json ui.entry） */}
              {hasUI && (
                <div className="space-y-3">
                  <h3 className="text-white/70 font-medium text-sm flex items-center gap-2">
                    <LayoutGrid size={14} />
                    UI 预览
                  </h3>
                  <GlassPanel className="p-3">
                    <ModuleNodeWidget
                      url={buildWidgetUrl(String(node.id), node.ui!.entry, node.updatedAt ? String(node.updatedAt) : undefined)}
                      width={node.ui!.width || 260}
                      height={node.ui!.height || 120}
                      widgetProps={previewProps}
                    />
                    {!result && (
                      <p className="text-white/30 text-[10px] mt-2">运行测试后组件将收到真实输出数据</p>
                    )}
                  </GlassPanel>
                </div>
              )}

              {/* 执行按钮 */}
              <button
                onClick={handleRun}
                disabled={isRunning || !isCodeNode}
                className={`w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                    isRunning || !isCodeNode
                      ? 'bg-white/5 text-white/30 cursor-not-allowed'
                      : 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-400 hover:to-purple-400 shadow-lg shadow-indigo-500/20'
                  }`}
              >
                {isRunning ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>执行中...</span>
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    <span>运行测试</span>
                  </>
                )}
              </button>

              {/* 执行结果 */}
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  {/* 状态栏 */}
                  <GlassPanel className={`p-3 ${
                    result.status === 'success' ? 'bg-emerald-500/5 border-emerald-500/20' :
                    result.status === 'timeout' ? 'bg-amber-500/5 border-amber-500/20' :
                    'bg-rose-500/5 border-rose-500/20'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusIcon()}
                        <span className={`text-sm font-medium ${getStatusColor()}`}>
                          {result.status === 'success' ? '执行成功' :
                           result.status === 'timeout' ? '执行超时' : '执行失败'}
                        </span>
                      </div>
                      <span className="text-white/30 text-xs">
                        {result.duration_ms}ms
                      </span>
                    </div>
                    {result.error && (
                      <p className="text-rose-400 text-xs mt-2">{result.error}</p>
                    )}
                  </GlassPanel>

                  {/* 输出 */}
                  {(result.stdout || result.stderr) && (
                    <GlassPanel className="p-3">
                      <h4 className="text-white/60 text-xs font-medium mb-2">标准输出</h4>
                      {result.stdout && (
                        <pre className="text-emerald-400 text-xs font-mono bg-black/30 rounded-lg p-3 
                                      overflow-x-auto whitespace-pre-wrap">
                          {result.stdout}
                        </pre>
                      )}
                      {result.stderr && (
                        <pre className="text-rose-400 text-xs font-mono bg-black/30 rounded-lg p-3 mt-2
                                      overflow-x-auto whitespace-pre-wrap">
                          {result.stderr}
                        </pre>
                      )}
                    </GlassPanel>
                  )}

                  {/* 解析的输出 */}
                  {result.output && Object.keys(result.output).length > 0 && (
                    <GlassPanel className="p-3">
                      <h4 className="text-white/60 text-xs font-medium mb-2">解析输出</h4>
                      <pre className="text-indigo-400 text-xs font-mono bg-black/30 rounded-lg p-3 
                                    overflow-x-auto">
                        {JSON.stringify(result.output, null, 2)}
                      </pre>
                    </GlassPanel>
                  )}

                  {/* 执行日志 */}
                  {result.logs && (
                    <GlassPanel className="p-3">
                      <h4 className="text-white/60 text-xs font-medium mb-2">执行日志</h4>
                      <pre className="text-white/50 text-xs font-mono bg-black/30 rounded-lg p-3 
                                    overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
                        {result.logs}
                      </pre>
                    </GlassPanel>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
