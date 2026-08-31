/**
 * send-feishu 节点自定义 UI 组件（module 模式，ui.apiVersion: 1）
 * 飞书通知发送状态卡片：发送结果、耗时、执行信息与错误提示。
 * 契约：默认导出 mount(el, props) => { update(props), unmount() }
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

function el(tag, style, text) {
  const node = document.createElement(tag)
  if (style) node.style.cssText = style
  if (text !== undefined) node.textContent = text
  return node
}

export default function mount(container, props) {
  container.style.cssText = [
    'font-family: system-ui, sans-serif',
    'background: linear-gradient(135deg, rgba(59,130,246,0.10), rgba(34,211,238,0.06))',
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

  // 头部：图标 + 标题 + 状态
  const icon = el('span', 'font-size:16px;line-height:1', '💬')
  const title = el('strong', 'font-size:12px', '发送飞书通知')
  const dot = el('span', 'width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-left:auto')
  const header = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:8px')
  header.append(icon, title, dot)

  // 发送结果主行
  const resultIcon = el('span', 'font-size:20px;line-height:1')
  const resultText = el('div', 'font-size:14px;font-weight:600')
  const resultSub = el('div', 'font-size:10px;color:rgba(255,255,255,0.45)')
  const resultBox = el('div', 'display:flex;flex-direction:column;gap:1px')
  resultBox.append(resultText, resultSub)
  const result = el('div', [
    'display: flex',
    'align-items: center',
    'gap: 10px',
    'background: rgba(255,255,255,0.05)',
    'border-radius: 10px',
    'padding: 8px 10px',
    'margin-bottom: 8px',
  ].join(';'))
  result.append(resultIcon, resultBox)

  // 元信息行：参数数 / 耗时 / 触发方式
  const meta = el('div', 'display:flex;gap:6px;font-size:9px;color:rgba(255,255,255,0.4)')

  // 错误提示
  const errorBox = el('div', [
    'display: none',
    'font-size: 10px',
    'color: #fb7185',
    'background: rgba(251,113,133,0.08)',
    'border-radius: 8px',
    'padding: 4px 8px',
    'margin-top: 6px',
    'word-break: break-all',
  ].join(';'))

  const spacer = el('div', 'flex:1')
  container.append(header, result, meta, spacer, errorBox)

  function metaChip(text) {
    return el('span', 'background:rgba(255,255,255,0.05);border-radius:6px;padding:2px 6px', text)
  }

  function render(p) {
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
  }

  render(props)

  return {
    update(next) { render(next) },
    unmount() { container.textContent = '' },
  }
}
