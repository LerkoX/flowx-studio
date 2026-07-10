import { create } from 'zustand'

interface AppState {
  sidebarCollapsed: boolean
  theme: 'dark'
  paramsPanelCollapsed: boolean
  mobileParamsOpen: boolean
  mobileSidebarOpen: boolean
  toggleSidebar: () => void
  toggleParamsPanel: () => void
  setMobileParamsOpen: (open: boolean) => void
  setMobileSidebarOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  theme: 'dark',
  paramsPanelCollapsed: false,
  mobileParamsOpen: false,
  mobileSidebarOpen: false,

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  toggleParamsPanel: () =>
    set((state) => ({ paramsPanelCollapsed: !state.paramsPanelCollapsed })),

  setMobileParamsOpen: (open) => set({ mobileParamsOpen: open }),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
}))
