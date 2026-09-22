// @ts-nocheck — 节点卡片执行器声明护栏：声明可 docker 但未打包/缺镜像必须显式提示
import { describe, it, expect, beforeAll } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

import '@/i18n'
import NodeCard from '@/features/node-manager/NodeCard'

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
})

const base = {
  id: '1',
  name: 'gen-image',
  displayName: '生成图',
  version: '1.0.0',
  nodeType: 'code',
  language: 'python',
  entry: 'main.py',
  parameters: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

async function render(node) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      React.createElement(NodeCard, { versions: [node], onView: () => {}, onTest: () => {}, onDelete: () => {} })
    )
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
  return { container, root }
}

describe('节点卡片执行器声明护栏', () => {
  it('声明齐备：显示 docker 徽章且无告警', async () => {
    const { container, root } = await render({
      ...base,
      image: 'repo/nodes:v1.6.0',
      executorCheck: {
        types: ['local', 'docker'],
        preferred: 'local',
        image: 'repo/nodes:v1.6.0',
        bundled: true,
        dockerOk: true,
        issues: [],
      },
    })
    expect(container.textContent).toContain('docker')
    expect(container.textContent).not.toContain('声明不一致')
    await act(async () => root.unmount())
  }, 20000)

  it('声明可 docker 但未进镜像：显示「声明不一致」并在 tooltip 给出原因', async () => {
    const { container, root } = await render({
      ...base,
      executorCheck: {
        types: ['local', 'docker'],
        preferred: 'local',
        bundled: false,
        dockerOk: false,
        issues: ['声明支持 docker 但未声明 executor.bundled：镜像内可能没有该节点'],
      },
    })
    const text = container.textContent
    expect(text).toContain('声明不一致')
    const warn = [...container.querySelectorAll('span')].find((s) =>
      s.textContent?.includes('声明不一致')
    )
    expect(warn?.getAttribute('title')).toContain('未声明 executor.bundled')
    await act(async () => root.unmount())
  }, 20000)

  it('纯本地节点：只显示本机徽章，不显示 docker', async () => {
    const { container, root } = await render({
      ...base,
      executorCheck: { types: ['local'], preferred: 'local', bundled: false, dockerOk: false, issues: [] },
    })
    expect(container.textContent).toContain('仅本机')
    expect(container.textContent).not.toContain('docker')
    await act(async () => root.unmount())
  }, 20000)
})
