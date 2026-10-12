import { type Arena, circleIntersectsRect } from './arena'

const CELL_SIZE = 32
const UNREACHABLE = 0xffff

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

/**
 * Coarse navigation grid with a breadth-first distance field towards a target (the player).
 * Enemies follow the field downhill whenever an island blocks their straight path.
 */
export class NavGrid {
  readonly cols: number
  readonly rows: number
  private readonly blocked: Uint8Array
  private readonly distance: Uint16Array
  private readonly queue: Int32Array
  private targetCell = -1

  constructor(arena: Arena, clearance: number) {
    this.cols = Math.ceil(arena.width / CELL_SIZE)
    this.rows = Math.ceil(arena.height / CELL_SIZE)
    const size = this.cols * this.rows
    this.blocked = new Uint8Array(size)
    this.distance = new Uint16Array(size).fill(UNREACHABLE)
    this.queue = new Int32Array(size)

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = (col + 0.5) * CELL_SIZE
        const y = (row + 0.5) * CELL_SIZE
        const outside =
          x < clearance || y < clearance || x > arena.width - clearance || y > arena.height - clearance
        const inIsland = arena.obstacles.some((rect) => circleIntersectsRect(x, y, clearance, rect))
        if (outside || inIsland) this.blocked[row * this.cols + col] = 1
      }
    }
  }

  private cellAt(x: number, y: number): number {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL_SIZE)))
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL_SIZE)))
    return row * this.cols + col
  }

  /** Rebuilds the distance field only when the target moved to another cell. */
  setTarget(x: number, y: number): void {
    const target = this.cellAt(x, y)
    if (target === this.targetCell) return
    this.targetCell = target

    const { distance, queue, blocked, cols, rows } = this
    distance.fill(UNREACHABLE)
    let head = 0
    let tail = 0
    distance[target] = 0
    queue[tail++] = target

    while (head < tail) {
      const cell = queue[head++]!
      const col = cell % cols
      const row = (cell - col) / cols
      const next = distance[cell]! + 1
      for (const [dc, dr] of NEIGHBOURS) {
        const nc = col + dc
        const nr = row + dr
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
        const neighbour = nr * cols + nc
        if (blocked[neighbour] || distance[neighbour] !== UNREACHABLE) continue
        // Do not cut island corners diagonally.
        if (dc !== 0 && dr !== 0 && (blocked[row * cols + nc] || blocked[nr * cols + col])) continue
        distance[neighbour] = next
        queue[tail++] = neighbour
      }
    }
  }

  isReachable(x: number, y: number): boolean {
    return this.distance[this.cellAt(x, y)] !== UNREACHABLE
  }

  /**
   * Writes the centre of the best neighbouring cell to move to from (x, y) into `out`.
   * Returns false when no neighbour leads to the target.
   */
  nextWaypoint(x: number, y: number, out: { x: number; y: number }): boolean {
    const { distance, cols, rows } = this
    const cell = this.cellAt(x, y)
    const col = cell % cols
    const row = (cell - col) / cols
    let best = distance[cell]!
    let bestCol = -1
    let bestRow = -1

    // A ship pushed into an island's clearance band stands on a blocked cell: look two rings out.
    const reach = best === UNREACHABLE ? 2 : 1
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        if (dc === 0 && dr === 0) continue
        const nc = col + dc
        const nr = row + dr
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
        const value = distance[nr * cols + nc]!
        if (value < best) {
          best = value
          bestCol = nc
          bestRow = nr
        }
      }
    }
    if (bestCol < 0) return false
    out.x = (bestCol + 0.5) * CELL_SIZE
    out.y = (bestRow + 0.5) * CELL_SIZE
    return true
  }
}
