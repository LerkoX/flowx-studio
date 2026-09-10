// @ts-nocheck — 冒烟测试：直接加载节点包 widget bundle（纯 JS，非 TS 模块）
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// widget bundle 是仓库 nodes/ 下的纯 JS 文件，vite 不做模块解析；
// 读出源码按 CJS 方式求值（ESM default → module.exports）
const NODES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../nodes')
const load = async (rel) => {
  const code = readFileSync(path.join(NODES_DIR, rel), 'utf8').replace('export default', 'module.exports =')
  const mod = { exports: {} }
  new Function('module', 'exports', code)(mod, mod.exports)
  return { default: mod.exports.default || mod.exports }
}

function makeProps(over = {}) {
  return {
    nodeId: 'Echo',
    nodeRef: 'echo',
    status: 'idle',
    inputs: [],
    outputs: {},
    params: {},
    onParamsChange: vi.fn(),
    execution: null,
    theme: 'dark',
    locale: 'zh-CN',
    ...over,
  }
}

describe('节点 widget：wired 参数可编辑 + 来源标注（paramSources 契约）', () => {
  it('流水线参数引用：来源标签含当前值，绑定可编辑为字面值', async () => {
    const { default: mount } = await load('echo/ui/node-widget.js')
    const el = document.createElement('div')
    const props = makeProps({
      params: { message: '{{ Param.msg }}', sleep: '1' },
      paramSources: {
        message: { kind: 'pipeline', paramName: 'msg', paramValue: 'hello' },
        sleep: { kind: 'literal' },
      },
    })
    mount(el, props)

    // 来源标签：⚡ 流水线参数 · 名称 = 当前值
    expect(el.textContent).toContain('⚡ 流水线参数 · msg = hello')
    // wired 参数渲染可编辑文本框（值为绑定表达式）
    const inputs = [...el.querySelectorAll('input')]
    const msgInput = inputs.find((i) => i.value === '{{ Param.msg }}')
    expect(msgInput).toBeTruthy()
    expect(msgInput.disabled).toBe(false)
    // 字面值参数仍渲染原生控件（sleep 滑杆）
    expect(el.querySelector('input[type="range"]')).toBeTruthy()

    // 编辑为普通值 → 解除绑定并全量写回
    msgInput.value = 'fixed text'
    msgInput.dispatchEvent(new Event('change'))
    expect(props.onParamsChange).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'fixed text' }),
    )
  })

  it('节点引用：显示来源节点显示名，运行时补充上游输出值', async () => {
    const { default: mount } = await load('send-feishu/ui/node-widget.js')
    const el = document.createElement('div')
    const props = makeProps({
      params: { title: '通知', content: '{{ GetWeather.text }}' },
      paramSources: {
        title: { kind: 'literal' },
        content: { kind: 'node', nodeId: 'GetWeather', nodeName: '获取天气', field: 'text' },
      },
    })
    const handle = mount(el, props)

    // 静态：显示来源节点与字段，无运行时值
    expect(el.textContent).toContain('🔗 获取天气 · text')
    expect(el.textContent).not.toContain('= 深圳天气')

    // 运行中：上游输出到达后来源标签补充实时值
    handle.update({
      ...props,
      paramSources: {
        ...props.paramSources,
        content: { ...props.paramSources.content, runtimeValue: '深圳天气晴 32°C' },
      },
    })
    expect(el.textContent).toContain('🔗 获取天气 · text = 深圳天气晴 32°C')
    handle.unmount()
  })

  it('无 paramSources（旧版 Studio）回退展示原始绑定串', async () => {
    const { default: mount } = await load('echo/ui/node-widget.js')
    const el = document.createElement('div')
    const props = makeProps({ params: { message: '{{ Param.msg }}' } })
    mount(el, props)
    expect(el.textContent).toContain('⟵ {{ Param.msg }}')
  })

  it('只读模式（回放态无 onParamsChange）输入框禁用', async () => {
    const { default: mount } = await load('echo/ui/node-widget.js')
    const el = document.createElement('div')
    const props = makeProps({
      params: { message: '{{ Param.msg }}', sleep: '1' },
      paramSources: { message: { kind: 'pipeline', paramName: 'msg', paramValue: 'hi' } },
    })
    delete props.onParamsChange
    mount(el, props)
    const inputs = [...el.querySelectorAll('input')]
    expect(inputs.length).toBeGreaterThan(0)
    expect(inputs.every((i) => i.disabled)).toBe(true)
  })
})
