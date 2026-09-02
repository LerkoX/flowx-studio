import { create } from 'zustand'

interface AppState {
  sidebarCollapsed: boolean
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
