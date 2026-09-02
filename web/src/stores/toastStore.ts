import { create } from 'zustand'
import { useSettingsStore } from './settingsStore'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  type: ToastType
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (type: ToastType, message: string) => void
  remove: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (type, message) => {
    // 系统偏好「显示通知」关闭时静默非错误通知；错误始终提示
    const { showNotifications } = useSettingsStore.getState().systemSettings
    if (!showNotifications && type !== 'error') return

    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }))
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }, 3000)
  },

  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

/** 便捷调用（组件外也可用） */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
}
