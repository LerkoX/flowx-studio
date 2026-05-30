import { create } from 'zustand'

interface AppState {
  sidebarCollapsed: boolean
  theme: 'dark'
  chatPanelCollapsed: boolean
  paramsPanelCollapsed: boolean
  toggleSidebar: () => void
  toggleChatPanel: () => void
  toggleParamsPanel: () => void
  collapseAllPanels: () => void
  expandAllPanels: () => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  theme: 'dark',
  chatPanelCollapsed: false,
  paramsPanelCollapsed: false,

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  toggleChatPanel: () =>
    set((state) => ({ chatPanelCollapsed: !state.chatPanelCollapsed })),

  toggleParamsPanel: () =>
    set((state) => ({ paramsPanelCollapsed: !state.paramsPanelCollapsed })),

  collapseAllPanels: () =>
    set({ chatPanelCollapsed: true, paramsPanelCollapsed: true }),

  expandAllPanels: () =>
    set({ chatPanelCollapsed: false, paramsPanelCollapsed: false }),
}))
