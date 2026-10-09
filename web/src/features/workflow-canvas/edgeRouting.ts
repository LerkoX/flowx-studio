import { getBezierPath, Position } from '@xyflow/react'

export interface RoutedBezierParams {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  /** 横向图上下绕行 / 纵向图左右绕行；0 表示普通贝塞尔路径 */
  controlOffset?: number
}

interface Point {
  x: number
  y: number
}

function isHorizontalRoute(position: Position): boolean {
  return position === Position.Left || position === Position.Right
}

function routeControls(params: RoutedBezierParams): [Point, Point] {
  const offset = params.controlOffset ?? 0

  if (isHorizontalRoute(params.sourcePosition)) {
    // LR：控制点向上下偏移，让长边绕开中间节点
    const midX = (params.sourceX + params.targetX) / 2
    return [
      { x: midX, y: params.sourceY + offset },
      { x: midX, y: params.targetY + offset },
    ]
  }

  // TB：控制点向左右偏移，让长边绕开中间节点
  const midY = (params.sourceY + params.targetY) / 2
  return [
    { x: params.sourceX + offset, y: midY },
    { x: params.targetX + offset, y: midY },
  ]
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  }
}

export function getRoutedBezierPath(params: RoutedBezierParams): [string, number, number] {
  if (!params.controlOffset) {
    const [path, labelX, labelY] = getBezierPath(params)
    return [path, labelX, labelY]
  }

  const p0 = { x: params.sourceX, y: params.sourceY }
  const p3 = { x: params.targetX, y: params.targetY }
  const [p1, p2] = routeControls(params)
  const label = cubicPoint(p0, p1, p2, p3, 0.5)

  return [
    `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`,
    label.x,
    label.y,
  ]
}

export function sampleRoutedBezier(params: RoutedBezierParams, samples = 32): Point[] {
  const p0 = { x: params.sourceX, y: params.sourceY }
  const p3 = { x: params.targetX, y: params.targetY }
  const [p1, p2] = routeControls(params)
  const points: Point[] = []

  for (let i = 0; i <= samples; i++) {
    points.push(cubicPoint(p0, p1, p2, p3, i / samples))
  }

  return points
}
