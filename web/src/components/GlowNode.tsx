import { memo, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIsMobile, useViewportWidth } from '@/hooks/useMediaQuery'
import { useExecutionStore } from '@/stores/executionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getCurrentTheme } from '@/utils/theme'
import ModuleNodeWidget, { buildWidgetUrl } from '@/components/ModuleNodeWidget'
import type { NodeWidgetExecution, NodeWidgetProps } from '@/types/nodeWidget'
import type { NodeUIConfig } from '@/types/node'
import type { ExecutionStatus } from '@/types/execution'

interface GlowNodeData {
  id: string
  name: string
  description?: string
  status: 'idle' | 'running' | 'success' | 'failed' | 'skipped'
  language?: string
  icon?: string
  accentColor?: string
  inputs?: string[]
  outputs?: Record<string, string>
  direction?: 'TB' | 'LR'
  /** 节点包名（config.nodeRef） */
  nodeRef?: string
  /** 节点包数据库 ID（用于加载 ui bundle） */
  nodeDbId?: string
  /** 节点包更新时间（bundle URL 缓存破坏） */
  nodeUpdatedAt?: string
  /** 自定义 UI 组件配置 */
  ui?: NodeUIConfig
  /** 节点实例当前参数绑定（pipeline YAML config.params），供自定义 UI 展示 */
  params?: Record<string, string>
  /** 参数写回回调（编辑态提供；回放态缺省，组件进入只读） */
  onParamsChange?: (params: Record<string, string>) => void
  /** 画布编辑模式标记：false 时节点不可选中、内嵌 UI 不可交互（缺省视为 true） */
  interactive?: boolean
}

function toWidgetExecution(exec: ExecutionStatus | null): NodeWidgetExecution | null {
  if (!exec) return null
  const toISO = (d?: Date | string) => (d ? (d instanceof Date ? d.toISOString() : String(d)) : undefined)
  return {
    id: exec.id,
    status: exec.status,
    trigger: exec.trigger,
    startedAt: toISO(exec.startedAt),
    completedAt: toISO(exec.completedAt),
    durationMs: exec.durationMs,
    errorMessage: exec.errorMessage,
    errorNodeId: exec.errorNodeId,
    metadata: exec.metadata,
  }
}

const statusConfig = {
  idle: { color: '#94a3b8', glow: 'none' },
  running: { color: '#22d3ee', glow: 'cyan' },
  success: { color: '#34d399', glow: 'emerald' },
  failed: { color: '#fb7185', glow: 'rose' },
  skipped: { color: '#64748b', glow: 'none' },
}

const GlowNode = memo(({ data, selected }: NodeProps) => {
  const { t } = useTranslation()
  const nodeData = data as unknown as GlowNodeData
  const { name, description, status, language, accentColor = '#6366f1' } = nodeData
  const config = statusConfig[status]
  const isMobile = useIsMobile()

  const hasUI = !!(nodeData.ui?.entry && nodeData.nodeDbId)
  // 预览模式：内嵌 UI 不可交互，且不下发 onParamsChange（组件按契约进入只读）
  const interactive = nodeData.interactive !== false
  const uiWidth = nodeData.ui?.width || 260
  const uiHeight = nodeData.ui?.height || 120
  const viewportWidth = useViewportWidth()
  // 移动端组件宽度按视口上限收窄（两侧留边距），仍跟随 ui.width 变化
  const mobileMaxWidth = Math.max(180, viewportWidth - 64)
  const widgetWidth = isMobile ? Math.min(uiWidth, mobileMaxWidth) : uiWidth
  // 宽度被收窄时等比缩放组件，保证 UI 完整可见且宽高比不变
  const widgetScale = widgetWidth / uiWidth
  const widgetHeight = Math.round(uiHeight * widgetScale)

  // 移动端详情默认收起；带 UI 组件时可用 ui.collapsed 控制（默认收起）
  const [detailsExpanded, setDetailsExpanded] = useState(
    () => !isMobile || (hasUI && nodeData.ui?.collapsed === false)
  )
  // 带 UI 组件时，桌面端原生入参/返回摘要默认折叠为“查看数据”开关
  const [rawDataExpanded, setRawDataExpanded] = useState(false)

  // 仅带 UI 组件的节点订阅执行实例 metadata，避免无关重渲染
  const selectedExecution = useExecutionStore((s) => (hasUI ? s.selectedExecution : null))
  // 订阅主题偏好，切换主题时重渲染 widget
  useSettingsStore((s) => s.systemSettings.theme)

  const widgetProps = useMemo<NodeWidgetProps>(
    () => ({
      nodeId: nodeData.id,
      nodeRef: nodeData.nodeRef || '',
      status,
      inputs: nodeData.inputs || [],
      outputs: nodeData.outputs || {},
      params: nodeData.params || {},
      onParamsChange: interactive ? nodeData.onParamsChange : undefined,
      execution: toWidgetExecution(selectedExecution),
      theme: getCurrentTheme(),
      locale: typeof navigator !== 'undefined' ? navigator.language : 'zh-CN',
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [nodeData.id, nodeData.nodeRef, status, nodeData.inputs, nodeData.outputs, nodeData.params, nodeData.onParamsChange, interactive, selectedExecution]
  )

  const hasInputs = nodeData.inputs && nodeData.inputs.length > 0
  const hasOutputs = nodeData.outputs && Object.keys(nodeData.outputs).length > 0
  const hasDetails = hasInputs || hasOutputs

  const isHorizontal = nodeData.direction === 'LR'
  const targetPosition = isHorizontal ? Position.Left : Position.Top
  const sourcePosition = isHorizontal ? Position.Right : Position.Bottom

  return (
    <motion.div
      className="relative"
      initial={{ scale: 0.85, opacity: 0, y: 10 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25, mass: 0.8 }}
    >
      {/* 选中高亮发光层 */}
      {selected && (
        <div
          className="absolute -inset-[2px] rounded-[22px]"
          style={{
            background: `linear-gradient(135deg, ${config.color}60, ${config.color}20)`,
            opacity: 0.6,
            filter: 'blur(4px)',
          }}
        />
      )}

      {/* 节点主体 */}
      <div
        className={`
          relative rounded-[20px] p-3
          bg-white/[0.08] border border-white/10
          backdrop-blur-xl
          transition-all duration-300
          ${selected ? 'border-white/30' : ''}
          ${hasUI
            ? 'min-w-[140px]'
            : isMobile
              ? 'min-w-[140px] max-w-[200px]'
              : 'min-w-[200px] max-w-[280px]'}
        `}
        style={{
          // 带内嵌 UI 组件时按组件尺寸撑开节点卡片（移动端有上限）
          ...(hasUI ? { width: widgetWidth + 26 } : {}),
          boxShadow: selected
            ? `0 0 20px ${config.color}40, inset 0 1px 0 rgb(var(--color-ink) / 0.05)`
            : 'inset 0 1px 0 rgb(var(--color-ink) / 0.05)',
        }}
      >
        {/* 顶部彩色条 */}
        <div
          className="absolute top-0 left-4 right-4 h-[2px] rounded-b-sm"
          style={{ background: accentColor }}
        />

        {/* 输入连接点 */}
        <Handle
          type="target"
          position={targetPosition}
          id="target"
          className="w-3 h-3 !bg-white/20 !border-white/30"
        />

        {/* 节点内容 */}
        <div className="flex items-start gap-2">
          {/* 图标 */}
          <div
            className={`rounded-full flex items-center justify-center flex-shrink-0
                        ${isMobile ? 'w-8 h-8' : 'w-10 h-10'}`}
            style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}80)` }}
          >
            <span className={`text-on-accent ${isMobile ? 'text-base' : 'text-lg'}`}>
              {nodeData.icon || '◆'}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className={`text-white/90 font-semibold truncate ${isMobile ? 'text-xs' : 'text-sm'}`}>{name}</div>
            {description && (
              <div className={`text-white/40 truncate mt-0.5 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>{description}</div>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {language && (
                <span className={`px-1.5 py-0.5 rounded-full bg-white/5 text-white/50 border border-white/10
                                  ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}>
                  {language}
                </span>
              )}
              <span
                className={`px-1.5 py-0.5 rounded-full border ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}
                style={{
                  color: config.color,
                  borderColor: `${config.color}40`,
                  background: `${config.color}10`,
                }}
              >
                {status === 'running' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1" />}
                {status}
              </span>
            </div>
          </div>
        </div>

        {/* 输出连接点 */}
        <Handle
          type="source"
          position={sourcePosition}
          id="source"
          className="w-3 h-3 !bg-white/20 !border-white/30"
        />

        {/* 内嵌自定义 UI 组件（桌面端常显；移动端随详情展开） */}
        {hasUI && (!isMobile || detailsExpanded) && (
          // 预览模式拦截组件区域的指针事件；“查看数据”开关恢复可点击
          <div
            className={`mt-2 pt-2 border-t border-white/10 ${interactive ? '' : 'pointer-events-none'}`}
          >
            {widgetScale < 1 ? (
              // 移动端收窄：按原始尺寸挂载组件，再用 transform 等比缩小到节点宽度
              <div style={{ width: widgetWidth, height: widgetHeight, overflow: 'hidden' }}>
                <div
                  style={{
                    width: uiWidth,
                    height: uiHeight,
                    transform: `scale(${widgetScale})`,
                    transformOrigin: 'top left',
                  }}
                >
                  <ModuleNodeWidget
                    url={buildWidgetUrl(nodeData.nodeDbId!, nodeData.ui!.entry, nodeData.nodeUpdatedAt)}
                    width={uiWidth}
                    height={uiHeight}
                    widgetProps={widgetProps}
                  />
                </div>
              </div>
            ) : (
              <ModuleNodeWidget
                url={buildWidgetUrl(nodeData.nodeDbId!, nodeData.ui!.entry, nodeData.nodeUpdatedAt)}
                width={widgetWidth}
                height={uiHeight}
                widgetProps={widgetProps}
              />
            )}
            {!isMobile && hasDetails && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setRawDataExpanded(!rawDataExpanded)
                }}
                className="mt-1.5 flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors pointer-events-auto"
              >
                {rawDataExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {rawDataExpanded ? t('canvas.collapseData') : t('canvas.viewData')}
              </button>
            )}
          </div>
        )}

        {/* 入参与返回数据（带 UI 组件时桌面端默认折叠，由“查看数据”开关展开） */}
        {hasDetails && (!hasUI || isMobile || rawDataExpanded) && (
          <div className="mt-2 pt-2 border-t border-white/10">
            {isMobile ? (
              <>
                {/* 移动端摘要行 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDetailsExpanded(!detailsExpanded)
                  }}
                  className="w-full flex items-center justify-between text-[10px] text-white/40 hover:text-white/60 transition-colors"
                >
                  <span>
                    {hasInputs && t('canvas.inputsCount', { count: nodeData.inputs!.length })}
                    {hasInputs && hasOutputs && ' | '}
                    {hasOutputs && t('canvas.outputsCount', { count: Object.keys(nodeData.outputs!).length })}
                  </span>
                  {detailsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>

                {/* 移动端展开内容 */}
                {detailsExpanded && (
                  <div className="mt-2">
                    {hasInputs && (
                      <div className="mb-2">
                        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">{t('canvas.inputs')}</div>
                        <div className="flex flex-wrap gap-1">
                          {nodeData.inputs!.map((input) => (
                            <span
                              key={input}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 border border-white/5"
                            >
                              {input}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {hasOutputs && (
                      <div>
                        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">{t('canvas.outputs')}</div>
                        <div className="space-y-1">
                          {Object.entries(nodeData.outputs!).map(([key, value]) => (
                            <div key={key} className="flex items-center gap-2 text-[10px]">
                              <span className="text-white/40 font-mono">{key}:</span>
                              <span className="text-white/60 font-mono truncate">{String(value)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* 桌面端：完整显示 */
              <>
                {hasInputs && (
                  <div className="mb-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">{t('canvas.inputs')}</div>
                    <div className="flex flex-wrap gap-1">
                      {nodeData.inputs!.map((input) => (
                        <span
                          key={input}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50 border border-white/5"
                        >
                          {input}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {hasOutputs && (
                  <div>
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">{t('canvas.outputs')}</div>
                    <div className="space-y-1">
                      {Object.entries(nodeData.outputs!).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2 text-[10px]">
                          <span className="text-white/40 font-mono">{key}:</span>
                          <span className="text-white/60 font-mono truncate">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
})

GlowNode.displayName = 'GlowNode'

export default GlowNode
