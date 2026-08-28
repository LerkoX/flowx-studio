import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { NodeWidgetHandle, NodeWidgetMount, NodeWidgetProps } from './contract'

const STATUS_COLORS: Record<string, string> = {
  idle: '#94a3b8',
  running: '#22d3ee',
  success: '#34d399',
  failed: '#fb7185',
  skipped: '#64748b',
}

function Widget({ props }: { props: NodeWidgetProps }) {
  const outputs = Object.entries(props.outputs || {})
  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: 10,
        fontSize: 11,
        lineHeight: 1.7,
        color: 'rgba(255,255,255,0.85)',
        overflow: 'auto',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: STATUS_COLORS[props.status] || STATUS_COLORS.idle,
          }}
        />
        <strong style={{ fontSize: 12 }}>{props.nodeRef || props.nodeId}</strong>
        <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 'auto' }}>{props.status}</span>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.45)' }}>
        入参: {props.inputs.length ? props.inputs.join(', ') : '无'}
      </div>
      {outputs.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.25)' }}>暂无输出</div>
      ) : (
        outputs.map(([key, value]) => (
          <div key={key}>
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>{key}: </span>
            <span style={{ color: 'rgba(255,255,255,0.75)' }}>{String(value)}</span>
          </div>
        ))
      )}
      <div style={{ color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
        流水线执行: {props.execution ? props.execution.status : '无运行实例'}
      </div>
    </div>
  )
}

/**
 * 自挂载契约：Studio 提供容器 el 与数据 props，
 * 组件自行挂载并返回 update/unmount 句柄。
 */
const mount: NodeWidgetMount = (el, initialProps) => {
  let current = initialProps
  let rerender: (() => void) | null = null

  function App() {
    const [props, setProps] = useState(current)
    useEffect(() => {
      rerender = () => setProps({ ...current })
      return () => {
        rerender = null
      }
    }, [])
    return <Widget props={props} />
  }

  const root = createRoot(el)
  root.render(<App />)

  const handle: NodeWidgetHandle = {
    update(props) {
      current = props
      rerender?.()
    },
    unmount() {
      root.unmount()
    },
  }
  return handle
}

export default mount
