/**
 * send-feishu 节点自定义 UI 组件（module 模式，ui.apiVersion: 1）
 * 参数控件：通知标题 + 飞书应用凭据（可折叠）；下方为发送状态与结果。
 * 契约：mount(el, props) => { update(props), unmount() }
 *   props.params — 当前 config.params 绑定（模板值只读展示，如 content 通常接线上游）
 *   props.onParamsChange(params) — 全量写回该节点参数（回放态缺省 = 控件只读）
 */

const STATUS_COLORS = {
  idle: '#94a3b8',
  running: '#22d3ee',
  success: '#34d399',
  failed: '#fb7185',
  skipped: '#64748b',
}

const STATUS_TEXT = {
  idle: '待执行',
  running: '发送中…',
  success: '发送成功',
  failed: '发送失败',
  skipped: '已跳过',
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

export default function mount(container, props) {
  container.style.cssText = [
    'font-family: system-ui, sans-serif',
    'background: linear-gradient(135deg, rgba(59,130,246,0.10), rgba(34,211,238,0.06))',
    'border: 1px solid rgba(255,255,255,0.08)',
    'border-radius: 12px',
    'padding: 12px',
    'color: rgba(255,255,255,0.85)',
    'overflow-y: auto',
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

  const textControl = (key, placeholder, type) => {
    const raw = (cur.params || {})[key]
    if (isWired(raw)) {
      return h('div', 'font-size:10px;color:rgba(165,180,252,0.75);font-family:ui-monospace,Menlo,monospace;background:rgba(99,102,241,0.10);border:1px solid rgba(99,102,241,0.22);border-radius:6px;padding:3px 7px;word-break:break-all', '⟵ ' + raw)
    }
    const inp = h('input', INPUT_CSS)
    inp.type = type || 'text'
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

  // 头部：图标 + 标题 + 状态
  const icon = h('span', 'font-size:16px;line-height:1', '💬')
  const title = h('strong', 'font-size:12px', '发送飞书通知')
  const dot = h('span', 'width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-left:auto')
  const header = h('div', 'display:flex;align-items:center;gap:6px;margin-bottom:8px')
  header.append(icon, title, dot)

  // 参数控件：标题 + 内容（通常接线上游）
  const controls = h('div', 'margin-bottom:8px')
  controls.append(
    field('通知标题 title', textControl('title', '通知')),
    field('内容 content', textControl('content', '通常由上游节点接线提供')),
  )

  // 凭据设置（折叠）
  const credToggle = h('button', 'font-size:10px;color:rgba(255,255,255,0.45);background:none;border:none;padding:0;cursor:pointer;text-align:left;margin-bottom:4px', '🔑 凭据设置 ▸')
  const credBox = h('div', 'display:none;margin-bottom:8px')
  credBox.append(
    field('App ID', textControl('feishuAppId', 'cli_xxx')),
    field('App Secret', textControl('feishuAppSecret', '应用密钥', 'password')),
    field('Chat ID', textControl('feishuChatId', 'oc_xxx')),
  )
  let credOpen = false
  credToggle.addEventListener('click', () => {
    credOpen = !credOpen
    credBox.style.display = credOpen ? 'block' : 'none'
    credToggle.textContent = credOpen ? '🔑 凭据设置 ▾' : '🔑 凭据设置 ▸'
  })

  // 发送结果主行
  const resultIcon = h('span', 'font-size:20px;line-height:1')
  const resultText = h('div', 'font-size:14px;font-weight:600')
  const resultSub = h('div', 'font-size:10px;color:rgba(255,255,255,0.45)')
  const resultBox = h('div', 'display:flex;flex-direction:column;gap:1px')
  resultBox.append(resultText, resultSub)
  const result = h('div', [
    'display: flex', 'align-items: center', 'gap: 10px',
    'background: rgba(255,255,255,0.05)', 'border-radius: 10px',
    'padding: 8px 10px', 'margin-bottom: 8px',
  ].join(';'))
  result.append(resultIcon, resultBox)

  const meta = h('div', 'display:flex;gap:6px;font-size:9px;color:rgba(255,255,255,0.4)')

  const errorBox = h('div', [
    'display: none', 'font-size: 10px', 'color: #fb7185',
    'background: rgba(251,113,133,0.08)', 'border-radius: 8px',
    'padding: 4px 8px', 'margin-top: 6px', 'word-break: break-all',
  ].join(';'))

  const spacer = h('div', 'flex:1')
  container.append(header, controls, credToggle, credBox, result, meta, spacer, errorBox)

  function metaChip(text) {
    return h('span', 'background:rgba(255,255,255,0.05);border-radius:6px;padding:2px 6px', text)
  }

  function render(p) {
    cur = p
    const o = p.outputs || {}
    const exec = p.execution

    dot.style.background = STATUS_COLORS[p.status] || STATUS_COLORS.idle

    const sent = p.status === 'success' && (!o.status || /ok|success|sent|成功/i.test(String(o.status)))
    resultIcon.textContent = p.status === 'success' ? (sent ? '✅' : '⚠️')
      : p.status === 'failed' ? '❌'
      : p.status === 'running' ? '📤'
      : '💬'
    resultText.textContent = STATUS_TEXT[p.status] || p.status
    resultText.style.color = STATUS_COLORS[p.status] || STATUS_COLORS.idle
    resultSub.textContent = o.status
      ? `飞书返回: ${o.status}`
      : p.status === 'idle' ? '等待上游文本内容与执行' : ''

    meta.textContent = ''
    meta.append(metaChip(`${(p.inputs || []).length} 个入参`))
    if (exec?.durationMs) meta.append(metaChip(`耗时 ${(exec.durationMs / 1000).toFixed(1)}s`))
    if (exec?.trigger) meta.append(metaChip(`触发: ${exec.trigger}`))

    const errMsg = exec?.errorMessage
    if (p.status === 'failed' && errMsg) {
      errorBox.style.display = 'block'
      errorBox.textContent = errMsg
    } else {
      errorBox.style.display = 'none'
      errorBox.textContent = ''
    }

    refreshers.forEach((f) => f())
  }

  render(props)

  return {
    update(next) { render(next) },
    unmount() { container.textContent = '' },
  }
}
