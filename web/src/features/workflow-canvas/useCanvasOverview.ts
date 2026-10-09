import { useEffect, useRef, useState } from 'react'
import { useStore as useReactFlowStore, useStoreApi } from '@xyflow/react'

// 概览模式阈值：隐藏/显示使用不同阈值形成迟滞区间，避免缩放停在临界点时
// 节点描述、语言、状态等次要信息随微小缩放反复闪烁。
const OVERVIEW_ENTER_DESKTOP = 0.78
const OVERVIEW_EXIT_DESKTOP = 0.82
const OVERVIEW_ENTER_MOBILE = 0.68
const OVERVIEW_EXIT_MOBILE = 0.72

export const OVERVIEW_TITLE_MAX_SCALE = 2.2

function thresholds(isMobile: boolean) {
  return {
    enter: isMobile ? OVERVIEW_ENTER_MOBILE : OVERVIEW_ENTER_DESKTOP,
    exit: isMobile ? OVERVIEW_EXIT_MOBILE : OVERVIEW_EXIT_DESKTOP,
  }
}

/**
 * 订阅画布概览模式。只在跨越迟滞阈值时更新 React state，
 * 普通 pan/zoom 不会让每个节点/连线频繁重渲染。
 */
export function useCanvasOverview(isMobile: boolean): boolean {
  const store = useStoreApi()
  const { enter, exit } = thresholds(isMobile)
  const [overview, setOverview] = useState(() => store.getState().transform[2] < enter)
  const overviewRef = useRef(overview)

  useEffect(() => {
    const sync = () => {
      const zoom = store.getState().transform[2]
      const next = overviewRef.current ? zoom < exit : zoom < enter
      if (next !== overviewRef.current) {
        overviewRef.current = next
        setOverview(next)
      }
    }

    sync()
    return store.subscribe(sync)
  }, [enter, exit, store])

  return overview
}

/**
 * 概览标题反向缩放：从进入阈值处开始补偿，量化到 0.1 步进，
 * 避免缩放动画期间每个像素变化都让所有节点重渲染。
 */
export function useOverviewTitleScale(isMobile: boolean): number {
  return useReactFlowStore((state) => {
    const zoom = state.transform[2]
    const { enter } = thresholds(isMobile)
    if (zoom >= enter) return 1
    const scale = Math.min(enter / zoom, OVERVIEW_TITLE_MAX_SCALE)
    return Math.max(1, Math.round(scale * 10) / 10)
  })
}
