import {
  API_ROUTES,
  type MatchRecord,
  type MatchSubmission,
  type PageParams,
  type Paginated,
  type RankingEntry,
  type RankingParams,
  type SubmitMatchResponse,
} from './contracts'
import { http } from './http'

export async function fetchRanking(
  params: RankingParams,
  signal?: AbortSignal,
): Promise<Paginated<RankingEntry>> {
  const response = await http.get<Paginated<RankingEntry>>(API_ROUTES.ranking, { params, signal })
  return response.data
}

export async function fetchMatchHistory(
  playerId: string,
  params: PageParams,
  signal?: AbortSignal,
): Promise<Paginated<MatchRecord>> {
  const response = await http.get<Paginated<MatchRecord>>(API_ROUTES.playerMatches(playerId), {
    params,
    signal,
  })
  return response.data
}

const inFlight = new Map<string, Promise<SubmitMatchResponse>>()

/**
 * Registers a finished match. Concurrent calls for the same match share one request, and the
 * server treats the match id as an idempotency key, so re-sending never creates duplicates.
 */
export function submitMatch(match: MatchSubmission): Promise<SubmitMatchResponse> {
  const pending = inFlight.get(match.id)
  if (pending) return pending
  const request = http
    .post<SubmitMatchResponse>(API_ROUTES.matches, match, {
      headers: { 'Idempotency-Key': match.id },
    })
    .then((response) => response.data)
    .finally(() => inFlight.delete(match.id))
  inFlight.set(match.id, request)
  return request
}
