import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Server, Container, Plus, Star, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ExecutorForm from '@/features/executor-config/ExecutorForm'
import GlassPanel from '@/components/GlassPanel'
import { useExecutorStore } from '@/stores/executorStore'
import { useEventStream } from '@/services/eventService'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useConfirm } from '@/hooks/useConfirm'
import type { Executor } from '@/types/executor'

const typeIcon = { local: Server, docker: Container }

export default function ExecutorConfigPage() {
  const { t } = useTranslation()
  const { confirm, dialog } = useConfirm()
  const { executors, isLoading, error, loadExecutors, create, update, remove, setDefault } =
    useExecutorStore()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [opError, setOpError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    loadExecutors()
  }, [loadExecutors])

  // 实时感知其他端（CLI / 其他浏览器）对执行器的变更
  useEventStream('/api/v1/events', (type) => {
    if (type.startsWith('executor.')) {
      loadExecutors()
    }
  })

  const selected: Executor | null =
    (!creating && executors.find((e) => e.id === selectedId)) ||
    (!creating && executors.length > 0 ? executors[0] : null) ||
    null

  const runOp = async (op: () => Promise<void>) => {
    setSaving(true)
    setOpError(null)
    try {
      await op()
      setCreating(false)
    } catch (err) {
      setOpError(err instanceof Error ? err.message : t('executor.opFailed'))
    } finally {
      setSaving(false)
    }
  }

  const executorList = (compact: boolean) => (
    <>
      {executors.map((executor) => {
        const Icon = typeIcon[executor.type] ?? Server
        const isActive = !creating && selected?.id === executor.id
        return (
          <motion.button
            key={executor.id}
            onClick={() => {
              setCreating(false)
              setSelectedId(executor.id)
            }}
            className={`
              ${compact ? 'flex-shrink-0 p-3 rounded-xl' : 'w-full p-4 rounded-2xl'}
              text-left transition-all
              ${isActive
                ? 'bg-white/10 border border-white/20'
                : 'bg-white/5 border border-white/10 hover:bg-white/[0.07]'
              }
            `}
            whileHover={compact ? undefined : { scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center gap-3">
              <div
                className={`
                  ${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-xl flex items-center justify-center
                  ${isActive ? 'bg-gradient-to-br from-indigo-500 to-purple-500' : 'bg-white/5'}
                `}
              >
                <Icon size={compact ? 16 : 20} className={isActive ? 'text-white' : 'text-white/50'} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-white/90 font-medium text-sm truncate">{executor.name}</span>
                  {executor.isDefault && (
                    <Star size={12} className="text-amber-400 fill-amber-400 flex-shrink-0" />
                  )}
                </div>
                <div className="text-white/40 text-xs mt-0.5">{t(`executor.typeDesc.${executor.type}`)}</div>
              </div>
            </div>
          </motion.button>
        )
      })}

      <motion.button
        onClick={() => setCreating(true)}
        className={`
          ${compact ? 'flex-shrink-0 p-3 rounded-xl' : 'w-full p-4 rounded-2xl'}
          text-left transition-all border border-dashed
          ${creating
            ? 'bg-white/10 border-indigo-400/50'
            : 'bg-transparent border-white/15 hover:bg-white/5 hover:border-white/25'
          }
        `}
        whileTap={{ scale: 0.98 }}
      >
        <div className="flex items-center gap-3">
          <div
            className={`
              ${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-xl flex items-center justify-center bg-white/5
            `}
          >
            <Plus size={compact ? 16 : 20} className="text-white/50" />
          </div>
          <div>
            <div className="text-white/70 font-medium text-sm">{t('executor.addDocker')}</div>
            <div className="text-white/40 text-xs mt-0.5">{t('executor.addDockerHint')}</div>
          </div>
        </div>
      </motion.button>
    </>
  )

  const detailPanel = (
    <div className="flex-1 flex flex-col gap-4 min-w-0">
      <ExecutorForm
        executor={creating ? null : selected}
        saving={saving}
        error={opError}
        onSave={async (input) => {
          if (creating) {
            await runOp(() => create(input as Parameters<typeof create>[0]))
          } else if (selected) {
            await runOp(() => update(selected.id, input as Parameters<typeof update>[1]))
          }
        }}
        onCancelCreate={() => setCreating(false)}
      />

      {!creating && selected && (
        <GlassPanel className="p-4 flex items-center gap-3 flex-wrap">
          {!selected.isDefault && (
            <button
              onClick={() => runOp(() => setDefault(selected.id))}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10
                         text-white/70 text-xs hover:bg-white/10 hover:text-white transition-all
                         disabled:opacity-40 flex items-center gap-1.5"
            >
              <Star size={12} /> {t('executor.setDefault')}
            </button>
          )}
          {selected.isDefault && (
            <span className="text-amber-400/80 text-xs flex items-center gap-1.5">
              <Star size={12} className="fill-amber-400" /> {t('executor.currentDefault')}
            </span>
          )}
          {selected.type === 'docker' && !selected.isDefault && (
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: t('executor.deleteConfirmTitle'),
                  message: t('executor.deleteConfirmMessage', { name: selected.name }),
                  confirmText: t('common.delete'),
                  danger: true,
                })
                if (ok) runOp(() => remove(selected.id))
              }}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20
                         text-rose-300 text-xs hover:bg-rose-500/20 transition-all
                         disabled:opacity-40 flex items-center gap-1.5"
            >
              <Trash2 size={12} /> {t('common.delete')}
            </button>
          )}
        </GlassPanel>
      )}
      {dialog}
    </div>
  )

  if (isMobile) {
    return (
      <div className="h-full overflow-auto p-4 space-y-4">
        <h2 className="text-white/90 font-semibold text-lg">{t('executor.title')}</h2>
        {error && <p className="text-rose-400 text-xs">{error}</p>}
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">{executorList(true)}</div>
        {detailPanel}
      </div>
    )
  }

  return (
    <div className="h-full flex p-6 gap-6">
      <div className="w-80 flex-shrink-0 space-y-3">
        <h2 className="text-white/90 font-semibold text-lg mb-4">{t('executor.title')}</h2>
        {error && <p className="text-rose-400 text-xs">{error}</p>}
        {isLoading && executors.length === 0 ? (
          <p className="text-white/40 text-sm">{t('common.loading')}</p>
        ) : (
          executorList(false)
        )}
      </div>
      {detailPanel}
    </div>
  )
}
