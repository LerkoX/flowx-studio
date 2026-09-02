import { useCallback, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'

interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  resolve: ((ok: boolean) => void) | null
}

/**
 * 全局确认对话框。遵循系统偏好 confirmBeforeDelete：
 * 关闭时跳过弹窗直接确认（仅对 danger 类操作生效）。
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: '',
    resolve: null,
  })

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    const { confirmBeforeDelete } = useSettingsStore.getState().systemSettings
    if (options.danger && !confirmBeforeDelete) {
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolve) => {
      setState({ ...options, open: true, resolve })
    })
  }, [])

  const close = useCallback(
    (ok: boolean) => {
      state.resolve?.(ok)
      setState((s) => ({ ...s, open: false, resolve: null }))
    },
    [state.resolve]
  )

  const dialog = <ConfirmDialog state={state} onClose={close} />

  return { confirm, dialog }
}

function ConfirmDialog({ state, onClose }: { state: ConfirmState; onClose: (ok: boolean) => void }) {
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {state.open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onClose(false)}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="w-full max-w-sm bg-panel/95 backdrop-blur-2xl border border-white/10
                         rounded-2xl p-5 pointer-events-auto shadow-2xl shadow-black/40"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center
                    ${state.danger ? 'bg-rose-500/15 text-rose-400' : 'bg-indigo-500/15 text-indigo-400'}`}
                >
                  <AlertTriangle size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-white/90 font-semibold text-sm">{state.title}</h3>
                  {state.message && (
                    <p className="text-white/50 text-xs mt-1 break-all">{state.message}</p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => onClose(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 text-white/60 text-sm
                             hover:bg-white/10 hover:text-white transition-all"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => onClose(true)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium text-on-accent transition-all
                    ${state.danger
                      ? 'bg-rose-500 hover:bg-rose-400'
                      : 'bg-gradient-to-br from-indigo-500 to-purple-500 hover:shadow-lg hover:shadow-indigo-500/30'
                    }`}
                >
                  {state.confirmText || t('common.confirm')}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
