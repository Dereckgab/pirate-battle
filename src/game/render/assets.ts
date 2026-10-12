import { Assets, Rectangle, type Spritesheet, Texture } from 'pixi.js'
import { TILE_SIZE } from '../sim/arena'
import { SHIP_ATLAS_FRAMES, type ShipAtlasFrame } from './shipAtlasFrames'

const TILE_SHEET_COLUMNS = 16
/** A download that makes no progress for this long is reported as a failure. */
const LOAD_TIMEOUT_MS = 20_000


interface UiFrameMetadata {
  ui?: { alpha_bounds?: { x: number; y: number; w: number; h: number } }
}

export interface GameAssets {
  ship: Readonly<Record<ShipAtlasFrame, Texture>>
  /** Returns the 64x64 tile with the given 1-based index of the tile sheet. */
  tile: (index: number) => Texture
  healthBar: {
    frame: Texture
    /** Fill textures trimmed to their opaque area so they can be scaled from the left edge. */
    fillRed: Texture
    fillGreen: Texture
    /** Offset of the fill inside the frame, in frame units. */
    fillOffset: { x: number; y: number }
  }
}

export type AssetProgressListener = (progress: number) => void

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}assets/${path}`
}

function subTexture(base: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: base.source, frame: new Rectangle(x, y, w, h) })
}

async function loadAll(onProgress?: AssetProgressListener): Promise<GameAssets> {
  // Pick the atlas variant matching the display density; both share the same logical sizes.
  const highDensity = window.devicePixelRatio > 1.25
  const shipsUrl = assetUrl('spritesheet/ships_miscellaneous_sheet.png')
  const tilesUrl = assetUrl(highDensity ? 'tilesheet/tiles_sheet_retina.png' : 'tilesheet/tiles_sheet.png')
  const uiUrl = assetUrl(highDensity ? 'spritesheet/ui_sheet_retina.json' : 'spritesheet/ui_sheet.json')

  const loaded = await Assets.load<Texture | Spritesheet>(
    [
      { alias: 'ships', src: shipsUrl },
      { alias: 'tiles', src: tilesUrl, data: { resolution: highDensity ? 2 : 1 } },
      { alias: 'ui', src: uiUrl },
    ],
    onProgress,
  )
  const ships = loaded.ships as Texture
  const tiles = loaded.tiles as Texture
  const ui = loaded.ui as Spritesheet

  const ship = {} as Record<ShipAtlasFrame, Texture>
  for (const name of Object.keys(SHIP_ATLAS_FRAMES) as ShipAtlasFrame[]) {
    const [x, y, w, h] = SHIP_ATLAS_FRAMES[name]
    ship[name] = subTexture(ships, x, y, w, h)
  }

  const tileCache = new Map<number, Texture>()
  const tile = (index: number): Texture => {
    let texture = tileCache.get(index)
    if (!texture) {
      const col = (index - 1) % TILE_SHEET_COLUMNS
      const row = Math.floor((index - 1) / TILE_SHEET_COLUMNS)
      texture = subTexture(tiles, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      tileCache.set(index, texture)
    }
    return texture
  }

  const frameTexture = ui.textures.enemy_health_frame
  const redTexture = ui.textures.enemy_health_fill_red
  const greenTexture = ui.textures.enemy_health_fill_green
  if (!frameTexture || !redTexture || !greenTexture) {
    throw new Error('UI atlas is missing the health bar frames')
  }
  const metadata = (ui.data.frames as Record<string, UiFrameMetadata>).enemy_health_fill_red
  const bounds = metadata?.ui?.alpha_bounds ?? { x: 21, y: 9, w: 118, h: 21 }
  const trimFill = (texture: Texture): Texture =>
    subTexture(texture, texture.frame.x + bounds.x, texture.frame.y + bounds.y, bounds.w, bounds.h)

  return {
    ship,
    tile,
    healthBar: {
      frame: frameTexture,
      fillRed: trimFill(redTexture),
      fillGreen: trimFill(greenTexture),
      fillOffset: { x: bounds.x, y: bounds.y },
    },
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Asset loading timed out')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

let cached: Promise<GameAssets> | null = null

/**
 * Loads the combat textures once and reuses them for every match. A failed attempt is not
 * cached, so calling this again retries the download.
 */
export function loadGameAssets(onProgress?: AssetProgressListener): Promise<GameAssets> {
  if (!cached) {
    const attempt = withTimeout(loadAll(onProgress), LOAD_TIMEOUT_MS)
    cached = attempt
    attempt.catch(() => {
      if (cached === attempt) cached = null
    })
    return attempt
  }
  return cached.then((assets) => {
    onProgress?.(1)
    return assets
  })
}
