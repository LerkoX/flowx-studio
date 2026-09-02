import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Plus, Tag, Code, Container, Filter, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNodeStore } from '@/stores/nodeStore'
import { importNode } from '@/services/nodeService'
import { useConfirm } from '@/hooks/useConfirm'
import { toast } from '@/stores/toastStore'
import NodeCard from '@/features/node-manager/NodeCard'
import NodeImportModal from '@/features/node-manager/NodeImportModal'
import NodeDetailModal from '@/features/node-manager/NodeDetailModal'
import NodeTestPanel from '@/features/node-manager/NodeTestPanel'
import type { NodeDefinition } from '@/types/node'

export default function NodeManagerPage() {
  const { t } = useTranslation()
  const { confirm, dialog } = useConfirm()
  const {
    searchQuery,
    selectedTags,
    selectedLanguage,
    selectedNodeType,
    isAdding,
    setSearchQuery,
    setSelectedTags,
    setSelectedLanguage,
    setSelectedNodeType,
    addNode,
    deleteNode,
    setIsAdding,
    setAddError,
    getFilteredNodes,
    getAllTags,
    getAllLanguages,
    loadNodes,
  } = useNodeStore()

  // 进入节点管理页时加载节点列表（store 为内存态，刷新页面后必须重新拉取）
  useEffect(() => {
    loadNodes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [showImportModal, setShowImportModal] = useState(false)
  const [selectedNode, setSelectedNode] = useState<NodeDefinition | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showTestPanel, setShowTestPanel] = useState(false)

  const filteredNodes = getFilteredNodes()
  const allTags = getAllTags()
  const allLanguages = getAllLanguages()

  const handleAddNode = async (data: { type: 'git' | 'folder'; url: string }) => {
    setIsAdding(true)
    setAddError(null)

    try {
      const response = await importNode({
        source_type: data.type,
        source_url: data.type === 'git' ? data.url : undefined,
        source_path: data.type === 'folder' ? data.url : undefined,
      })

      if (response.code === 200 && response.data) {
        const newNode = { ...response.data, id: String(response.data.id) }
        addNode(newNode as NodeDefinition)
        setShowImportModal(false)
      } else {
        setAddError(response.message || t('node.importFailed'))
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t('node.importFailed'))
    } finally {
      setIsAdding(false)
    }
  }

  const handleViewNode = (node: NodeDefinition) => {
    setSelectedNode(node)
    setShowDetailModal(true)
  }

  const handleTestNode = (node: NodeDefinition) => {
    setSelectedNode(node)
    setShowTestPanel(true)
  }

  const handleDeleteNode = async (nodeId: string) => {
    const ok = await confirm({
      title: t('node.deleteConfirmTitle'),
      message: t('node.deleteConfirmMessage'),
      confirmText: t('common.delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await deleteNode(nodeId)
      toast.success(t('workflow.deleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag))
    } else {
      setSelectedTags([...selectedTags, tag])
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setSelectedTags([])
    setSelectedLanguage(null)
    setSelectedNodeType('all')
  }

  const hasFilters = searchQuery || selectedTags.length > 0 || selectedLanguage || selectedNodeType !== 'all'

  return (
    <div className="h-full flex flex-col">
      {/* 顶部工具栏 */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-white/90 font-semibold text-lg">{t('node.managerTitle')}</h1>
            <p className="text-white/40 text-xs mt-1">{t('node.managerSubtitle')}</p>
          </div>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                     bg-gradient-to-br from-indigo-500 to-purple-500
                     text-on-accent text-sm font-medium
                     hover:shadow-lg hover:shadow-indigo-500/30
                     transition-all"
          >
            <Plus size={16} />
            {t('node.addNode')}
          </button>
        </div>

        {/* 搜索和筛选 */}
        <div className="flex items-center gap-3">
          {/* 搜索框 */}
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('node.searchPlaceholder')}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/5 border border-white/10
                       text-white/90 text-sm placeholder:text-white/20
                       focus:outline-none focus:border-white/20 focus:bg-white/[0.07]
                       transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 节点类型筛选 */}
          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
            <button
              onClick={() => setSelectedNodeType('all')}
              className={`px-3 py-1.5 rounded-md text-xs transition-all
                ${selectedNodeType === 'all' 
                  ? 'bg-white/10 text-white' 
                  : 'text-white/40 hover:text-white/60'}`}
            >
              {t('common.all')}
            </button>
            <button
              onClick={() => setSelectedNodeType('code')}
              className={`px-3 py-1.5 rounded-md text-xs transition-all flex items-center gap-1
                ${selectedNodeType === 'code' 
                  ? 'bg-white/10 text-white' 
                  : 'text-white/40 hover:text-white/60'}`}
            >
              <Code size={12} />
              {t('node.typeCode')}
            </button>
            <button
              onClick={() => setSelectedNodeType('image')}
              className={`px-3 py-1.5 rounded-md text-xs transition-all flex items-center gap-1
                ${selectedNodeType === 'image' 
                  ? 'bg-white/10 text-white' 
                  : 'text-white/40 hover:text-white/60'}`}
            >
              <Container size={12} />
              {t('node.typeImage')}
            </button>
          </div>

          {/* 语言筛选 */}
          {allLanguages.length > 0 && (
            <select
              value={selectedLanguage || ''}
              onChange={(e) => setSelectedLanguage(e.target.value || null)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2
                       text-xs text-white/80 focus:outline-none focus:border-white/20
                       cursor-pointer"
            >
              <option value="" className="bg-panel">{t('node.allLanguages')}</option>
              {allLanguages.map((lang) => (
                <option key={lang} value={lang} className="bg-panel">
                  {lang}
                </option>
              ))}
            </select>
          )}

          {/* 清除筛选 */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60 
                       px-3 py-2 rounded-lg hover:bg-white/5 transition-all"
            >
              <Filter size={12} />
              {t('node.clearFilters')}
            </button>
          )}
        </div>

        {/* 标签筛选 */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Tag size={12} className="text-white/30" />
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`text-[11px] px-2.5 py-1 rounded-full transition-all
                  ${selectedTags.includes(tag)
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
                  }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 节点列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredNodes.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-4 opacity-30">📦</div>
              <p className="text-white/40 text-sm">
                {hasFilters ? t('node.noMatchingNodes') : t('node.emptyHint')}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <span className="text-white/30 text-xs">
                {t('node.totalCount', { count: filteredNodes.length })}
              </span>
            </div>
            <motion.div 
              layout
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            >
              <AnimatePresence mode="popLayout">
                {filteredNodes.map((node) => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    onView={handleViewNode}
                    onTest={handleTestNode}
                    onDelete={handleDeleteNode}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </>
        )}
      </div>

      {/* 添加节点弹窗 */}
      <NodeImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onAdd={handleAddNode}
        isAdding={isAdding}
      />

      {/* 节点详情弹窗 */}
      <NodeDetailModal
        node={selectedNode}
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false)
          setSelectedNode(null)
        }}
      />

      {/* 节点测试面板 */}
      <NodeTestPanel
        node={selectedNode}
        isOpen={showTestPanel}
        onClose={() => {
          setShowTestPanel(false)
          setSelectedNode(null)
        }}
      />
      {dialog}
    </div>
  )
}
