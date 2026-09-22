// @ts-nocheck — 画布执行器徽章 + "输出可能不完整"标记的渲染契约
import { describe, it, expect, vi, beforeAll } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

class MockEventSource {
  constructor(url) {
    this.url = url
    this.listeners = {}
  }
  addEventListener(type, fn) {
    ;(this.listeners[type] ||= []).push(fn)
  }
  close() {}
}

const TEMPLATE_YAML = `Name: demo
Graph: |
  stateDiagram-v2
    [*] --> DockerNode
    DockerNode --> SynthNode
    SynthNode --> LocalNode
    LocalNode --> [*]
Nodes:
  DockerNode:
    config:
      nodeRef: gen-image
  SynthNode:
    config:
      nodeRef: gen-image
  LocalNode:
    config:
      nodeRef: save-image
`

// 回放态：执行 metadata 里带 flowx 写入的两个完整性标记
const EXECUTION = {
  id: 301,
  workflow_id: 58,
  status: 'success',
  trigger: 'manual',
  started_at: '2026-09-20T01:00:00Z',
  metadata: JSON.stringify({
    metadata: {
      'DockerNode.latent': 'abc123',
      // 执行器流曾被截断
      'DockerNode.__stream_truncated': 'true',
      // 声明了 extract 但零提取
      'LocalNode.__extract_missing': 'true',
    },
  }),
}

vi.mock('@/services/workflowService', () => ({
  updateWorkflow: vi.fn(async () => ({ code: 200 })),
  // 执行器解析结果：DockerNode → docker 实例（带镜像/host，来源 package-preferred）；
  // LocalNode → 降级到 local（带 warning，徽章应为提醒色）
  getWorkflowExecutors: vi.fn(async () => ({
    code: 200,
    data: {
      source: 'workflow',
      executors: {
        'docker-remote-211': {
          name: 'docker-remote-211',
          type: 'docker',
          host: 'tcp://1.2.3.4:12268',
          image: 'repo/nodes:v1.6.0',
          registered: true,
        },
        local: { name: 'local', type: 'local', registered: true },
        // 展开器按节点名合成的内部条目（镜像不一致时）：名字不稳定，徽章只显示类型
        'gen-image-executor': {
          name: 'gen-image-executor',
          type: 'docker',
          host: 'tcp://1.2.3.4:12268',
          image: 'repo/nodes:v1.6.0',
          registered: false,
        },
      },
      nodes: {
        DockerNode: {
          executor: 'docker-remote-211',
          type: 'docker',
          source: 'package-preferred',
        },
        SynthNode: {
          executor: 'gen-image-executor',
          type: 'docker',
          source: 'package-preferred',
        },
        LocalNode: {
          executor: 'local',
          type: 'local',
          source: 'package-degraded',
          warning: '节点偏好 docker，但该类型没有可用实例，已降级为 local',
        },
      },
    },
  })),
  getWorkflow: vi.fn(async () => ({ code: 200, data: null })),
  getExecutions: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
  getExecution: vi.fn(async () => ({ code: 200, data: EXECUTION })),
  getExecutionYaml: vi.fn(async () => ({
    code: 200,
    data: { hasSnapshot: true, yaml: TEMPLATE_YAML },
  })),
  getExecutionNodes: vi.fn(async () => ({
    code: 200,
    data: [
      { id: 1, execution_id: 301, node_id: 'DockerNode', status: 'success' },
      { id: 2, execution_id: 301, node_id: 'LocalNode', status: 'success' },
    ],
  })),
  getExecutionLogs: vi.fn(async () => ({ code: 200, data: { items: [], total: 0 } })),
}))
vi.mock('@/services/nodeService', () => ({
  getNodes: vi.fn(async () => ({ code: 200, data: { items: [] } })),
  resolveNodes: vi.fn(async (refs) => ({
    code: 200,
    data: { items: Object.fromEntries(refs.map((r) => [r, null])) },
  })),
}))
vi.mock('@/utils/mermaidParser', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    parseWorkflowGraph: vi.fn(async (yamlConfig) => {
      const ids = [...yamlConfig.matchAll(/^  (\w+):$/gm)].map((m) => m[1])
      const nodes = [
        { id: '__start__', label: 'start' },
        ...ids.map((id) => ({ id, label: id })),
        { id: '__end__', label: 'end' },
      ]
      const edges = []
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({ source: nodes[i].id, target: nodes[i + 1].id })
      }
      return { nodes, edges }
    }),
  }
})

import '@/i18n'
import WorkflowCanvas from '@/features/workflow-canvas/WorkflowCanvas'
import { selectExecutionAndSync } from '@/features/workflow-canvas/executionSelection'
import { useWorkflowStore } from '@/stores/workflowStore'

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  global.EventSource = MockEventSource
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })
})

async function settle(ms) {
  const rounds = Math.max(1, Math.ceil(ms / 200))
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200))
    })
  }
}

/** 取节点卡片上某个徽章的 title（悬停提示） */
function badgeTitle(container, nodeId, label) {
  const nodes = [...container.querySelectorAll('.react-flow__node')]
  const card = nodes.find((n) => n.textContent?.includes(nodeId))
  if (!card) return undefined
  const badge = [...card.querySelectorAll('span')].find((s) => s.textContent?.includes(label))
  return badge?.getAttribute('title') ?? undefined
}

describe('画布执行器徽章与输出完整性标记', () => {
  it('编辑态显示执行器徽章（含镜像/地址/来源 tooltip）', async () => {
    useWorkflowStore.getState().setCurrentWorkflow({
      id: '58',
      name: 'demo',
      yamlConfig: TEMPLATE_YAML,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(WorkflowCanvas))
    })
    await settle(800)

    // docker 节点：徽章带实例名；local 节点：徽章带 local
    expect(container.textContent).toContain('docker-remote-211')
    expect(container.textContent).toContain('local')

    const title = badgeTitle(container, 'DockerNode', 'docker-remote-211')
    expect(title, 'docker 节点徽章应有 tooltip').toBeTruthy()
    expect(title).toContain('docker-remote-211')
    expect(title).toContain('repo/nodes:v1.6.0')
    expect(title).toContain('tcp://1.2.3.4:12268')
    expect(title).toContain('节点包偏好类型')

    // 降级节点：tooltip 里带 warning 原文
    const localTitle = badgeTitle(container, 'LocalNode', 'local')
    expect(localTitle).toContain('已降级为 local')

    // 合成内部条目名不当作执行器身份展示（否则会出现 clip-text-encode-executor 这类
    // 取决于 map 遍历顺序的随机名字），只显示类型；tooltip 仍给出实例名
    expect(container.textContent).not.toContain('gen-image-executor')
    const synthTitle = badgeTitle(container, 'SynthNode', 'docker')
    expect(synthTitle).toContain('gen-image-executor')

    await act(async () => root.unmount())
  }, 20000)

  it('回放态按执行 metadata 标记「输出可能不完整」', async () => {
    useWorkflowStore.getState().setCurrentWorkflow({
      id: '58',
      name: 'demo',
      yamlConfig: TEMPLATE_YAML,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(WorkflowCanvas))
    })
    await settle(600)

    // 编辑态（未选中执行）：没有完整性标记
    expect(container.textContent).not.toContain('输出可能不完整')

    await act(async () => {
      await selectExecutionAndSync('301')
    })
    await settle(1000)

    const text = container.textContent
    expect(text, '截断节点应显示提示').toContain('输出可能不完整')
    // 两个节点各一个 ⚠ 徽章
    expect((text.match(/输出可能不完整/g) || []).length).toBe(2)

    const streamTitle = badgeTitle(container, 'DockerNode', '输出可能不完整')
    expect(streamTitle).toContain('输出流曾被截断')
    const extractTitle = badgeTitle(container, 'LocalNode', '输出可能不完整')
    expect(extractTitle).toContain('一条都没提取到')

    await act(async () => root.unmount())
  }, 20000)
})
