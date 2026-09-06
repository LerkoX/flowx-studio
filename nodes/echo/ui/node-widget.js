/**
 * echo 节点自定义 UI 组件（module 模式，ui.apiVersion: 1）
 * 参数控件：message 文本输入 + sleep 滑杆；下方回显节点输出 text。
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

const INPUT_CSS = 'width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:6px;padding:4px 7px;font-size:11px;color:rgba(255,255,255,0.9);outline:none;box-sizing:border-box;font-family:inherit'
const LABEL_CSS = 'display:block;font-size:9px;color:rgba(255,255,255,0.35);margin-bottom:2px'

function h(tag, style, text) {
  const node = document.createElement(tag)
  if (style) node.style.cssText = style
  if (text !== undefined) node.textContent = text
  return node
}

const isWired = (v) => typeof v === 'string' && v.indexOf('{{') >= 0

function wiredChip(v) {
  return h('div', 'font-size:10px;color:rgba(165,180,252,0.75);font-family:ui-monospace,Menlo,monospace;background:rgba(99,102,241,0.10);border:1px solid rgba(99,102,241,0.22);border-radius:6px;padding:3px 7px;word-break:break-all', '⟵ ' + v)
}

export default function mount(container, props) {
  container.style.cssText = [
    'font-family: system-ui, sans-serif',
    'background: linear-gradient(135deg, rgba(34,211,238,0.10), rgba(168,85,247,0.08))',
    'border: 1px solid rgba(255,255,255,0.08)',
    'border-radius: 12px',
    'padding: 10px 12px',
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

  const field = (label, control) => {
    const wrap = h('div', 'margin-bottom:6px')
    wrap.append(h('label', LABEL_CSS, label), control)
    return wrap
  }

  const textControl = (key, placeholder) => {
    const raw = (cur.params || {})[key]
    if (isWired(raw)) return wiredChip(raw)
    const inp = h('input', INPUT_CSS)
    inp.type = 'text'
    inp.value = raw !== undefined ? raw : ''
    inp.placeholder = placeholder || ''
    inp.addEventListener('change', () => setParam(key, inp.value))
    refreshers.push(() => {
      inp.disabled = !editable()
      inp.style.opacity = editable() ? '1' : '0.55'
      if (document.activeElement === inp) return
      const nv = (cur.params || {})[key]
      inp.value = nv !== undefined ? nv : ''
    })
    return inp
  }

  const sliderControl = (key, min, max, step, def, fmt) => {
    const raw = (cur.params || {})[key]
    if (isWired(raw)) return wiredChip(raw)
    const num = (x) => { const n = parseFloat(x); return isNaN(n) ? def : n }
    const wrap = h('div', 'display:flex;align-items:center;gap:6px')
    const sl = h('input', 'flex:1;accent-color:#818cf8;margin:0;min-width:0')
    sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step
    const val = h('span', 'font-size:10px;color:rgba(255,255,255,0.6);min-width:30px;text-align:right;font-family:ui-monospace,Menlo,monospace')
    sl.value = String(num(raw))
    val.textContent = fmt(num(raw))
    sl.addEventListener('input', () => { val.textContent = fmt(parseFloat(sl.value)) })
    sl.addEventListener('change', () => setParam(key, sl.value))
    refreshers.push(() => {
      sl.disabled = !editable()
      sl.style.opacity = editable() ? '1' : '0.55'
      const nv = num((cur.params || {})[key])
      sl.value = String(nv)
      val.textContent = fmt(nv)
    })
    wrap.append(sl, val)
    return wrap
  }

  // 头部：状态点 + 标题 + 状态
  const dot = h('span', 'width:8px;height:8px;border-radius:50%;flex-shrink:0')
  const title = h('strong', 'font-size:12px', '📣 回声')
  const statusLabel = h('span', 'color:rgba(255,255,255,0.35);margin-left:auto;font-size:10px')
  const header = h('div', 'display:flex;align-items:center;gap:6px;margin-bottom:8px')
  header.append(dot, title, statusLabel)

  // 参数控件
  const controls = h('div', 'margin-bottom:6px')
  controls.append(
    field('消息 message', textControl('message', 'hello')),
    field('休眠 sleep（秒）', sliderControl('sleep', 0, 5, 0.5, 0, (v) => v + 's')),
  )

  // 输出区
  const outputText = h('div', [
    'flex: 1', 'font-size: 11px', 'background: rgba(255,255,255,0.04)',
    'border-radius: 8px', 'padding: 5px 8px', 'word-break: break-all', 'overflow: hidden',
  ].join(';'))

  const footer = h('div', 'font-size:9px;color:rgba(255,255,255,0.3);margin-top:6px')

  container.append(header, controls, outputText, footer)

  function render(p) {
    cur = p
    const o = p.outputs || {}
    dot.style.background = STATUS_COLORS[p.status] || STATUS_COLORS.idle
    statusLabel.textContent = p.status || ''

    if (o.text) {
      outputText.textContent = '↳ ' + o.text
      outputText.style.color = 'rgba(255,255,255,0.85)'
    } else {
      outputText.textContent = p.status === 'running' ? '输出中…' : '等待输出'
      outputText.style.color = 'rgba(255,255,255,0.25)'
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
