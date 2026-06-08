import { create } from 'zustand'

interface AppState {
  sidebarCollapsed: boolean
  theme: 'dark'
  chatPanelCollapsed: boolean
  paramsPanelCollapsed: boolean
  mobileChatOpen: boolean
  mobileParamsOpen: boolean
  mobileSidebarOpen: boolean
  toggleSidebar: () => void
  toggleChatPanel: () => void
  toggleParamsPanel: () => void
  collapseAllPanels: () => void
  expandAllPanels: () => void
  setMobileChatOpen: (open: boolean) => void
  setMobileParamsOpen: (open: boolean) => void
  setMobileSidebarOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  theme: 'dark',
  chatPanelCollapsed: false,
  paramsPanelCollapsed: false,
  mobileChatOpen: false,
  mobileParamsOpen: false,
  mobileSidebarOpen: false,

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

  setMobileChatOpen: (open) => set({ mobileChatOpen: open }),
  setMobileParamsOpen: (open) => set({ mobileParamsOpen: open }),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
}))
