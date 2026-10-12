const PREFIX = 'pirate-battle:'

export const STORAGE_KEYS = {
  options: `${PREFIX}options`,
  player: `${PREFIX}player`,
  lastMatch: `${PREFIX}last-match`,
  outbox: `${PREFIX}outbox`,
  mockMatches: `${PREFIX}mock:matches`,
  mockScenario: `${PREFIX}mock:scenario`,
  mockLostResponses: `${PREFIX}mock:lost-responses`,
} as const

/** Reads and validates JSON from localStorage. Corrupt or unavailable storage yields null. */
export function readJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isValid(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the game keeps working with in-memory state.
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore.
  }
}
