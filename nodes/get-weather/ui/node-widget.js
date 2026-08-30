/**
 * get-weather 节点自定义 UI 组件（module 模式，ui.apiVersion: 1）
 * 天气卡片：当前天气 + 指标行 + 未来预报横向列表，深色主题与 FlowX Studio 一致。
 * 契约：默认导出 mount(el, props) => { update(props), unmount() }
 */

const STATUS_COLORS = {
  idle: '#94a3b8',
  running: '#22d3ee',
  success: '#34d399',
  failed: '#fb7185',
  skipped: '#64748b',
}

function weatherEmoji(text) {
  const t = String(text || '')
  if (/雷/.test(t)) return '⛈️'
  if (/雪/.test(t)) return '❄️'
  if (/雨|毛毛雨|阵雨/.test(t)) return '🌧️'
  if (/雾|霾/.test(t)) return '🌫️'
  if (/多云/.test(t)) return '⛅'
  if (/阴/.test(t)) return '☁️'
  if (/晴/.test(t)) return '☀️'
  return '🌤️'
}

// forecasts 可能是数组、JSON 字符串或 YAML 字符串（codec-block 提取的结果）
function parseForecasts(v) {
  if (Array.isArray(v)) return v
  if (typeof v !== 'string' || !v.trim()) return []
  try {
    const parsed = JSON.parse(v)
    if (Array.isArray(parsed)) return parsed
  } catch { /* 非 JSON，尝试简易 YAML 解析 */ }
  // 简易 YAML 列表解析："- key: value" 起始新元素，后续 "key: value" 归入当前元素
  const items = []
  let current = null
  for (const rawLine of v.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const m = line.match(/^-\s*(.*)$/)
    if (m) {
      current = {}
      items.push(current)
      const kv = m[1].match(/^(\w+):\s*(.*)$/)
      if (kv) current[kv[1]] = kv[2]
      continue
    }
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (kv && current) current[kv[1]] = kv[2]
  }
  return items
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

  // 主区：emoji + 温度 + 描述/城市
  const emoji = el('span', 'font-size:34px;line-height:1')
  const temp = el('div', 'font-size:26px;font-weight:700;color:#fff;line-height:1.1')
  const weatherText = el('div', 'font-size:11px;color:rgba(255,255,255,0.55)')
  const tempBox = el('div', 'display:flex;flex-direction:column;gap:2px')
  tempBox.append(temp, weatherText)
  const main = el('div', 'display:flex;align-items:center;gap:12px;margin-bottom:8px')
  main.append(emoji, tempBox)

  // 指标行：体感 / 湿度 / 风速
  const metrics = el('div', 'display:flex;gap:8px;font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:8px')

  // 预报横向列表（滚动条视觉隐藏，保留滑动/滚轮滚动）
  if (!document.getElementById('fxw-weather-style')) {
    const style = document.createElement('style')
    style.id = 'fxw-weather-style'
    style.textContent = '.fxw-forecast::-webkit-scrollbar{display:none}'
    document.head.appendChild(style)
  }
  const forecastStrip = el('div', [
    'display: flex',
    'gap: 6px',
    'overflow-x: auto',
    'flex: 1',
    'scrollbar-width: none',
  ].join(';'))
  forecastStrip.className = 'fxw-forecast'

  // 底部：更新时间 + 执行信息
  const footer = el('div', 'font-size:9px;color:rgba(255,255,255,0.3);margin-top:6px')

  container.append(header, main, metrics, forecastStrip, footer)

  function metric(label, value, unit) {
    const box = el('div', 'flex:1;background:rgba(255,255,255,0.05);border-radius:8px;padding:3px 8px;text-align:center')
    box.append(
      el('div', 'color:rgba(255,255,255,0.35);font-size:9px', label),
      el('div', 'color:rgba(255,255,255,0.8);font-size:11px;font-weight:600', value ? `${value}${unit}` : '--')
    )
    return box
  }

  function forecastCard(day) {
    const box = el('div', [
      'flex: 1 1 40px',
      'min-width: 0',
      'background: rgba(255,255,255,0.05)',
      'border-radius: 8px',
      'padding: 5px 2px',
      'text-align: center',
    ].join(';'))
    box.append(
      el('div', 'font-size:9px;color:rgba(255,255,255,0.4)', day.weekday || day.date || ''),
      el('div', 'font-size:16px;line-height:1.4', weatherEmoji(day.weather)),
      el('div', 'font-size:9px;color:rgba(255,255,255,0.7)',
        `${day.minTemp ?? '?'}°~${day.maxTemp ?? '?'}°`),
      el('div', 'font-size:8px;color:rgba(56,189,248,0.7)',
        day.chanceofrain ? `💧${day.chanceofrain}%` : '')
    )
    return box
  }

  function render(p) {
    const o = p.outputs || {}
    dot.style.background = STATUS_COLORS[p.status] || STATUS_COLORS.idle
    statusLabel.textContent = p.status

    emoji.textContent = weatherEmoji(o.weather)
    temp.textContent = o.temp ? `${o.temp}°C` : '--'
    weatherText.textContent = [o.weather, o.city].filter(Boolean).join(' · ') || '等待执行'

    metrics.textContent = ''
    metrics.append(
      metric('体感', o.feelsLike, '°'),
      metric('湿度', o.humidity, '%'),
      metric('风速', o.windspeed, 'km/h')
    )

    forecastStrip.textContent = ''
    const days = parseForecasts(o.forecasts)
    if (days.length === 0) {
      forecastStrip.append(el('div', 'font-size:10px;color:rgba(255,255,255,0.25);margin:auto', '暂无预报数据'))
    } else {
      for (const day of days.slice(0, 7)) forecastStrip.append(forecastCard(day))
    }

    const execText = p.execution
      ? ` · 流水线 ${p.execution.status}`
      : ''
    footer.textContent = (o.updateTime ? `更新于 ${o.updateTime}` : '') + execText
  }

  render(props)

  return {
    update(next) { render(next) },
    unmount() { container.textContent = '' },
  }
}
