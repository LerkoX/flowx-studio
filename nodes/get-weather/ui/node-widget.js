/**
 * get-weather 节点自定义 UI 组件（module 模式，ui.apiVersion: 1）
 * 天气报告文本卡片：渲染节点唯一输出 text（组织好的 Markdown 天气报告）。
 * 契约：默认导出 mount(el, props) => { update(props), unmount() }
 */

const STATUS_COLORS = {
  idle: '#94a3b8',
  running: '#22d3ee',
  success: '#34d399',
  failed: '#fb7185',
  skipped: '#64748b',
}

function el(tag, style, text) {
  const node = document.createElement(tag)
  if (style) node.style.cssText = style
  if (text !== undefined) node.textContent = text
  return node
}

// 轻量 Markdown 渲染：**加粗**、- 列表项换行，其余按纯文本展示
function renderMarkdown(text) {
  const frag = document.createDocumentFragment()
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.replace(/\*\*(.+?)\*\*/g, '$1')
    const isHeader = /\*\*.+\*\*/.test(rawLine)
    const div = el('div', isHeader
      ? 'font-size:12px;font-weight:600;color:#fff;margin-top:4px'
      : 'font-size:11px;color:rgba(255,255,255,0.6)')
    div.textContent = line || ' '
    frag.appendChild(div)
  }
  return frag
}

export default function mount(container, props) {
  container.style.cssText = [
    'font-family: system-ui, sans-serif',
    'background: linear-gradient(135deg, rgba(56,189,248,0.10), rgba(168,85,247,0.08))',
    'border: 1px solid rgba(255,255,255,0.08)',
    'border-radius: 12px',
    'padding: 12px',
    'color: rgba(255,255,255,0.85)',
    'overflow: hidden',
    'box-sizing: border-box',
    'height: 100%',
    'display: flex',
    'flex-direction: column',
  ].join(';')

  // 头部：状态点 + 标题 + 状态
  const dot = el('span', 'width:8px;height:8px;border-radius:50%;flex-shrink:0')
  const title = el('strong', 'font-size:12px', '获取天气')
  const statusLabel = el('span', 'color:rgba(255,255,255,0.35);margin-left:auto;font-size:10px')
  const header = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:8px')
  header.append(dot, title, statusLabel)

  // 报告文本区（可滚动，隐藏滚动条）
  if (!document.getElementById('fxw-weather-style')) {
    const style = document.createElement('style')
    style.id = 'fxw-weather-style'
    style.textContent = '.fxw-weather-text::-webkit-scrollbar{display:none}'
    document.head.appendChild(style)
  }
  const body = el('div', [
    'flex: 1',
    'overflow-y: auto',
    'scrollbar-width: none',
    'background: rgba(255,255,255,0.04)',
    'border-radius: 8px',
    'padding: 8px 10px',
    'line-height: 1.5',
    'white-space: pre-wrap',
    'word-break: break-all',
  ].join(';'))
  body.className = 'fxw-weather-text'

  // 底部：执行信息
  const footer = el('div', 'font-size:9px;color:rgba(255,255,255,0.3);margin-top:6px')

  container.append(header, body, footer)

  function render(p) {
    const o = p.outputs || {}
    dot.style.background = STATUS_COLORS[p.status] || STATUS_COLORS.idle
    statusLabel.textContent = p.status

    body.textContent = ''
    if (o.text) {
      body.appendChild(renderMarkdown(o.text))
    } else {
      body.appendChild(el('div', 'font-size:10px;color:rgba(255,255,255,0.25);text-align:center;margin-top:30px', '暂无天气报告'))
    }

    footer.textContent = p.execution ? `流水线 ${p.execution.status}` : ''
  }

  render(props)

  return {
    update(next) { render(next) },
    unmount() { container.textContent = '' },
  }
}
