import { create } from 'zustand'

interface AppState {
  sidebarCollapsed: boolean
  theme: 'dark'
  toggleSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  theme: 'dark',
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}))
