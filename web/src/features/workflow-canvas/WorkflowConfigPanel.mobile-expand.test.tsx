// @ts-nocheck — 手机端（≤768px）长文本参数：内联框改为「摘要入口 + 全屏弹层」，
// 点开后弹层里的 textarea 实时写回 editingValues（保存/自动保存仍走面板逻辑）。
// 桌面端（>768px）保持原内联 textarea 行为，不出现弹层。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// jsdom 无 matchMedia：按测试需要返回 matches（移动端 true / 桌面端 false）
let mobileMatches = false
window.matchMedia = (query) => ({
  matches: query.includes('max-width') ? mobileMatches : false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  onchange: null,
  dispatchEvent: () => false,
})

vi.mock('@/services/workflowService', async (importOriginal) => {
  const orig = await importOriginal()
  return {
    ...orig,
    updateWorkflow: vi.fn(async () => ({ code: 200, data: {} })),
  }
})

import '@/i18n'
import WorkflowConfigPanel from '@/features/workflow-canvas/WorkflowConfigPanel'
import { useWorkflowStore } from '@/stores/workflowStore'

const YAML = [
  'Name: demo',
  'Param:',
  '  prompt: hello world',
  '  steps: 20',
  'Graph: |',
  '  stateDiagram-v2',
  '    [*] --> A',
  '    A --> [*]',
  'Nodes:',
  '  A:',
  '    config:',
  '      nodeRef: echo',
].join('\n')

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

describe('WorkflowConfigPanel 手机端长文本放大编辑', () => {
  let container
  let root

  beforeEach(() => {
    mobileMatches = false
    useWorkflowStore.getState().setCurrentWorkflow({
      id: '113',
      name: 'demo',
      status: 'draft',
      yamlConfig: YAML,
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount())
      root = null
    }
    container?.remove()
    container = null
    document.body.innerHTML = ''
  })

  async function renderPanel() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(WorkflowConfigPanel, { view: 'params' }))
    })
    await settle(20)
  }

  it('手机端：字符串参数渲染为可点击的摘要入口，不直接渲染 textarea', async () => {
    mobileMatches = true
    await renderPanel()
    expect(container.querySelector('textarea')).toBeNull()
    const entry = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('放大编辑')
    )
    expect(entry).toBeTruthy()
  })

  it('手机端：点击入口弹出全屏弹层，输入实时写回参数值', async () => {
    mobileMatches = true
    await renderPanel()
    const entry = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('放大编辑')
    )
    await act(async () => {
      entry.click()
    })

    const overlay = document.body.querySelector('[class*="z-\\[10000\\]"]')
    expect(overlay, '弹层应挂到 body（逃离 transform 容器）').toBeTruthy()
    const ta = overlay.querySelector('textarea')
    expect(ta).toBeTruthy()
    expect(ta.value).toBe('hello world')

    // 实时写回：输入即改 editingValues → 入口摘要同步更新
    await act(async () => {
      // React 受控组件：必须走原生 value setter，否则其 value tracker 认为未变
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      ).set
      setValue.call(ta, 'a much longer prompt')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(overlay.querySelector('textarea').value).toBe('a much longer prompt')
    const entryAfter = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('放大编辑')
    )
    expect(entryAfter.textContent).toContain('a much longer prompt')
  })

  it('手机端：点「完成」关闭弹层', async () => {
    mobileMatches = true
    await renderPanel()
    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('放大编辑'))
        .click()
    })
    const done = [...document.body.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('完成')
    )
    expect(done).toBeTruthy()
    await act(async () => {
      done.click()
    })
    expect(document.body.querySelector('[class*="z-\\[10000\\]"]')).toBeNull()
  })

  it('桌面端：仍是内联 textarea，不出现放大入口', async () => {
    mobileMatches = false
    await renderPanel()
    expect(container.querySelector('textarea')).toBeTruthy()
    const entry = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('放大编辑')
    )
    expect(entry).toBeFalsy()
  })
})
