import {
  keepPreviousData,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { useMatchStore } from '../state/matchStore'
import type { MatchSubmission, RankingParams } from './contracts'
import { ApiError, toApiError } from './http'
import { fetchMatchHistory, fetchRanking, submitMatch } from './matchesApi'

export const PAGE_SIZE = 5
const MAX_RETRIES = 2

function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_RETRIES && toApiError(error).retryable
}

function retryDelay(attempt: number): number {
  return Math.min(400 * 2 ** attempt, 3000)
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay,
        // Tabs are remounted every time they are shown again: always revalidate then.
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: { retry: shouldRetry, retryDelay },
    },
  })
}

export const queryKeys = {
  ranking: ['ranking'] as const,
  rankingPage: (params: RankingParams) => ['ranking', params] as const,
  history: ['history'] as const,
  historyPage: (playerId: string, page: number) => ['history', playerId, page] as const,
}

/**
 * Each page has its own cache entry and every request carries the query's AbortSignal, so
 * a slow, superseded response is cancelled instead of overwriting newer data.
 */
export function useRanking(params: RankingParams) {
  return useQuery<Awaited<ReturnType<typeof fetchRanking>>, ApiError>({
    queryKey: queryKeys.rankingPage(params),
    queryFn: ({ signal }) => fetchRanking(params, signal),
    placeholderData: keepPreviousData,
  })
}

export function useMatchHistory(playerId: string, page: number) {
  return useQuery<Awaited<ReturnType<typeof fetchMatchHistory>>, ApiError>({
    queryKey: queryKeys.historyPage(playerId, page),
    queryFn: ({ signal }) => fetchMatchHistory(playerId, { page, pageSize: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  })
}

/**
 * Registers finished matches and keeps the pending queue in sync.
 *
 * - every completed match is queued locally first, so it survives failures and refreshes;
 * - a match already being sent is never sent twice (guarded here and by the idempotent API);
 * - once confirmed, the match leaves the queue and both ranking and history are invalidated.
 */
export function useMatchRegistration() {
  const queryClient = useQueryClient()
  const { mutate } = useMutation<Awaited<ReturnType<typeof submitMatch>>, ApiError, MatchSubmission>({
    mutationKey: ['matches', 'register'],
    mutationFn: submitMatch,
    onMutate: (match) => {
      useMatchStore.getState().setStatus(match.id, 'sending')
    },
    onSuccess: (_response, match) => {
      useMatchStore.getState().confirm(match.id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.ranking })
      void queryClient.invalidateQueries({ queryKey: queryKeys.history })
    },
    onError: (error, match) => {
      useMatchStore.getState().setStatus(match.id, 'failed', error.message)
    },
  })

  const register = useCallback(
    (matchId: string) => {
      const item = useMatchStore.getState().pending.find((entry) => entry.match.id === matchId)
      if (!item || item.status === 'sending') return
      mutate(item.match)
    },
    [mutate],
  )

  const registerAll = useCallback(() => {
    for (const item of useMatchStore.getState().pending) {
      if (item.status !== 'sending') mutate(item.match)
    }
  }, [mutate])

  return { register, registerAll }
}

/** Sends queued matches on startup, when new ones arrive and when the connection returns. */
export function usePendingMatchSync(): ReturnType<typeof useMatchRegistration> {
  const registration = useMatchRegistration()
  const { register, registerAll } = registration
  const queuedIds = useMatchStore((state) =>
    state.pending
      .filter((item) => item.status === 'queued')
      .map((item) => item.match.id)
      .join(','),
  )

  useEffect(() => {
    if (!queuedIds) return
    for (const id of queuedIds.split(',')) register(id)
  }, [queuedIds, register])

  useEffect(() => {
    window.addEventListener('online', registerAll)
    return () => window.removeEventListener('online', registerAll)
  }, [registerAll])

  return registration
}
