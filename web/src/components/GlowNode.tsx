import { memo, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIsMobile, useViewportWidth } from '@/hooks/useMediaQuery'
import { useExecutionStore } from '@/stores/executionStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getCurrentTheme } from '@/utils/theme'
import ModuleNodeWidget, { buildWidgetUrl } from '@/components/ModuleNodeWidget'
import OutputExplorer from '@/components/OutputExplorer'
import type { NodeWidgetExecution, NodeWidgetParamSource, NodeWidgetProps } from '@/types/nodeWidget'
import type { NodeUIConfig } from '@/types/node'
import type { NodePreview } from '@/types/workflow'
import type { ExecutionStatus } from '@/types/execution'
import type { NodeWidgetStatus } from '@/types/nodeWidget'
import type { ExecutorInstanceInfo, NodeExecutorInfo, OutputIncompleteReason } from '@/types/workflow'

interface GlowNodeData {
  id: string
  name: string
  description?: string
  /** 节点状态；回放态直接播种后端执行节点记录，可能出现 paused/cancelled/pending 等非画布态取值 */
  status: string
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
  /** 节点实例当前参数绑定（workflow YAML config.params），供自定义 UI 展示 */
  params?: Record<string, string>
  /** 各参数绑定的来源信息（Studio 解析 YAML 生成；node 类的 runtimeValue 由本组件补充） */
  paramSources?: Record<string, NodeWidgetParamSource>
  /** 参数写回回调（编辑态提供；回放态缺省，组件进入只读） */
  onParamsChange?: (params: Record<string, string>) => void
  /** 画布编辑模式标记：false 时节点不可选中、内嵌 UI 不可交互（缺省视为 true） */
  interactive?: boolean
  /** 离场标记：节点被外部删除后先播缩小淡出动画，再由画布移除 */
  leaving?: boolean
  /** 节点运行中推送的实时预览帧（如采样逐帧图像）：透传给自定义 UI 组件
      （props.preview）由其自行渲染；外壳不渲染预览。node_complete 后保留最后一帧
      （帧源有 TTL，过期由组件 onerror 回退），切换/取消选中执行时随运行时数据清除 */
  preview?: NodePreview
  /** 节点最终跑在哪个执行器上（画布查询 /workflows/:id/executors 注入；
      编辑态按当前定义实时解析，回放态用执行快照，与当时实际执行一致） */
  executor?: NodeExecutorInfo
  /** 执行器实例详情（徽章 tooltip 里的镜像/地址） */
  executorInstance?: ExecutorInstanceInfo
  /** 输出可能不完整：执行器流被截断（已重挂/补齐）或声明了 extract 却零提取 */
  outputIncomplete?: OutputIncompleteReason
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

// 执行器徽章配色：docker 蓝 / local 灰；降级、匿名实例等带 warning 的用琥珀色提醒
const executorBadgeColor = (info: NodeExecutorInfo): string => {
  if (info.warning) return '#fbbf24'
  if (info.type === 'docker') return '#38bdf8'
  if (info.type === 'local') return '#94a3b8'
  return '#a78bfa'
}

const GlowNode = memo(({ data, selected }: NodeProps) => {
  const { t } = useTranslation()
  const nodeData = data as unknown as GlowNodeData
  const { name, description, language, accentColor = '#6366f1' } = nodeData
  // 未知状态（如后端执行节点记录的 paused/cancelled/pending）回退为 idle，避免渲染崩溃
  const status = (
    nodeData.status && nodeData.status in statusConfig ? nodeData.status : 'idle'
  ) as NodeWidgetStatus
  const config = statusConfig[status]
  const isMobile = useIsMobile()

  const hasUI = !!(nodeData.ui?.entry && nodeData.nodeDbId)
  // 执行器徽章：名称/类型/来源/实例详情与输出完整性提示（画布注入）
  const executor = nodeData.executor
  const executorInstance = nodeData.executorInstance
  const outputIncomplete = nodeData.outputIncomplete
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

  // 收缩状态：桌面端默认展开；移动端默认收起（ui.collapsed === false 的组件除外）。
  // 节点头部 chevron 单独切换为本地覆盖；顶栏「一键收缩/展开」经全局 tick 信号
  // 下发目标状态并重置本地覆盖。收缩/展开改变节点实测尺寸，画布按尺寸变化自动重排
  const defaultCollapsed = isMobile && !(hasUI && nodeData.ui?.collapsed === false)
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null)
  const collapseTick = useWorkflowStore((s) => s.nodesCollapseTick)
  const globalCollapsed = useWorkflowStore((s) => s.nodesCollapsed)
  useEffect(() => {
    // 全局信号（含初始挂载外的每次 tick 变化）重置本地覆盖；tick 为 0 时保持默认
    setCollapsedOverride(null)
  }, [collapseTick])
  const collapsed = collapsedOverride ?? (collapseTick > 0 ? globalCollapsed : defaultCollapsed)
  // 带 UI 组件时，桌面端原生入参/返回摘要默认折叠为“查看数据”开关
  const [rawDataExpanded, setRawDataExpanded] = useState(false)

  // 执行器徽章 tooltip：实例名/类型、镜像、地址、解析来源、降级提示
  const executorTooltip = useMemo(() => {
    if (!executor) return undefined
    const sourceKey = executor.source ? `canvas.executorSource_${executor.source.replace(/-/g, '_')}` : ''
    const sourceLabel = sourceKey ? t(sourceKey) : ''
    const lines = [
      `${t('canvas.executorLabel')}: ${executor.executor || '—'} (${executor.type || '—'})`,
    ]
    if (executorInstance?.image) lines.push(`${t('canvas.executorImage')}: ${executorInstance.image}`)
    if (executorInstance?.host) lines.push(`${t('canvas.executorHost')}: ${executorInstance.host}`)
    // i18next 缺键时原样返回 key，此时回退到原始 source 值
    if (sourceLabel && sourceLabel !== sourceKey) lines.push(`${t('canvas.executorSource')}: ${sourceLabel}`)
    if (executor.warning) lines.push(`${t('canvas.executorWarning')}: ${executor.warning}`)
    return lines.join('\n')
  }, [executor, executorInstance, t])

  const outputIncompleteTooltip = outputIncomplete
    ? outputIncomplete === 'stream-truncated'
      ? t('canvas.outputIncompleteStream')
      : t('canvas.outputIncompleteExtract')
    : undefined

  // 仅带 UI 组件的节点订阅执行实例 metadata，避免无关重渲染
  const selectedExecution = useExecutionStore((s) => (hasUI ? s.selectedExecution : null))
  // 仅带 UI 组件的节点订阅全图运行时数据：解析 {{ 节点.字段 }} 绑定的运行时值
  const nodeRuntimeData = useWorkflowStore((s) => (hasUI ? s.nodeRuntimeData : null))
  // 订阅主题偏好，切换主题时重渲染 widget
  useSettingsStore((s) => s.systemSettings.theme)

  // 为 node 类参数来源补充上游节点的运行时输出值（执行中/回放有数据时）
  const paramSources = useMemo(() => {
    const src = nodeData.paramSources
    if (!src) return undefined
    let merged = src
    for (const [key, s] of Object.entries(src)) {
      if (s.kind !== 'node' || !s.nodeId || !s.field) continue
      const rv = nodeRuntimeData?.[s.nodeId]?.outputs?.[s.field]
      if (rv !== undefined && rv !== s.runtimeValue) {
        if (merged === src) merged = { ...src }
        merged[key] = { ...s, runtimeValue: rv }
      }
    }
    return merged
  }, [nodeData.paramSources, nodeRuntimeData])

  const widgetProps = useMemo<NodeWidgetProps>(
    () => ({
      nodeId: nodeData.id,
      nodeRef: nodeData.nodeRef || '',
      status,
      inputs: nodeData.inputs || [],
      outputs: nodeData.outputs || {},
      params: nodeData.params || {},
      paramSources,
      onParamsChange: interactive ? nodeData.onParamsChange : undefined,
      execution: toWidgetExecution(selectedExecution),
      // 实时预览帧透传给节点自定义 UI（组件自行渲染，外壳不渲染预览）
      preview: nodeData.preview,
      theme: getCurrentTheme(),
      locale: typeof navigator !== 'undefined' ? navigator.language : 'zh-CN',
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [nodeData.id, nodeData.nodeRef, status, nodeData.inputs, nodeData.outputs, nodeData.params, paramSources, nodeData.onParamsChange, interactive, selectedExecution, nodeData.preview]
  )

  const hasInputs = nodeData.inputs && nodeData.inputs.length > 0
  const hasOutputs = nodeData.outputs && Object.keys(nodeData.outputs).length > 0
  const hasDetails = hasInputs || hasOutputs
  const leaving = nodeData.leaving === true

  const isHorizontal = nodeData.direction === 'LR'
  const targetPosition = isHorizontal ? Position.Left : Position.Top
  const sourcePosition = isHorizontal ? Position.Right : Position.Bottom

  return (
    <motion.div
      className="relative"
      style={leaving ? { pointerEvents: 'none' } : undefined}
      initial={{ scale: 0.85, opacity: 0, y: 10 }}
      animate={leaving ? { scale: 0.6, opacity: 0, y: 8 } : { scale: 1, opacity: 1, y: 0 }}
      transition={
        leaving
          ? { duration: 0.3, ease: 'easeIn' }
          : { type: 'spring', stiffness: 300, damping: 25, mass: 0.8 }
      }
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
          // 带内嵌 UI 组件时按组件尺寸撑开节点卡片（移动端有上限）；
          // 收缩态不固定宽度，卡片回到内容宽度
          ...(hasUI && !collapsed ? { width: widgetWidth + 26 } : {}),
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
            {/* 名称行：显示名（YAML Nodes.<id>.name，缺省回退图标签）+ 节点实例 ID 标签 */}
            <div className="flex items-center gap-1.5 min-w-0">
              <div className={`text-white/90 font-semibold truncate ${isMobile ? 'text-xs' : 'text-sm'}`}>{name}</div>
              <span
                className={`px-1 py-px rounded bg-white/5 border border-white/10 text-white/35
                            font-mono flex-shrink-0 ${isMobile ? 'text-[8px]' : 'text-[9px]'}`}
              >
                {nodeData.id}
              </span>
            </div>
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
              {/* 执行器徽章：节点最终跑在哪（docker/local），悬停看镜像/地址/来源 */}
              {executor && (
                <span
                  className={`px-1.5 py-0.5 rounded-full border max-w-[140px] truncate
                              ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}
                  style={{
                    color: executorBadgeColor(executor),
                    borderColor: `${executorBadgeColor(executor)}40`,
                    background: `${executorBadgeColor(executor)}12`,
                  }}
                  title={executorTooltip}
                >
                  {executor.type === 'docker' ? '🐳 ' : executor.type === 'local' ? '🖥 ' : '⚙ '}
                  {/* 展开器为"镜像不一致"节点合成的内部条目名取决于遍历顺序（不稳定），
                      此时只显示类型；tooltip 里仍给出实例名与镜像/地址 */}
                  {executorInstance && executorInstance.registered === false
                    ? executor.type || executor.executor
                    : executor.executor || executor.type || '—'}
                </span>
              )}
              {/* 输出可能不完整：执行器流被截断，或声明 extract 却零提取 */}
              {outputIncomplete && (
                <span
                  className={`px-1.5 py-0.5 rounded-full border border-amber-400/40 bg-amber-400/10
                              text-amber-300 ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}
                  title={outputIncompleteTooltip}
                >
                  ⚠ {t('canvas.outputIncomplete')}
                </span>
              )}
            </div>
          </div>

          {/* 单节点收缩/展开（有可收缩内容时显示）：改变节点尺寸触发画布重排 */}
          {(hasUI || hasDetails) && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setCollapsedOverride(!collapsed)
              }}
              className="flex-shrink-0 p-0.5 rounded text-white/30 hover:text-white/60
                         hover:bg-white/5 transition-colors pointer-events-auto"
              title={collapsed ? t('canvas.expandNode') : t('canvas.collapseNode')}
            >
              {collapsed ? <ChevronDown size={isMobile ? 12 : 14} /> : <ChevronUp size={isMobile ? 12 : 14} />}
            </button>
          )}
        </div>

        {/* 输出连接点 */}
        <Handle
          type="source"
          position={sourcePosition}
          id="source"
          className="w-3 h-3 !bg-white/20 !border-white/30"
        />

        {/* 内嵌自定义 UI 组件（未收缩时显示；移动端默认收缩随详情展开） */}
        {hasUI && !collapsed && (
          // 预览/回放态不再拦截指针事件：只读由契约保证（回放态不下发 onParamsChange，
          // 组件自行进入只读）；交互式组件（如对话弹窗、查看详情）在预览态需要可点击。
          // 拖拽/滚轮误触由 ModuleNodeWidget 容器的 nodrag nowheel class 拦截。
          <div
            className="mt-2 pt-2 border-t border-white/10"
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

        {/* 入参与返回数据：桌面端随节点收缩隐藏（UI 组件节点仍由「查看数据」开关控制）；
            移动端摘要行常显，内容随收缩展开 */}
        {hasDetails && (isMobile || !collapsed) && (!hasUI || isMobile || rawDataExpanded) && (
          <div className="mt-2 pt-2 border-t border-white/10">
            {isMobile ? (
              <>
                {/* 移动端摘要行 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setCollapsedOverride(!collapsed)
                  }}
                  className="w-full flex items-center justify-between text-[10px] text-white/40 hover:text-white/60 transition-colors"
                >
                  <span>
                    {hasInputs && t('canvas.inputsCount', { count: nodeData.inputs!.length })}
                    {hasInputs && hasOutputs && ' | '}
                    {hasOutputs && t('canvas.outputsCount', { count: Object.keys(nodeData.outputs!).length })}
                  </span>
                  {!collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>

                {/* 移动端展开内容 */}
                {!collapsed && (
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
                      <OutputExplorer outputs={nodeData.outputs!} compact />
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
                  <OutputExplorer outputs={nodeData.outputs!} compact />
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
