import { create } from 'zustand'
import type { NodeDefinition } from '@/types/node'
import { getNodes, createNode, deleteNode } from '@/services/nodeService'

interface NodeState {
  nodes: NodeDefinition[]
  searchQuery: string
  selectedTags: string[]
  selectedLanguage: string | null
  selectedNodeType: 'all' | 'code' | 'image'
  isAdding: boolean
  addError: string | null
  isLoading: boolean

  // Actions
  setSearchQuery: (query: string) => void
  setSelectedTags: (tags: string[]) => void
  setSelectedLanguage: (lang: string | null) => void
  setSelectedNodeType: (type: 'all' | 'code' | 'image') => void
  addNode: (node: NodeDefinition) => void
  removeNode: (nodeId: string) => void
  setIsAdding: (adding: boolean) => void
  setAddError: (error: string | null) => void
  loadNodes: () => Promise<void>
  createNode: (node: Omit<NodeDefinition, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
  deleteNode: (nodeId: string) => Promise<void>

  // Filtered nodes
  getFilteredNodes: () => NodeDefinition[]
  getAllTags: () => string[]
  getAllLanguages: () => string[]
}

export const useNodeStore = create<NodeState>((set, get) => ({
  nodes: [],
  searchQuery: '',
  selectedTags: [],
  selectedLanguage: null,
  selectedNodeType: 'all',
  isAdding: false,
  addError: null,
  isLoading: false,

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSelectedTags: (tags) => set({ selectedTags: tags }),

  setSelectedLanguage: (lang) => set({ selectedLanguage: lang }),

  setSelectedNodeType: (type) => set({ selectedNodeType: type }),

  addNode: (node) => set((state) => ({
    nodes: [...state.nodes, node],
    isAdding: false,
    addError: null,
  })),

  removeNode: (nodeId) => set((state) => ({
    nodes: state.nodes.filter((n) => n.id !== nodeId),
  })),

  setIsAdding: (adding) => set({ isAdding: adding }),

  setAddError: (error) => set({ addError: error }),

  loadNodes: async () => {
    set({ isLoading: true })
    try {
      const response = await getNodes()
      if (response.code === 200 && response.data) {
        // 后端返回的 id 是 number，前端类型是 string
        const nodes = response.data.items.map((item: NodeDefinition) => ({
          ...item,
          id: String(item.id),
        }))
        set({ nodes, isLoading: false })
      }
    } catch (error) {
      set({ isLoading: false, addError: error instanceof Error ? error.message : 'Failed to load nodes' })
    }
  },

  createNode: async (node) => {
    set({ isAdding: true, addError: null })
    try {
      const response = await createNode(node)
      if (response.code === 200 && response.data) {
        const newNode = { ...response.data, id: String(response.data.id) }
        set((state) => ({
          nodes: [...state.nodes, newNode],
          isAdding: false,
        }))
      }
    } catch (error) {
      set({
        isAdding: false,
        addError: error instanceof Error ? error.message : 'Failed to create node',
      })
    }
  },

  deleteNode: async (nodeId) => {
    try {
      await deleteNode(nodeId)
      set((state) => ({
        nodes: state.nodes.filter((n) => n.id !== nodeId),
      }))
    } catch (error) {
      set({ addError: error instanceof Error ? error.message : 'Failed to delete node' })
    }
  },

  getFilteredNodes: () => {
    const state = get()
    return state.nodes.filter((node) => {
      // Search filter
      if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase()
        const matchName = node.name.toLowerCase().includes(query)
        const matchDisplayName = node.displayName?.toLowerCase().includes(query)
        const matchDesc = node.description?.toLowerCase().includes(query)
        if (!matchName && !matchDisplayName && !matchDesc) return false
      }

      // Tag filter
      if (state.selectedTags.length > 0) {
        const nodeTags = node.tags || []
        const hasTag = state.selectedTags.some((tag) => nodeTags.includes(tag))
        if (!hasTag) return false
      }

      // Language filter
      if (state.selectedLanguage && node.language !== state.selectedLanguage) {
        return false
      }

      // Node type filter
      if (state.selectedNodeType !== 'all' && node.nodeType !== state.selectedNodeType) {
        return false
      }

      return true
    })
  },

  getAllTags: () => {
    const tags = new Set<string>()
    get().nodes.forEach((node) => {
      node.tags?.forEach((tag) => tags.add(tag))
    })
    return Array.from(tags)
  },

  getAllLanguages: () => {
    const languages = new Set<string>()
    get().nodes.forEach((node) => {
      if (node.language) languages.add(node.language)
    })
    return Array.from(languages)
  },
}))
