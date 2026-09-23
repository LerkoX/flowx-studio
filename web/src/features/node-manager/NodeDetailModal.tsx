import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, GitBranch, Container, Code, Tag, FileCode, FileJson, Box, Clock, User, Copy, Check, AlertTriangle, LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NodeDefinition } from '@/types/node'
import type { NodeWidgetProps } from '@/types/nodeWidget'
import GlassPanel from '@/components/GlassPanel'
import JsonViewer from '@/components/JsonViewer'
import ModuleNodeWidget, { buildWidgetUrl } from '@/components/ModuleNodeWidget'
import { useViewportWidth } from '@/hooks/useMediaQuery'
import { getCurrentTheme } from '@/utils/theme'

interface NodeDetailModalProps {
  node: NodeDefinition | null
  isOpen: boolean
  loading?: boolean
  onClose: () => void
}

export default function NodeDetailModal({ node, isOpen, loading, onClose }: NodeDetailModalProps) {
  const { t, i18n } = useTranslation()
  const [activeTab, setActiveTab] = useState<'overview' | 'ui' | 'params' | 'outputs' | 'raw'>('overview')
  const [copied, setCopied] = useState(false)
  const viewportWidth = useViewportWidth()

  if (!node) return null

  const isImageNode = node.nodeType === 'image'
  const hasUI = !!(node.ui?.entry && node.id)

  // UI 预览（只读）：弹窗展示的是节点包定义本身，没有「某个流水线实例的参数」可写回，
  // 因此不透传 onParamsChange（widget 契约里判空即进只读），params 取各参数默认值。
  const uiWidth = node.ui?.width || 260
  const uiHeight = node.ui?.height || 120
  // 弹窗卡片 max-w-2xl + 内容区 p-6 + GlassPanel p-4，按视口收窄后的可用宽度
  const availableWidth = Math.max(200, Math.min(672, viewportWidth - 32) - 80)
  const uiScale = Math.min(1, availableWidth / uiWidth)
  const previewProps: NodeWidgetProps = {
    // 合成实例 ID：弹窗不是任何流水线实例，仅用于组件内部自持的展示逻辑
    nodeId: `node-detail-${node.id}`,
    nodeRef: node.name,
    status: 'idle',
    inputs: node.parameters.map((p) => p.name),
    outputs: {},
    params: Object.fromEntries(
      node.parameters.map((p) => [p.name, p.default !== undefined ? String(p.default) : ''])
    ),
    execution: null,
    theme: getCurrentTheme(),
    locale: typeof navigator !== 'undefined' ? navigator.language : 'zh-CN',
  }

  // 切换节点后旧 tab 可能已不适用（从含 UI 的节点切到不含 UI 的、输出 tab 无输出），
  // 此时回退到概览，避免内容区空白
  const effectiveTab: typeof activeTab =
    (activeTab === 'ui' && !hasUI) || (activeTab === 'outputs' && !node.outputs)
      ? 'overview'
      : activeTab

  const packageJson = node.package ? JSON.stringify(node.package, null, 2) : ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(packageJson)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用（如非安全上下文）时静默失败
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

          {/* 弹窗 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="w-full max-w-2xl max-h-[85vh] bg-panel/95 backdrop-blur-2xl 
                            border border-white/10 rounded-2xl overflow-hidden flex flex-col pointer-events-auto"
            >
              {/* 头部 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{node.icon || (isImageNode ? '🐳' : '⚙️')}</span>
                  <div>
                    <h2 className="text-white/90 font-semibold">{node.displayName || node.name}</h2>
                    <p className="text-white/40 text-xs">{node.description}</p>
                    {node.ui?.entry && (
                      <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full
                                       bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px]"
                            title={t('node.customUiTooltip', { entry: node.ui.entry })}>
                        {t('node.customUi')}
                      </span>
                    )}
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
                {/* 5 个 tab 在窄屏上很挤：标签缩到 text-xs 并去掉多余间隙，允许换行 */}
                {[
                  { key: 'overview' as const, label: t('node.tabOverview'), icon: Box },
                  ...(hasUI ? [{ key: 'ui' as const, label: t('node.uiPreview'), icon: LayoutGrid }] : []),
                  { key: 'params' as const, label: t('node.tabParams'), icon: FileCode },
                  ...(node.outputs ? [{ key: 'outputs' as const, label: t('node.tabOutputs'), icon: Code }] : []),
                  { key: 'raw' as const, label: 'flowx.json', icon: FileJson },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 min-w-0 px-1 py-3 text-xs sm:text-sm font-medium transition-all relative
                      ${effectiveTab === tab.key ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
                  >
                    <span className="flex items-center justify-center gap-1 sm:gap-2">
                      <tab.icon size={14} className="hidden sm:block flex-shrink-0" />
                      {tab.label}
                    </span>
                    {effectiveTab === tab.key && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute bottom-0 left-4 right-4 h-[2px] 
                                 bg-gradient-to-r from-indigo-400 to-purple-400 rounded-full"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* 内容 */}
              <div className="flex-1 overflow-y-auto p-6">
                {effectiveTab === 'overview' && (
                  <div className="space-y-4">
                    {/* 基本信息 */}
                    <GlassPanel className="p-4">
                      <h3 className="text-white/70 font-medium text-sm mb-3">{t('node.basicInfo')}</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <InfoItem icon={Tag} label={t('node.nameLabel')} value={node.name} />
                        <InfoItem icon={Code} label={t('node.versionLabel')} value={node.version || '1.0.0'} />
                        <InfoItem 
                          icon={isImageNode ? Container : Code} 
                          label={t('node.typeLabel')} 
                          value={isImageNode ? t('node.imageNode') : t('node.codeNodeWithLang', { lang: node.language })} 
                        />
                        <InfoItem icon={User} label={t('node.authorLabel')} value={node.author || t('node.unknown')} />
                        {node.createdAt && (
                          <InfoItem 
                            icon={Clock} 
                            label={t('node.createdAt')} 
                            value={new Date(node.createdAt).toLocaleDateString(i18n.language)} 
                          />
                        )}
                      </div>
                    </GlassPanel>

                    {/* 执行器声明与一致性：声明可 docker ≠ 真在镜像里，不一致必须显式提示 */}
                    {node.executorCheck && (
                      <GlassPanel className="p-4">
                        <h3 className="text-white/70 font-medium text-sm mb-3">
                          {t('canvas.executorDecl')}
                        </h3>
                        <div className="flex flex-col gap-2 text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white/40">{t('canvas.executorDeclTypes')}</span>
                            {(node.executorCheck.types || []).map((execType) => (
                              <span
                                key={execType}
                                className={`px-2 py-0.5 rounded-full border font-mono ${
                                  execType === 'docker'
                                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                                    : 'bg-white/5 text-white/50 border-white/10'
                                }`}
                              >
                                {execType}
                              </span>
                            ))}
                            {node.executorCheck.preferred && (
                              <span className="text-white/40">
                                · {t('canvas.executorDeclPreferred')}: {node.executorCheck.preferred}
                              </span>
                            )}
                          </div>
                          {node.executorCheck.image && (
                            <div className="flex items-center gap-2">
                              <span className="text-white/40">{t('canvas.executorDeclImage')}</span>
                              <span className="font-mono text-blue-300/80 truncate">{node.executorCheck.image}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-white/40">{t('canvas.executorDeclBundled')}</span>
                            <span className={node.executorCheck.bundled ? 'text-emerald-400' : 'text-white/40'}>
                              {node.executorCheck.bundled ? '✓' : '—'}
                            </span>
                            {node.executorCheck.dockerOk && (
                              <span className="text-emerald-400">· {t('canvas.executorDeclDockerOk')}</span>
                            )}
                          </div>
                          {(node.executorCheck.issues || []).length > 0 && (
                            <ul className="mt-1 flex flex-col gap-1">
                              {(node.executorCheck.issues || []).map((issue) => (
                                <li key={issue} className="flex items-start gap-1.5 text-amber-300">
                                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                                  <span>{issue}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </GlassPanel>
                    )}

                    {/* 镜像/代码信息 */}
                    {isImageNode ? (
                      <GlassPanel className="p-4">
                        <h3 className="text-white/70 font-medium text-sm mb-3">{t('node.imageInfo')}</h3>
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                          <Container size={16} className="text-blue-400" />
                          <span className="text-blue-400 font-mono text-sm">{node.image}</span>
                        </div>
                      </GlassPanel>
                    ) : (
                      <>
                        {node.entry && (
                          <GlassPanel className="p-4">
                            <h3 className="text-white/70 font-medium text-sm mb-3">{t('node.entryFile')}</h3>
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                              <FileCode size={16} className="text-emerald-400" />
                              <span className="text-emerald-400 font-mono text-sm">{node.entry}</span>
                            </div>
                          </GlassPanel>
                        )}
                        {node.sourceURL && (
                          <GlassPanel className="p-4">
                            <h3 className="text-white/70 font-medium text-sm mb-3">{t('node.source')}</h3>
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
                        <h3 className="text-white/70 font-medium text-sm mb-3">{t('node.tagsLabel')}</h3>
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

                {effectiveTab === 'ui' && hasUI && (
                  <GlassPanel className="p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <h3 className="text-white/70 font-medium text-sm flex items-center gap-2">
                        <LayoutGrid size={14} />
                        {t('node.uiPreview')}
                      </h3>
                      <span className="text-white/30 text-[10px] font-mono truncate">{node.ui!.entry}</span>
                    </div>
                    {/* 组件超过可用宽度时等比缩放，保证 UI 完整可见、不撑破弹窗 */}
                    <div className="overflow-x-auto">
                      {uiScale < 1 ? (
                        <div
                          style={{
                            width: Math.round(uiWidth * uiScale),
                            height: Math.round(uiHeight * uiScale),
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: uiWidth,
                              height: uiHeight,
                              transform: `scale(${uiScale})`,
                              transformOrigin: 'top left',
                            }}
                          >
                            <ModuleNodeWidget
                              url={buildWidgetUrl(
                                String(node.id),
                                node.ui!.entry,
                                node.updatedAt ? String(node.updatedAt) : undefined
                              )}
                              width={uiWidth}
                              height={uiHeight}
                              widgetProps={previewProps}
                            />
                          </div>
                        </div>
                      ) : (
                        <ModuleNodeWidget
                          url={buildWidgetUrl(
                            String(node.id),
                            node.ui!.entry,
                            node.updatedAt ? String(node.updatedAt) : undefined
                          )}
                          width={uiWidth}
                          height={uiHeight}
                          widgetProps={previewProps}
                        />
                      )}
                    </div>
                    <p className="text-white/30 text-[10px] mt-2">{t('node.uiPreviewReadonlyHint')}</p>
                  </GlassPanel>
                )}

                {effectiveTab === 'params' && (
                  <div className="space-y-3">
                    {node.parameters.length === 0 ? (
                      <div className="text-center py-8 text-white/30 text-sm">
                        {t('node.noParams')}
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
                                  <span className="text-[10px] text-rose-400">{t('node.required')}</span>
                                )}
                              </div>
                              <p className="text-white/40 text-xs">{param.description}</p>
                              {param.default !== undefined && (
                                <p className="text-white/30 text-[11px] mt-2">
                                  {t('node.defaultValue')}: {String(param.default)}
                                </p>
                              )}
                            </div>
                          </div>
                        </GlassPanel>
                      ))
                    )}
                  </div>
                )}

                {effectiveTab === 'outputs' && node.outputs && (
                  <div className="space-y-3">
                    {node.outputs.length === 0 ? (
                      <div className="text-center py-8 text-white/30 text-sm">
                        {t('node.noOutputs')}
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
                {effectiveTab === 'raw' && (
                  loading && !node.package ? (
                    <div className="text-center py-8 text-white/30 text-sm">
                      {t('common.loading')}
                    </div>
                  ) : !node.package ? (
                    <div className="text-center py-8 text-white/30 text-sm">
                      {t('node.noPackageConfig')}
                    </div>
                  ) : (
                    <GlassPanel className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-white/70 font-medium text-sm font-mono">flowx.json</h3>
                        <button
                          onClick={handleCopy}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs
                                   text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                          {copied ? t('common.copied') : t('common.copy')}
                        </button>
                      </div>
                      <JsonViewer code={packageJson} />
                    </GlassPanel>
                  )
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
