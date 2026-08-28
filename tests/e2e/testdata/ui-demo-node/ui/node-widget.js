/**
 * ui-demo-node 自定义 UI 组件（module 模式，ui.apiVersion: 1）
 *
 * 契约：默认导出 mount(el, props) => { update(props), unmount() }
 *  - mount(el, props)：把组件挂载到 el，返回控制句柄
 *  - update(props)  ：节点数据（状态/入参/输出/流水线 metadata）变化时调用
 *  - unmount()      ：节点卸载时调用，清理 DOM 与副作用
 *
 * props 结构见 docs/11-node-package.md 的 ui 章节（NodeWidgetProps）。
 * 本示例不依赖任何框架，直接以原生 DOM 渲染。
 */

const STATUS_COLORS = {
  idle: '#94a3b8',
  running: '#22d3ee',
  success: '#34d399',
  failed: '#fb7185',
  skipped: '#64748b',
}

export default function mount(el, props) {
  el.style.cssText = [
    'font-family: system-ui, sans-serif',
    'background: rgba(255,255,255,0.04)',
    'border: 1px solid rgba(255,255,255,0.08)',
    'border-radius: 12px',
    'padding: 10px',
    'font-size: 11px',
    'line-height: 1.7',
    'color: rgba(255,255,255,0.85)',
    'overflow: auto',
    'box-sizing: border-box',
    'height: 100%',
  ].join(';')

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px'

  const dot = document.createElement('span')
  dot.style.cssText = 'width:8px;height:8px;border-radius:50%;flex-shrink:0'

  const title = document.createElement('strong')
  title.textContent = 'ui-demo-node'
  title.style.fontSize = '12px'

  const statusLabel = document.createElement('span')
  statusLabel.style.cssText = 'color:rgba(255,255,255,0.35);margin-left:auto'

  header.append(dot, title, statusLabel)

  const inputsLine = document.createElement('div')
  inputsLine.style.color = 'rgba(255,255,255,0.45)'

  const outputsBox = document.createElement('div')

  const executionLine = document.createElement('div')
  executionLine.style.cssText = 'color:rgba(255,255,255,0.3);margin-top:4px'

  el.append(header, inputsLine, outputsBox, executionLine)

  function render(p) {
    dot.style.background = STATUS_COLORS[p.status] || STATUS_COLORS.idle
    statusLabel.textContent = p.status
    inputsLine.textContent = `入参: ${(p.inputs || []).join(', ') || '无'}`

    outputsBox.textContent = ''
    const entries = Object.entries(p.outputs || {})
    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.style.color = 'rgba(255,255,255,0.25)'
      empty.textContent = '暂无输出'
      outputsBox.append(empty)
    } else {
      for (const [key, value] of entries) {
        const row = document.createElement('div')
        const k = document.createElement('span')
        k.style.color = 'rgba(255,255,255,0.4)'
        k.textContent = `${key}: `
        const v = document.createElement('span')
        v.style.color = 'rgba(255,255,255,0.75)'
        v.textContent = String(value)
        row.append(k, v)
        outputsBox.append(row)
      }
    }

    executionLine.textContent = p.execution
      ? `流水线执行: ${p.execution.status}${p.execution.trigger ? ` (${p.execution.trigger})` : ''}`
      : '流水线执行: 无运行实例'
  }

  render(props)

  return {
    update(next) {
      render(next)
    },
    unmount() {
      el.textContent = ''
    },
  }
}
