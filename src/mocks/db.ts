import {
  compareRanking,
  isMatchSubmission,
  type MatchRecord,
  type MatchSubmission,
  type Paginated,
  type RankingEntry,
  settingsKey,
} from '../api/contracts'
import { readJson, removeKey, STORAGE_KEYS, writeJson } from '../lib/storage'
import { createFixtureMatches } from './fixtures'

/**
 * In-browser "server" state. Confirmed matches are kept in localStorage so they survive
 * refreshes and are shared by the ranking and the history endpoints.
 */

function isRecordList(value: unknown): value is MatchRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => isMatchSubmission(item) && typeof (item as MatchRecord).registeredAt === 'string',
    )
  )
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function listConfirmedMatches(): MatchRecord[] {
  return readJson(STORAGE_KEYS.mockMatches, isRecordList) ?? []
}

/** Stores a match unless it already exists. Returns the stored record either way. */
export function upsertMatch(submission: MatchSubmission): { record: MatchRecord; created: boolean } {
  const matches = listConfirmedMatches()
  const existing = matches.find((match) => match.id === submission.id)
  if (existing) return { record: existing, created: false }
  const record: MatchRecord = { ...submission, registeredAt: new Date().toISOString() }
  writeJson(STORAGE_KEYS.mockMatches, [...matches, record])
  return { record, created: true }
}

export function paginate<T>(items: T[], page: number, pageSize: number): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    totalItems: items.length,
    totalPages,
  }
}

export function queryRanking(
  sessionTimeSec: number,
  enemySpawnTimeSec: number,
  includeFixtures: boolean,
): RankingEntry[] {
  const key = settingsKey({ sessionTimeSec, enemySpawnTimeSec })
  const matches = [
    ...(includeFixtures ? createFixtureMatches(sessionTimeSec, enemySpawnTimeSec) : []),
    ...listConfirmedMatches().filter((match) => settingsKey(match.settings) === key),
  ].sort(compareRanking)
  return matches.map((match, index) => ({
    rank: index + 1,
    matchId: match.id,
    playerId: match.playerId,
    playerName: match.playerName,
    score: match.score,
    durationSec: match.durationSec,
    endReason: match.endReason,
    playedAt: match.playedAt,
  }))
}

export function queryHistory(playerId: string): MatchRecord[] {
  return listConfirmedMatches()
    .filter((match) => match.playerId === playerId)
    .sort((a, b) => (a.playedAt === b.playedAt ? a.id.localeCompare(b.id) : a.playedAt < b.playedAt ? 1 : -1))
}

/** Match ids whose first registration response was deliberately dropped by a scenario. */
export function hasLostResponse(matchId: string): boolean {
  return (readJson(STORAGE_KEYS.mockLostResponses, isStringList) ?? []).includes(matchId)
}

export function rememberLostResponse(matchId: string): void {
  const ids = readJson(STORAGE_KEYS.mockLostResponses, isStringList) ?? []
  writeJson(STORAGE_KEYS.mockLostResponses, [...ids, matchId])
}

export function resetDatabase(): void {
  removeKey(STORAGE_KEYS.mockMatches)
  removeKey(STORAGE_KEYS.mockLostResponses)
}
