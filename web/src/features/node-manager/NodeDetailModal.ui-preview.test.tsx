// @ts-nocheck — 节点详情弹窗「UI 预览」Tab：含 ui.entry 的节点可只读预览、
// 超宽组件按视口等比缩放、无非 UI 节点不出现该 Tab 且旧 Tab 状态回退概览
import { describe, it, expect, beforeAll, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import '@/i18n'
import NodeDetailModal from '@/features/node-manager/NodeDetailModal'

// widget 宿主在 jsdom 里无法真正加载 bundle，替换为占位节点以便断言 URL 与缩放
vi.mock('@/components/ModuleNodeWidget', async (importOriginal) => {
  const actual = await importOriginal()
  const ReactMod = await import('react')
  return {
    ...actual,
    default: (props) =>
      ReactMod.createElement('div', {
        'data-testid': 'widget-preview',
        'data-url': props.url,
        'data-width': String(props.width),
        'data-height': String(props.height),
      }),
  }
})

beforeAll(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
})

const baseNode = {
  id: '109',
  name: 'ksampler',
  displayName: 'KSampler 采样器',
  description: '扩散采样',
  version: '1.4.0',
  nodeType: 'code',
  language: 'python',
  entry: 'main.py',
  ui: { entry: 'ui/node-widget.js', width: 300, height: 700, collapsed: false, apiVersion: 1 },
  parameters: [
    { name: 'steps', type: 'integer', description: '步数', required: false, default: 20 },
    { name: 'cfg', type: 'float', description: 'CFG', required: false, default: 7 },
    { name: 'positive', type: 'string', description: '正向', required: true },
  ],
  updatedAt: '2026-09-22T22:27:11Z',
  createdAt: '2026-09-22T22:27:11Z',
}

async function render(node) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<NodeDetailModal node={node} isOpen onClose={() => {}} />)
  })
  const tabButton = (label) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  return { container, root, tabButton }
}

describe('节点详情弹窗 UI 预览 Tab', () => {
  it('含 ui.entry 的节点出现「UI 预览」Tab，点击后只读挂载组件且 URL 带缓存破坏参数', async () => {
    const { container, root, tabButton } = await render(baseNode)

    const uiTab = tabButton('UI 预览')
    expect(uiTab).toBeTruthy()

    await act(async () => {
      uiTab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const widget = container.querySelector('[data-testid="widget-preview"]')
    expect(widget).toBeTruthy()
    expect(widget.getAttribute('data-url')).toBe(
      '/api/v1/nodes/109/ui/ui/node-widget.js?v=2026-09-22T22%3A27%3A11Z'
    )
    // 只读提示 + 声明尺寸原样下发
    expect(container.textContent).toContain('节点定义预览（只读）')
    expect(widget.getAttribute('data-width')).toBe('300')
    expect(widget.getAttribute('data-height')).toBe('700')

    await act(async () => {
      root.unmount()
    })
  })

  it('超宽组件按视口等比缩放（1080 宽缩到可用宽度内）', async () => {
    window.innerWidth = 400
    const node = {
      ...baseNode,
      id: '7',
      name: 'earth-3d-viewer',
      ui: { entry: 'ui/node-widget.js', width: 1080, height: 280, collapsed: false, apiVersion: 1 },
    }
    const { container, root, tabButton } = await render(node)
    await act(async () => {
      tabButton('UI 预览').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const widget = container.querySelector('[data-testid="widget-preview"]')
    // 视口 400 → 可用宽度 min(672, 400-32)-80 = 288 → scale 288/1080
    const scaled = widget.parentElement
    expect(scaled.style.width).toBe('1080px')
    expect(scaled.style.transform).toBe(`scale(${288 / 1080})`)
    expect(scaled.parentElement.style.width).toBe('288px')
    expect(widget.getAttribute('data-width')).toBe('1080')

    await act(async () => {
      root.unmount()
    })
    window.innerWidth = 1024
  })

  it('无 ui.entry 的节点不出现该 Tab', async () => {
    const node = { ...baseNode, id: '33', ui: undefined }
    const { root, tabButton } = await render(node)
    expect(tabButton('UI 预览')).toBeUndefined()
    expect(tabButton('概览')).toBeTruthy()
    await act(async () => {
      root.unmount()
    })
  })

  it('从含 UI 节点切到无 UI 节点时，停留在 UI Tab 会回退到概览（内容区不空白）', async () => {
    const { container, root, tabButton } = await render(baseNode)
    await act(async () => {
      tabButton('UI 预览').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('节点定义预览（只读）')

    // 复用同一弹窗实例换节点（列表里切换查看目标）
    await act(async () => {
      root.render(<NodeDetailModal node={{ ...baseNode, id: '33', ui: undefined }} isOpen onClose={() => {}} />)
    })
    expect(container.textContent).not.toContain('节点定义预览（只读）')
    expect(container.textContent).toContain('基本信息')

    await act(async () => {
      root.unmount()
    })
  })
})
