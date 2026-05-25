import { create } from 'zustand'
import type { ChatMessage, AIAction } from '@/types/ai'

interface ChatState {
  messages: ChatMessage[]
  isGenerating: boolean
  streamingContent: string
  sendMessage: (content: string) => Promise<void>
  appendStreamingContent: (content: string) => void
  finalizeStreaming: () => void
  executeAction: (action: AIAction) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isGenerating: false,
  streamingContent: '',

  sendMessage: async (content: string) => {
    // 添加用户消息
    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    }

    set((state) => ({
      messages: [...state.messages, userMessage],
      isGenerating: true,
      streamingContent: '',
    }))

    // 模拟 AI 响应流式输出
    const responses = [
      '我来帮你分析这个需求...',
      '\n\n首先，我们需要定义工作流的结构：',
      '\n- 一个入口节点',
      '\n- 数据处理节点',
      '\n- 输出节点',
      '\n\n我已经为你生成了初始配置，你可以在右侧查看和编辑。',
    ]

    for (const chunk of responses) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      get().appendStreamingContent(chunk)
    }

    // 完成流式输出，添加助手消息
    const assistantMessage: ChatMessage = {
      id: `msg_${Date.now() + 1}`,
      role: 'assistant',
      content: get().streamingContent,
      timestamp: new Date(),
    }

    set((state) => ({
      messages: [...state.messages, assistantMessage],
      isGenerating: false,
      streamingContent: '',
    }))
  },

  appendStreamingContent: (content: string) => {
    set((state) => ({
      streamingContent: state.streamingContent + content,
    }))
  },

  finalizeStreaming: () => {
    set({ isGenerating: false, streamingContent: '' })
  },

  executeAction: (action: AIAction) => {
    console.log('Executing action:', action)
  },
}))
