import type { GameConfigOverrides } from './config/gameConfig'
import type { EndReason, MatchScenario } from './sim/types'

/**
 * Test instrumentation contract.
 *
 * Playwright sets `window.__PB_E2E__` before the app boots. It can then observe the match
 * and drive the simulation clock, while rules, input handling, collisions and rendering run
 * exactly as in a normal session. Nothing here is active unless that flag is present.
 */
export interface E2EOptions {
  /** When true the match only advances through `window.__pb.advance`. */
  manualClock?: boolean
  scenario?: MatchScenario
  configOverrides?: GameConfigOverrides
}

export interface ShipSnapshot {
  id: number
  x: number
  y: number
  angle: number
  speed: number
  health: number
}

export interface MatchSnapshot {
  status: 'running' | 'ended'
  paused: boolean
  endReason: EndReason | null
  tick: number
  elapsedSec: number
  remainingSec: number
  score: number
  spawnedCount: number
  player: ShipSnapshot & { cooldowns: { front: number; left: number; right: number } }
  enemies: (ShipSnapshot & { kind: 'chaser' | 'shooter' })[]
  projectiles: { id: number; owner: 'player' | 'enemy'; x: number; y: number; vx: number; vy: number }[]
  obstacles: { x: number; y: number; w: number; h: number }[]
  arena: { width: number; height: number }
}

export interface FrameStats {
  frames: number
  averageFps: number
  p95FrameMs: number
  maxFrameMs: number
  maxEntities: number
  averageEntities: number
}

export interface MatchTestApi {
  getState: () => MatchSnapshot
  /** Runs the simulation for the given amount of game time using the live input state. */
  advance: (ms: number) => MatchSnapshot
  getFrameStats: () => FrameStats
  resetFrameStats: () => void
}

declare global {
  interface Window {
    __PB_E2E__?: E2EOptions
    __pb?: MatchTestApi
  }
}

export function getE2EOptions(): E2EOptions | null {
  return typeof window !== 'undefined' && window.__PB_E2E__ ? window.__PB_E2E__ : null
}
