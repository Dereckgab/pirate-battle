/**
 * Single source of truth for gameplay balancing.
 *
 * Systems read every tunable from a `GameConfig` snapshot taken when a match starts, so
 * balancing never requires touching simulation logic. Distances are expressed in arena
 * units (logical pixels of the 1600x896 arena), time in seconds and angles in radians.
 */

export interface WeaponConfig {
  /** Minimum time between two shots of this weapon. */
  cooldownSec: number
  damage: number
  /** Projectile speed in arena units per second. */
  projectileSpeed: number
  /** Maximum travelled distance before the projectile expires. */
  rangePx: number
  /** Maximum time alive before the projectile expires. */
  lifetimeSec: number
}

export interface BroadsideConfig extends WeaponConfig {
  /** Number of parallel projectiles fired per volley. */
  projectileCount: number
  /** Distance between neighbouring projectiles along the hull. */
  spacingPx: number
}

export interface ShipStats {
  maxHealth: number
  maxSpeed: number
  acceleration: number
  /** Deceleration applied when not thrusting. */
  drag: number
  /** Rotation speed in radians per second. */
  turnRate: number
  /** Collision radius. */
  radius: number
}

export interface PlayerConfig extends ShipStats {
  frontCannon: WeaponConfig
  broadside: BroadsideConfig
}

export interface ChaserConfig extends ShipStats {
  /** Damage dealt to the player when the chaser rams and explodes. */
  ramDamage: number
}

export interface ShooterConfig extends ShipStats {
  cannon: WeaponConfig
  /** Distance to the player at which the shooter is allowed to fire. */
  attackRangePx: number
  /** Distance at which the shooter stops advancing and holds position. */
  holdDistancePx: number
  /** Maximum aim error allowed before firing. */
  aimToleranceRad: number
}

export interface SpawnConfig {
  intervalSec: number
  /** Relative weights of the random enemy distribution. */
  weights: { chaser: number; shooter: number }
  /** Enemies never spawn closer than this to the player. */
  minDistanceFromPlayerPx: number
  /** Safety cap on simultaneously alive enemies (skips spawns while reached). */
  maxAliveEnemies: number
}

export interface GameConfig {
  /** Bumped whenever balancing changes, so rankings only compare like with like. */
  version: string
  arena: { width: number; height: number }
  match: { durationSec: number }
  spawn: SpawnConfig
  player: PlayerConfig
  chaser: ChaserConfig
  shooter: ShooterConfig
  projectile: { radius: number }
}

/** Limits of the values exposed in the Options screen. */
export const OPTION_LIMITS = {
  sessionTimeSec: { min: 60, max: 180, step: 10 },
  enemySpawnTimeSec: { min: 0.5, max: 10, step: 0.5 },
} as const

export const DEFAULT_GAME_CONFIG: GameConfig = {
  version: '1.0.0',
  arena: { width: 1600, height: 896 },
  match: { durationSec: 120 },
  spawn: {
    intervalSec: 3,
    weights: { chaser: 0.55, shooter: 0.45 },
    minDistanceFromPlayerPx: 420,
    maxAliveEnemies: 40,
  },
  player: {
    maxHealth: 100,
    maxSpeed: 190,
    acceleration: 260,
    drag: 180,
    turnRate: 2.6,
    radius: 26,
    frontCannon: {
      cooldownSec: 0.45,
      damage: 20,
      projectileSpeed: 520,
      rangePx: 560,
      lifetimeSec: 1.4,
    },
    broadside: {
      cooldownSec: 1.1,
      damage: 16,
      projectileSpeed: 480,
      rangePx: 420,
      lifetimeSec: 1.2,
      projectileCount: 3,
      spacingPx: 20,
    },
  },
  chaser: {
    maxHealth: 40,
    maxSpeed: 140,
    acceleration: 220,
    drag: 160,
    turnRate: 2.2,
    radius: 24,
    ramDamage: 18,
  },
  shooter: {
    maxHealth: 60,
    maxSpeed: 95,
    acceleration: 160,
    drag: 160,
    turnRate: 1.7,
    radius: 26,
    attackRangePx: 400,
    holdDistancePx: 300,
    aimToleranceRad: 0.14,
    cannon: {
      cooldownSec: 1.8,
      damage: 10,
      projectileSpeed: 330,
      rangePx: 460,
      lifetimeSec: 1.6,
    },
  },
  projectile: { radius: 5 },
}

export interface PlayerOptions {
  sessionTimeSec: number
  enemySpawnTimeSec: number
}

export const DEFAULT_PLAYER_OPTIONS: PlayerOptions = {
  sessionTimeSec: DEFAULT_GAME_CONFIG.match.durationSec,
  enemySpawnTimeSec: DEFAULT_GAME_CONFIG.spawn.intervalSec,
}

export type OptionField = keyof PlayerOptions

export function validateOption(field: OptionField, rawValue: string): string | null {
  const limits = OPTION_LIMITS[field]
  const label = field === 'sessionTimeSec' ? 'Game session time' : 'Enemy spawn time'
  if (rawValue.trim() === '') return `${label} is required.`
  const value = Number(rawValue)
  if (!Number.isFinite(value)) return `${label} must be a number.`
  if (value < limits.min || value > limits.max) {
    return `${label} must be between ${limits.min} and ${limits.max} seconds.`
  }
  if (field === 'sessionTimeSec' && !Number.isInteger(value)) {
    return `${label} must be a whole number of seconds.`
  }
  return null
}

export function isValidOptions(value: unknown): value is PlayerOptions {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    validateOption('sessionTimeSec', String(candidate.sessionTimeSec)) === null &&
    validateOption('enemySpawnTimeSec', String(candidate.enemySpawnTimeSec)) === null
  )
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }
export type GameConfigOverrides = DeepPartial<GameConfig>

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (value && typeof value === 'object' && current && typeof current === 'object') {
      mergeInto(current as Record<string, unknown>, value as Record<string, unknown>)
    } else if (value !== undefined) {
      target[key] = value
    }
  }
}

/** Builds the immutable snapshot a match runs with. Later option changes do not affect it. */
export function createMatchConfig(
  options: PlayerOptions,
  overrides?: GameConfigOverrides,
): GameConfig {
  const config = structuredClone(DEFAULT_GAME_CONFIG)
  config.match.durationSec = options.sessionTimeSec
  config.spawn.intervalSec = options.enemySpawnTimeSec
  if (overrides) {
    mergeInto(config as unknown as Record<string, unknown>, overrides as Record<string, unknown>)
  }
  return Object.freeze(config)
}
