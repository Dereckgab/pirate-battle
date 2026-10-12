import type { MatchRecord } from '../api/contracts'
import { DEFAULT_GAME_CONFIG } from '../game/config/gameConfig'
import { createRng, hashString } from '../game/sim/rng'

const CAPTAINS = [
  'Captain Flint',
  'Red Sparrow',
  'Storm Rider',
  'Sea Wolf',
  'Black Marlin',
  'Iron Anne',
  'Old Barnacle',
  'Calico Jack',
  'Mad Morgan',
  'Silver Tide',
  'Coral Queen',
  'Dread Bonny',
  'Salty Pete',
  'Lady Tempest',
  'Gunpowder Gus',
  'Kraken Kate',
  'One-Eyed Finn',
  'Blue Mary',
  'Rum Runner',
  'Tidebreaker',
  'Anchor Abe',
  'Brine Baron',
  'Lucky Lou',
] as const

/** Fixed reference date so fixtures are identical on every run and machine. */
const FIXTURE_EPOCH = Date.UTC(2026, 0, 15, 18, 0, 0)

/**
 * Other players' matches for a given settings board. They are derived deterministically from
 * the settings, so every board has plausible, stable and paginated opponents.
 */
export function createFixtureMatches(sessionTimeSec: number, enemySpawnTimeSec: number): MatchRecord[] {
  const random = createRng(hashString(`${sessionTimeSec}:${enemySpawnTimeSec}`))
  const maxKills = Math.max(4, Math.round((sessionTimeSec / enemySpawnTimeSec) * 0.85))

  return CAPTAINS.map((playerName, index) => {
    const skill = 1 - index / (CAPTAINS.length + 4)
    const score = Math.max(0, Math.round(maxKills * skill * (0.75 + random() * 0.25)))
    const survived = random() < 0.35 + skill * 0.5
    const durationSec = survived ? sessionTimeSec : Math.round(sessionTimeSec * (0.35 + random() * 0.6))
    const playedAt = new Date(FIXTURE_EPOCH - index * 47 * 60_000 - Math.floor(random() * 30) * 60_000)
    const id = `fixture-${sessionTimeSec}-${enemySpawnTimeSec}-${String(index + 1).padStart(2, '0')}`
    return {
      id,
      playerId: `fixture-player-${String(index + 1).padStart(2, '0')}`,
      playerName,
      playedAt: playedAt.toISOString(),
      registeredAt: playedAt.toISOString(),
      score,
      durationSec,
      endReason: survived ? 'time_up' : 'player_destroyed',
      settings: {
        sessionTimeSec,
        enemySpawnTimeSec,
        configVersion: DEFAULT_GAME_CONFIG.version,
      },
    }
  })
}
