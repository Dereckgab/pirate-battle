import { create } from 'zustand'
import { isMatchSubmission, type MatchSubmission } from '../api/contracts'
import { readJson, STORAGE_KEYS, writeJson } from '../lib/storage'

export type SubmissionStatus = 'queued' | 'sending' | 'failed'

/** A finished match whose registration has not been confirmed by the server yet. */
export interface PendingSubmission {
  match: MatchSubmission
  status: SubmissionStatus
  error: string | null
}

interface PlayerIdentity {
  id: string
  name: string
}

function isIdentity(value: unknown): value is PlayerIdentity {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string'
}

function isMatchList(value: unknown): value is MatchSubmission[] {
  return Array.isArray(value) && value.every(isMatchSubmission)
}

function loadIdentity(): PlayerIdentity {
  const stored = readJson(STORAGE_KEYS.player, isIdentity)
  if (stored) return stored
  const id = crypto.randomUUID()
  const identity = { id, name: `Captain ${id.slice(0, 4).toUpperCase()}` }
  writeJson(STORAGE_KEYS.player, identity)
  return identity
}

interface MatchState {
  player: PlayerIdentity
  /** Result of the last completed match, kept across refreshes. */
  lastMatch: MatchSubmission | null
  /** Completed matches waiting for a confirmed registration, kept across refreshes. */
  pending: PendingSubmission[]
  completeMatch: (match: MatchSubmission) => void
  setStatus: (matchId: string, status: SubmissionStatus, error?: string | null) => void
  confirm: (matchId: string) => void
}

function persistPending(pending: PendingSubmission[]): void {
  writeJson(
    STORAGE_KEYS.outbox,
    pending.map((item) => item.match),
  )
}

export const useMatchStore = create<MatchState>((set, get) => ({
  player: loadIdentity(),
  lastMatch: readJson(STORAGE_KEYS.lastMatch, isMatchSubmission),
  pending: (readJson(STORAGE_KEYS.outbox, isMatchList) ?? []).map((match) => ({
    match,
    status: 'queued',
    error: null,
  })),

  completeMatch: (match) => {
    if (get().pending.some((item) => item.match.id === match.id)) return
    const pending: PendingSubmission[] = [...get().pending, { match, status: 'queued', error: null }]
    writeJson(STORAGE_KEYS.lastMatch, match)
    persistPending(pending)
    set({ lastMatch: match, pending })
  },

  setStatus: (matchId, status, error = null) => {
    set({
      pending: get().pending.map((item) =>
        item.match.id === matchId ? { ...item, status, error } : item,
      ),
    })
  },

  confirm: (matchId) => {
    const pending = get().pending.filter((item) => item.match.id !== matchId)
    persistPending(pending)
    set({ pending })
  },
}))
