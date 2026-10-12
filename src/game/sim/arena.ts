/**
 * Arena layout and static collision geometry. Pure data and math: no rendering here.
 */

export const TILE_SIZE = 64

export type IslandStyle = 'sand' | 'grass'

export interface IslandDef {
  id: string
  style: IslandStyle
  /** Position and size in tiles. */
  col: number
  row: number
  cols: number
  rows: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Arena {
  width: number
  height: number
  islands: readonly IslandDef[]
  /** Solid rectangles blocking ships and projectiles. */
  obstacles: readonly Rect[]
  playerStart: { x: number; y: number; angle: number }
}

/** The island art has soft, partly transparent shores; the solid area is slightly smaller. */
const SHORE_INSET = 12

const ISLANDS: readonly IslandDef[] = [
  { id: 'north-west', style: 'grass', col: 4, row: 2, cols: 4, rows: 4 },
  { id: 'north-east', style: 'sand', col: 15, row: 2, cols: 5, rows: 3 },
  { id: 'south', style: 'grass', col: 10, row: 8, cols: 4, rows: 4 },
  { id: 'south-east', style: 'sand', col: 19, row: 8, cols: 3, rows: 3 },
  { id: 'south-west', style: 'sand', col: 2, row: 9, cols: 3, rows: 3 },
]

export function createArena(width: number, height: number): Arena {
  return {
    width,
    height,
    islands: ISLANDS,
    obstacles: ISLANDS.map((island) => ({
      x: island.col * TILE_SIZE + SHORE_INSET,
      y: island.row * TILE_SIZE + SHORE_INSET,
      w: island.cols * TILE_SIZE - SHORE_INSET * 2,
      h: island.rows * TILE_SIZE - SHORE_INSET * 2,
    })),
    playerStart: { x: 800, y: 420, angle: -Math.PI / 2 },
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function circleIntersectsRect(x: number, y: number, radius: number, rect: Rect): boolean {
  const dx = x - clamp(x, rect.x, rect.x + rect.w)
  const dy = y - clamp(y, rect.y, rect.y + rect.h)
  return dx * dx + dy * dy < radius * radius
}

export function circleHitsObstacle(arena: Arena, x: number, y: number, radius: number): boolean {
  for (const rect of arena.obstacles) {
    if (circleIntersectsRect(x, y, radius, rect)) return true
  }
  return false
}

/**
 * Pushes a circle out of a rectangle along the shortest path.
 * Returns true when the circle was overlapping.
 */
export function resolveCircleRect(body: { x: number; y: number }, radius: number, rect: Rect): boolean {
  const nearestX = clamp(body.x, rect.x, rect.x + rect.w)
  const nearestY = clamp(body.y, rect.y, rect.y + rect.h)
  const dx = body.x - nearestX
  const dy = body.y - nearestY
  const distanceSq = dx * dx + dy * dy
  if (distanceSq >= radius * radius) return false

  if (distanceSq > 1e-9) {
    const distance = Math.sqrt(distanceSq)
    const push = radius - distance
    body.x += (dx / distance) * push
    body.y += (dy / distance) * push
    return true
  }

  // Centre is inside the rectangle: leave through the closest edge.
  const left = body.x - rect.x
  const right = rect.x + rect.w - body.x
  const top = body.y - rect.y
  const bottom = rect.y + rect.h - body.y
  const min = Math.min(left, right, top, bottom)
  if (min === left) body.x = rect.x - radius
  else if (min === right) body.x = rect.x + rect.w + radius
  else if (min === top) body.y = rect.y - radius
  else body.y = rect.y + rect.h + radius
  return true
}

/** Slab test of a segment against a rectangle grown by `margin`. */
function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rect,
  margin: number,
): boolean {
  const minX = rect.x - margin
  const maxX = rect.x + rect.w + margin
  const minY = rect.y - margin
  const maxY = rect.y + rect.h + margin
  const dx = x2 - x1
  const dy = y2 - y1
  let tMin = 0
  let tMax = 1

  if (Math.abs(dx) < 1e-9) {
    if (x1 < minX || x1 > maxX) return false
  } else {
    let t1 = (minX - x1) / dx
    let t2 = (maxX - x1) / dx
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return false
  }

  if (Math.abs(dy) < 1e-9) {
    if (y1 < minY || y1 > maxY) return false
  } else {
    let t1 = (minY - y1) / dy
    let t2 = (maxY - y1) / dy
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return false
  }
  return true
}

/** True when a straight path of the given half-width is free of islands. */
export function isPathClear(
  arena: Arena,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  margin: number,
): boolean {
  for (const rect of arena.obstacles) {
    if (segmentIntersectsRect(x1, y1, x2, y2, rect, margin)) return false
  }
  return true
}
