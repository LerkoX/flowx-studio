import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, GitBranch, Container, Code, Tag, FileCode, Box, Clock, User } from 'lucide-react'
import type { NodeDefinition } from '@/types/node'
import GlassPanel from '@/components/GlassPanel'

interface NodeDetailModalProps {
  node: NodeDefinition | null
  isOpen: boolean
  onClose: () => void
}

export default function NodeDetailModal({ node, isOpen, onClose }: NodeDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'params' | 'outputs'>('overview')

  if (!node) return null

  const isImageNode = node.nodeType === 'image'

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

          {/* 弹窗 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-2xl max-h-[85vh] bg-[#0f172a]/95 backdrop-blur-2xl 
                            border border-white/10 rounded-2xl overflow-hidden flex flex-col"
            >
              {/* 头部 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{node.icon || (isImageNode ? '🐳' : '⚙️')}</span>
                  <div>
                    <h2 className="text-white/90 font-semibold">{node.displayName || node.name}</h2>
                    <p className="text-white/40 text-xs">{node.description}</p>
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

              {/* 标签切换 */}
              <div className="flex border-b border-white/10 flex-shrink-0">
                {[
                  { key: 'overview' as const, label: '概览', icon: Box },
                  { key: 'params' as const, label: '参数', icon: FileCode },
                  ...(node.outputs ? [{ key: 'outputs' as const, label: '输出', icon: Code }] : []),
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 py-3 text-sm font-medium transition-all relative
                      ${activeTab === tab.key ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <tab.icon size={14} />
                      {tab.label}
                    </span>
                    {activeTab === tab.key && (
                      <motion.div
                        layoutId="detailTab"
                        className="absolute bottom-0 left-4 right-4 h-[2px] 
                                 bg-gradient-to-r from-indigo-400 to-purple-400 rounded-full"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* 内容 */}
              <div className="flex-1 overflow-y-auto p-6">
                {activeTab === 'overview' && (
                  <div className="space-y-4">
                    {/* 基本信息 */}
                    <GlassPanel className="p-4">
                      <h3 className="text-white/70 font-medium text-sm mb-3">基本信息</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <InfoItem icon={Tag} label="名称" value={node.name} />
                        <InfoItem icon={Code} label="版本" value={node.version || '1.0.0'} />
                        <InfoItem 
                          icon={isImageNode ? Container : Code} 
                          label="类型" 
                          value={isImageNode ? '镜像节点' : `代码节点 (${node.language})`} 
                        />
                        <InfoItem icon={User} label="作者" value={node.author || '未知'} />
                        {node.createdAt && (
                          <InfoItem 
                            icon={Clock} 
                            label="创建时间" 
                            value={node.createdAt.toLocaleDateString('zh-CN')} 
                          />
                        )}
                      </div>
                    </GlassPanel>

                    {/* 镜像/代码信息 */}
                    {isImageNode ? (
                      <GlassPanel className="p-4">
                        <h3 className="text-white/70 font-medium text-sm mb-3">镜像信息</h3>
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                          <Container size={16} className="text-blue-400" />
                          <span className="text-blue-400 font-mono text-sm">{node.image}</span>
                        </div>
                      </GlassPanel>
                    ) : (
                      <>
                        {node.entry && (
                          <GlassPanel className="p-4">
                            <h3 className="text-white/70 font-medium text-sm mb-3">入口文件</h3>
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                              <FileCode size={16} className="text-emerald-400" />
                              <span className="text-emerald-400 font-mono text-sm">{node.entry}</span>
                            </div>
                          </GlassPanel>
                        )}
                        {node.sourceURL && (
                          <GlassPanel className="p-4">
                            <h3 className="text-white/70 font-medium text-sm mb-3">来源</h3>
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                              <GitBranch size={16} className="text-white/40" />
                              <span className="text-white/60 font-mono text-sm truncate">{node.sourceURL}</span>
                            </div>
                          </GlassPanel>
                        )}
                      </>
                    )}

                    {/* 标签 */}
                    {node.tags && node.tags.length > 0 && (
                      <GlassPanel className="p-4">
                        <h3 className="text-white/70 font-medium text-sm mb-3">标签</h3>
                        <div className="flex gap-2 flex-wrap">
                          {node.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-xs px-3 py-1 rounded-full bg-white/5 
                                       text-white/60 border border-white/10"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </GlassPanel>
                    )}
                  </div>
                )}

                {activeTab === 'params' && (
                  <div className="space-y-3">
                    {node.parameters.length === 0 ? (
                      <div className="text-center py-8 text-white/30 text-sm">
                        该节点没有定义参数
                      </div>
                    ) : (
                      node.parameters.map((param) => (
                        <GlassPanel key={param.name} className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <code className="text-indigo-400 text-sm font-mono">{param.name}</code>
                                <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 
                                               text-white/40 border border-white/10">
                                  {param.type}
                                </span>
                                {param.required && (
                                  <span className="text-[10px] text-rose-400">必填</span>
                                )}
                              </div>
                              <p className="text-white/40 text-xs">{param.description}</p>
                              {param.default !== undefined && (
                                <p className="text-white/30 text-[11px] mt-2">
                                  默认值: {String(param.default)}
                                </p>
                              )}
                            </div>
                          </div>
                        </GlassPanel>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'outputs' && node.outputs && (
                  <div className="space-y-3">
                    {node.outputs.length === 0 ? (
                      <div className="text-center py-8 text-white/30 text-sm">
                        该节点没有定义输出
                      </div>
                    ) : (
                      node.outputs.map((output) => (
                        <GlassPanel key={output.name} className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <code className="text-emerald-400 text-sm font-mono">{output.name}</code>
                                <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 
                                               text-white/40 border border-white/10">
                                  {output.type}
                                </span>
                              </div>
                              <p className="text-white/40 text-xs">{output.description}</p>
                            </div>
                          </div>
                        </GlassPanel>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function InfoItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} className="text-white/30 flex-shrink-0" />
      <div className="min-w-0">
        <span className="text-white/30 text-[10px] block">{label}</span>
        <span className="text-white/70 text-xs truncate block">{value}</span>
      </div>
    </div>
  )
}
