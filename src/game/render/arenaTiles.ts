import { type IslandDef, TILE_SIZE } from '../sim/arena'

/** 1-based indices into the 16-column tile sheet. */
export const WATER_TILE = 73

const SAND_NINE_SLICE = [
  [1, 2, 3],
  [17, 18, 19],
  [33, 34, 35],
] as const

const GRASS_ISLAND = [
  [6, 7, 8, 9],
  [22, 23, 24, 25],
  [38, 39, 40, 41],
  [54, 55, 56, 57],
] as const

function sliceIndex(position: number, count: number): 0 | 1 | 2 {
  if (position === 0) return 0
  return position === count - 1 ? 2 : 1
}

/** Tile to draw at a cell of an island. */
export function islandTile(island: IslandDef, col: number, row: number): number {
  if (island.style === 'grass' && island.cols === 4 && island.rows === 4) {
    return GRASS_ISLAND[row]![col]!
  }
  return SAND_NINE_SLICE[sliceIndex(row, island.rows)][sliceIndex(col, island.cols)]
}

export interface Decoration {
  tile: number
  x: number
  y: number
  scale?: number
  rotation?: number
}

const ROCK = 50
const MOSSY_ROCK = 66
const SMALL_ROCK = 49
const PALM = 71
const FERN = 70
const BUSH = 72

/** Purely cosmetic props placed on top of the islands. */
export const DECORATIONS: readonly Decoration[] = [
  { tile: PALM, x: 5.1 * TILE_SIZE, y: 3.2 * TILE_SIZE },
  { tile: BUSH, x: 6.6 * TILE_SIZE, y: 4.6 * TILE_SIZE, scale: 0.8 },
  { tile: MOSSY_ROCK, x: 6.9 * TILE_SIZE, y: 3.1 * TILE_SIZE, scale: 0.8 },
  { tile: ROCK, x: 16.2 * TILE_SIZE, y: 3.4 * TILE_SIZE },
  { tile: FERN, x: 18.6 * TILE_SIZE, y: 3.2 * TILE_SIZE, scale: 0.9 },
  { tile: SMALL_ROCK, x: 17.6 * TILE_SIZE, y: 4.0 * TILE_SIZE, scale: 0.8 },
  { tile: PALM, x: 12.6 * TILE_SIZE, y: 9.3 * TILE_SIZE },
  { tile: FERN, x: 11.2 * TILE_SIZE, y: 10.7 * TILE_SIZE, scale: 0.85 },
  { tile: MOSSY_ROCK, x: 20.5 * TILE_SIZE, y: 9.5 * TILE_SIZE, scale: 0.9 },
  { tile: BUSH, x: 3.5 * TILE_SIZE, y: 10.5 * TILE_SIZE },
]
