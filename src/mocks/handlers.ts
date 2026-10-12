import { delay, http, HttpResponse } from 'msw'
import {
  API_ROUTES,
  type ApiErrorBody,
  isMatchSubmission,
  type MatchRecord,
  type Paginated,
  type RankingEntry,
  type SubmitMatchResponse,
} from '../api/contracts'
import { createRng, type Rng } from '../game/sim/rng'
import {
  hasLostResponse,
  paginate,
  queryHistory,
  queryRanking,
  rememberLostResponse,
  upsertMatch,
} from './db'
import { getScenario, type NetworkScenario } from './scenarios'

const API_BASE = '/api'
const OUT_OF_ORDER_LATENCIES = [1800, 200, 1200, 100] as const
const SLOW_LATENCY_MS = 2500

type Endpoint = 'ranking' | 'history' | 'submit'

let requestCount = 0
let latencyRng: { seed: number; next: Rng } | null = null

/** Restarts the deterministic latency sequences (called when a scenario is applied). */
export function resetHandlerState(): void {
  requestCount = 0
  latencyRng = null
}

function latencyFor(scenario: NetworkScenario): number {
  const index = requestCount++
  switch (scenario.id) {
    case 'slow':
      return SLOW_LATENCY_MS
    case 'variable-latency': {
      if (!latencyRng || latencyRng.seed !== scenario.seed) {
        latencyRng = { seed: scenario.seed, next: createRng(scenario.seed) }
      }
      return Math.round(100 + latencyRng.next() * 1900)
    }
    case 'out-of-order':
      return OUT_OF_ORDER_LATENCIES[index % OUT_OF_ORDER_LATENCIES.length]!
    default:
      return scenario.latencyMs
  }
}

function errorResponse(status: number, message: string) {
  return HttpResponse.json<ApiErrorBody>({ message }, { status })
}

/** Applies the failure rules shared by all endpoints. Returns a response to short-circuit. */
async function applyScenario(scenario: NetworkScenario, endpoint: Endpoint) {
  if (scenario.id === 'timeout') {
    await delay('infinite')
  }
  await delay(latencyFor(scenario))
  if (scenario.id === 'offline') return HttpResponse.error()
  if (scenario.id === 'http-400') return errorResponse(400, 'Bad request (simulated).')
  if (scenario.id === 'http-500') return errorResponse(500, 'Internal server error (simulated).')
  if (scenario.id === 'ranking-error' && endpoint === 'ranking') {
    return errorResponse(500, 'Ranking service is unavailable (simulated).')
  }
  if (scenario.id === 'history-error' && endpoint === 'history') {
    return errorResponse(500, 'Match history service is unavailable (simulated).')
  }
  if (scenario.id === 'submit-unavailable' && endpoint === 'submit') {
    return errorResponse(503, 'Match registration is temporarily unavailable (simulated).')
  }
  return null
}

function readPage(url: URL): { page: number; pageSize: number } {
  const page = Number(url.searchParams.get('page') ?? 1)
  const pageSize = Number(url.searchParams.get('pageSize') ?? 5)
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 50 ? pageSize : 5,
  }
}

export const handlers = [
  http.get(`${API_BASE}${API_ROUTES.ranking}`, async ({ request }) => {
    const scenario = getScenario()
    const failure = await applyScenario(scenario, 'ranking')
    if (failure) return failure

    const url = new URL(request.url)
    const sessionTimeSec = Number(url.searchParams.get('sessionTimeSec'))
    const enemySpawnTimeSec = Number(url.searchParams.get('enemySpawnTimeSec'))
    if (!Number.isFinite(sessionTimeSec) || !Number.isFinite(enemySpawnTimeSec)) {
      return errorResponse(400, 'sessionTimeSec and enemySpawnTimeSec are required.')
    }
    const { page, pageSize } = readPage(url)
    const entries =
      scenario.id === 'empty' ? [] : queryRanking(sessionTimeSec, enemySpawnTimeSec, true)
    return HttpResponse.json<Paginated<RankingEntry>>(paginate(entries, page, pageSize))
  }),

  http.get(`${API_BASE}/players/:playerId/matches`, async ({ request, params }) => {
    const scenario = getScenario()
    const failure = await applyScenario(scenario, 'history')
    if (failure) return failure

    const { page, pageSize } = readPage(new URL(request.url))
    const matches = scenario.id === 'empty' ? [] : queryHistory(String(params.playerId))
    return HttpResponse.json<Paginated<MatchRecord>>(paginate(matches, page, pageSize))
  }),

  http.post(`${API_BASE}${API_ROUTES.matches}`, async ({ request }) => {
    const scenario = getScenario()
    const failure = await applyScenario(scenario, 'submit')
    if (failure) return failure

    const body: unknown = await request.json().catch(() => null)
    if (!isMatchSubmission(body)) return errorResponse(400, 'Invalid match payload.')

    // The match id is the idempotency key: registering twice returns the first record.
    const result = upsertMatch(body)
    if (scenario.id === 'submit-timeout-after-save' && !hasLostResponse(body.id)) {
      rememberLostResponse(body.id)
      await delay('infinite')
    }
    return HttpResponse.json<SubmitMatchResponse>(result, { status: result.created ? 201 : 200 })
  }),
]
