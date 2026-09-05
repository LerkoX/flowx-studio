/**
 * echo 节点自定义 UI 组件（module 模式，ui.apiVersion: 1）
 * 回显卡片：大字展示节点输出 text（实际 echo 的消息），反映节点"输出了什么"。
 * 契约：默认导出 mount(el, props) => { update(props), unmount() }
 * props 只读：{ status, inputs, outputs, execution }
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

  // 头部：状态点 + 标题 + 状态
  const dot = el('span', 'width:8px;height:8px;border-radius:50%;flex-shrink:0')
  const title = el('strong', 'font-size:12px', '📣 回声')
  const statusLabel = el('span', 'color:rgba(255,255,255,0.35);margin-left:auto;font-size:10px')
  const header = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:6px')
  header.append(dot, title, statusLabel)

  // 输出区：大字回显 text
  const output = el('div', [
    'flex: 1',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'background: rgba(255,255,255,0.04)',
    'border-radius: 8px',
    'padding: 6px 10px',
    'overflow: hidden',
  ].join(';'))
  const outputText = el('span', [
    'font-size: 13px',
    'color: rgba(255,255,255,0.9)',
    'text-align: center',
    'word-break: break-all',
    'display: -webkit-box',
    '-webkit-line-clamp: 3',
    '-webkit-box-orient: vertical',
    'overflow: hidden',
  ].join(';'))
  output.appendChild(outputText)

  // 底部：执行信息
  const footer = el('div', 'font-size:9px;color:rgba(255,255,255,0.3);margin-top:6px')

  container.append(header, output, footer)

  function render(p) {
    const o = p.outputs || {}
    dot.style.background = STATUS_COLORS[p.status] || STATUS_COLORS.idle
    statusLabel.textContent = p.status || ''

    if (o.text) {
      outputText.textContent = o.text
      outputText.style.color = 'rgba(255,255,255,0.9)'
    } else {
      outputText.textContent = p.status === 'running' ? '输出中…' : '等待输出'
      outputText.style.color = 'rgba(255,255,255,0.25)'
    }

    footer.textContent = p.execution ? `流水线 ${p.execution.status}` : ''
  }

  render(props)

  return {
    update(next) { render(next) },
    unmount() { container.textContent = '' },
  }
}
