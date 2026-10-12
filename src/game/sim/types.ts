export type EnemyKind = 'chaser' | 'shooter'
export type EndReason = 'time_up' | 'player_destroyed'
export type ProjectileOwner = 'player' | 'enemy'
export type WeaponSlot = 'front' | 'left' | 'right'

/** Player intent for one simulation step. Produced by the input layer, consumed by the sim. */
export interface InputState {
  forward: boolean
  turnLeft: boolean
  turnRight: boolean
  fireFront: boolean
  fireLeft: boolean
  fireRight: boolean
}

export const IDLE_INPUT: Readonly<InputState> = Object.freeze({
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
})

export interface Ship {
  id: number
  x: number
  y: number
  /** Heading in radians, 0 pointing to +x. */
  angle: number
  speed: number
  health: number
  maxHealth: number
  radius: number
  /** Previous step transform, used by the renderer to interpolate. */
  prevX: number
  prevY: number
  prevAngle: number
}

export interface Player extends Ship {
  cooldowns: Record<WeaponSlot, number>
}

export interface Enemy extends Ship {
  kind: EnemyKind
  cooldown: number
}

export interface Projectile {
  id: number
  owner: ProjectileOwner
  x: number
  y: number
  prevX: number
  prevY: number
  vx: number
  vy: number
  damage: number
  travelled: number
  maxRange: number
  age: number
  lifetime: number
}

/** One-shot notifications for presentation layers (rendering, audio). Never fed back into rules. */
export type SimEvent =
  | { type: 'shot'; owner: ProjectileOwner; weapon: WeaponSlot; x: number; y: number; angle: number }
  | { type: 'shipHit'; target: 'player' | 'enemy'; x: number; y: number; shipId: number }
  | { type: 'projectileBlocked'; x: number; y: number }
  | { type: 'projectileExpired'; x: number; y: number }
  | { type: 'enemySpawned'; kind: EnemyKind; shipId: number }
  | {
      type: 'enemyDestroyed'
      kind: EnemyKind
      shipId: number
      x: number
      y: number
      angle: number
      byPlayer: boolean
    }
  | { type: 'playerRammed'; x: number; y: number }
  | { type: 'matchEnded'; reason: EndReason }

/** Deterministic initial state, used by tests and demos. */
export interface MatchScenario {
  seed?: number
  /** When false no enemy is spawned by the timer. */
  spawning?: boolean
  player?: { x?: number; y?: number; angle?: number; health?: number }
  enemies?: { kind: EnemyKind; x: number; y: number; angle?: number; health?: number }[]
}

export interface MatchResult {
  score: number
  /** Effective seconds of active play. */
  durationSec: number
  endReason: EndReason
}
