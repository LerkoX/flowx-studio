/**
 * get-weather 节点自定义 UI 组件（module 模式，ui.apiVersion: 1）
 * 天气报告文本卡片：顶部 city 参数输入，下方渲染节点输出 text（Markdown 天气报告）。
 * 契约：mount(el, props) => { update(props), unmount() }
 *   props.params — 当前 config.params 绑定（模板值只读展示）
 *   props.onParamsChange(params) — 全量写回该节点参数（回放态缺省 = 控件只读）
 */

const STATUS_COLORS = {
  idle: '#94a3b8',
  running: '#22d3ee',
  success: '#34d399',
  failed: '#fb7185',
  skipped: '#64748b',
}

const INPUT_CSS = 'width:180px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:6px;padding:3px 7px;font-size:11px;color:rgba(255,255,255,0.9);outline:none;box-sizing:border-box;font-family:inherit'

function h(tag, style, text) {
  const node = document.createElement(tag)
  if (style) node.style.cssText = style
  if (text !== undefined) node.textContent = text
  return node
}

const isWired = (v) => typeof v === 'string' && v.indexOf('{{') >= 0

// 轻量 Markdown 渲染：**加粗**、- 列表项换行，其余按纯文本展示
function renderMarkdown(text) {
  const frag = document.createDocumentFragment()
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.replace(/\*\*(.+?)\*\*/g, '$1')
    const isHeader = /\*\*.+\*\*/.test(rawLine)
    const div = h('div', isHeader
      ? 'font-size:12px;font-weight:600;color:#fff;margin-top:4px'
      : 'font-size:11px;color:rgba(255,255,255,0.6)')
    div.textContent = line || ' '
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

  let cur = props
  const refreshers = []
  const editable = () => typeof cur.onParamsChange === 'function'
  const setParam = (key, value) => {
    if (!editable()) return
    const params = { ...(cur.params || {}), [key]: String(value) }
    cur = { ...cur, params }
    cur.onParamsChange(params)
  }

  // 头部：状态点 + 标题 + 城市参数 + 状态
  const dot = h('span', 'width:8px;height:8px;border-radius:50%;flex-shrink:0')
  const title = h('strong', 'font-size:12px', '获取天气')
  const statusLabel = h('span', 'color:rgba(255,255,255,0.35);margin-left:auto;font-size:10px')
  const header = h('div', 'display:flex;align-items:center;gap:6px;margin-bottom:8px')

  const rawCity = (cur.params || {}).city
  let cityControl
  if (isWired(rawCity)) {
    cityControl = h('span', 'font-size:10px;color:rgba(165,180,252,0.75);font-family:ui-monospace,Menlo,monospace;background:rgba(99,102,241,0.10);border:1px solid rgba(99,102,241,0.22);border-radius:6px;padding:2px 6px', '⟵ ' + rawCity)
  } else {
    cityControl = h('input', INPUT_CSS)
    cityControl.type = 'text'
    cityControl.value = rawCity !== undefined ? rawCity : ''
    cityControl.placeholder = '城市名，如 深圳'
    cityControl.addEventListener('change', () => setParam('city', cityControl.value))
    refreshers.push(() => {
      cityControl.disabled = !editable()
      cityControl.style.opacity = editable() ? '1' : '0.55'
      if (document.activeElement === cityControl) return
      const nv = (cur.params || {}).city
      cityControl.value = nv !== undefined ? nv : ''
    })
  }
  header.append(dot, title, cityControl, statusLabel)

  // 报告文本区（可滚动，隐藏滚动条）
  if (!document.getElementById('fxw-weather-style')) {
    const style = document.createElement('style')
    style.id = 'fxw-weather-style'
    style.textContent = '.fxw-weather-text::-webkit-scrollbar{display:none}'
    document.head.appendChild(style)
  }
  const body = h('div', [
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

  const footer = h('div', 'font-size:9px;color:rgba(255,255,255,0.3);margin-top:6px')

  container.append(header, body, footer)

  function render(p) {
    cur = p
    const o = p.outputs || {}
    dot.style.background = STATUS_COLORS[p.status] || STATUS_COLORS.idle
    statusLabel.textContent = p.status

    body.textContent = ''
    if (o.text) {
      body.appendChild(renderMarkdown(o.text))
    } else {
      body.appendChild(h('div', 'font-size:10px;color:rgba(255,255,255,0.25);text-align:center;margin-top:30px', '暂无天气报告'))
    }

    footer.textContent = p.execution ? `流水线 ${p.execution.status}` : ''
    refreshers.forEach((f) => f())
  }

  render(props)

  return {
    update(next) { render(next) },
    unmount() { container.textContent = '' },
  }
}
