import { readJson, removeKey, STORAGE_KEYS, writeJson } from '../lib/storage'

/**
 * Reproducible network conditions for the mocked ranking/history APIs.
 * The active scenario lives in localStorage, so it survives refreshes, works in the published
 * build and can be switched from the Network Lab screen, the URL or a test.
 */
export const SCENARIOS = {
  success: {
    label: 'Success',
    description: 'Every request succeeds after the configured latency. Lists span multiple pages.',
  },
  empty: {
    label: 'Empty lists',
    description: 'Ranking and match history answer with no entries.',
  },
  slow: {
    label: 'Slow network',
    description: 'Every response takes 2.5 seconds, still below the client timeout.',
  },
  'variable-latency': {
    label: 'Variable latency',
    description: 'Each response is delayed by a seeded random time between 100 ms and 2 s.',
  },
  'out-of-order': {
    label: 'Out-of-order responses',
    description: 'Earlier requests answer later than newer ones (1.8 s, 0.2 s, 1.2 s, 0.1 s, ...).',
  },
  timeout: {
    label: 'Timeout',
    description: 'Requests never get an answer, so the client timeout fires.',
  },
  offline: {
    label: 'Connection failure',
    description: 'Every request fails at the network level, as if the device were offline.',
  },
  'http-400': {
    label: 'HTTP 400',
    description: 'Every request is rejected with 400 Bad Request (not retried by the client).',
  },
  'http-500': {
    label: 'HTTP 500',
    description: 'Every request fails with 500 Internal Server Error.',
  },
  'ranking-error': {
    label: 'Ranking unavailable',
    description: 'Only the ranking query fails (HTTP 500). History and registration work.',
  },
  'history-error': {
    label: 'History unavailable',
    description: 'Only the match history query fails (HTTP 500). Ranking and registration work.',
  },
  'submit-timeout-after-save': {
    label: 'Timeout after registering',
    description:
      'The first registration of each match is stored but its response is lost. The retry must recover the existing record without duplicating it.',
  },
  'submit-unavailable': {
    label: 'Registration unavailable',
    description:
      'Registering a match fails with HTTP 503 while queries keep working. Switch back to Success to recover and register pending matches.',
  },
} as const

export type ScenarioId = keyof typeof SCENARIOS

export interface NetworkScenario {
  id: ScenarioId
  /** Base latency applied by scenarios without their own timing rules. */
  latencyMs: number
  /** Seed of the latency generator used by `variable-latency`. */
  seed: number
}

export const DEFAULT_SCENARIO: NetworkScenario = { id: 'success', latencyMs: 250, seed: 1 }

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === 'string' && Object.hasOwn(SCENARIOS, value)
}

function isScenario(value: unknown): value is NetworkScenario {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isScenarioId(candidate.id) &&
    typeof candidate.latencyMs === 'number' &&
    candidate.latencyMs >= 0 &&
    typeof candidate.seed === 'number'
  )
}

export function getScenario(): NetworkScenario {
  return readJson(STORAGE_KEYS.mockScenario, isScenario) ?? DEFAULT_SCENARIO
}

export function setScenario(scenario: Partial<NetworkScenario>): NetworkScenario {
  const next = { ...getScenario(), ...scenario }
  writeJson(STORAGE_KEYS.mockScenario, next)
  return next
}

export function resetScenario(): void {
  removeKey(STORAGE_KEYS.mockScenario)
}

/** Applies `?scenario=<id>&latency=<ms>&seed=<n>` so demos can be shared as links. */
export function applyScenarioFromUrl(search: string): void {
  const params = new URLSearchParams(search)
  const id = params.get('scenario')
  if (!isScenarioId(id)) return
  const latency = Number(params.get('latency'))
  const seed = Number(params.get('seed'))
  setScenario({
    id,
    ...(params.has('latency') && Number.isFinite(latency) && latency >= 0 ? { latencyMs: latency } : {}),
    ...(params.has('seed') && Number.isFinite(seed) ? { seed } : {}),
  })
}
