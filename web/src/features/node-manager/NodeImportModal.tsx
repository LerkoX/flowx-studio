import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, GitBranch, Folder, Plus, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface NodeImportModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (data: { type: 'git' | 'folder'; url: string }) => void
  isAdding: boolean
}

export default function NodeImportModal({ isOpen, onClose, onAdd, isAdding }: NodeImportModalProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'git' | 'folder'>('git')
  const [url, setUrl] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    onAdd({ type: activeTab, url: url.trim() })
    setUrl('')
  }

  const handleClose = () => {
    setUrl('')
    setActiveTab('git')
    onClose()
  }

  const tabConfig = {
    git: {
      label: t('node.importGitTab'),
      icon: GitBranch,
      placeholder: 'https://github.com/username/repo',
      helper: t('node.importGitHelper'),
      inputLabel: t('node.importGitLabel'),
    },
    folder: {
      label: t('node.importFolderTab'),
      icon: Folder,
      placeholder: '/path/to/node-folder',
      helper: t('node.importFolderHelper'),
      inputLabel: t('node.importFolderLabel'),
    },
  }

  const current = tabConfig[activeTab]

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* 弹窗 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="w-full max-w-lg bg-panel/95 backdrop-blur-2xl 
                            border border-white/10 rounded-2xl overflow-hidden pointer-events-auto"
            >
              {/* 头部 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-white/90 font-semibold text-sm">{t('node.addNode')}</h2>
                <button
                  onClick={handleClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center
                           text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 标签切换 */}
              <div className="flex border-b border-white/10">
                {(Object.keys(tabConfig) as Array<keyof typeof tabConfig>).map((key) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex-1 py-3 text-sm font-medium transition-all relative
                      ${activeTab === key ? 'text-white' : 'text-white/40 hover:text-white/60'}`}
                  >
                    <span className="flex items-center justify-center gap-2">
                      {(() => {
                        const Icon = tabConfig[key].icon
                        return <Icon size={14} />
                      })()}
                      {tabConfig[key].label}
                    </span>
                    {activeTab === key && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute bottom-0 left-4 right-4 h-[2px] 
                                 bg-gradient-to-r from-indigo-400 to-purple-400 rounded-full"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* 表单 */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-white/60 text-xs mb-2">{current.inputLabel}</label>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={current.placeholder}
                    disabled={isAdding}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10
                             text-white/90 text-sm placeholder:text-white/20
                             focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                             transition-all disabled:opacity-50"
                  />
                  <p className="text-white/30 text-[11px] mt-2">{current.helper}</p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={isAdding}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 text-white/60
                             text-sm hover:bg-white/10 hover:text-white transition-all
                             disabled:opacity-50"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isAdding || !url.trim()}
                    className="flex-1 px-4 py-2.5 rounded-xl 
                             bg-gradient-to-br from-indigo-500 to-purple-500
                             text-on-accent text-sm font-medium
                             hover:shadow-lg hover:shadow-indigo-500/30
                             transition-all disabled:opacity-50 
                             disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isAdding ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {t('node.importing')}
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        {t('node.add')}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
