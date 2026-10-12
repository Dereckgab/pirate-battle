import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { navigate } from '../../app/router'
import { PAGE_SIZE, useMatchHistory, useRanking } from '../../api/queries'
import type { ApiError } from '../../api/http'
import { useMatchStore } from '../../state/matchStore'
import { useOptionsStore } from '../../state/optionsStore'
import { MenuButton, Pagination, Screen } from '../../ui/components'
import { END_REASON_LABEL, formatClock, formatPlayedAt, formatSettings } from '../../ui/format'

type LogTab = 'ranking' | 'history'

interface QueryViewProps {
  name: string
  isPending: boolean
  isFetching: boolean
  isPlaceholderData: boolean
  error: ApiError | null
  isEmpty: boolean
  emptyMessage: string
  onRetry: () => void
  children: ReactNode
}

/** Shared loading / error / empty / background-refresh presentation of a paginated query. */
function QueryView({
  name,
  isPending,
  isFetching,
  isPlaceholderData,
  error,
  isEmpty,
  emptyMessage,
  onRetry,
  children,
}: QueryViewProps) {
  if (isPending) {
    return (
      <p className="log-state" role="status">
        Loading {name}…
      </p>
    )
  }
  // An error with no usable data replaces the list; with cached data it becomes a notice.
  if (error && (isEmpty || isPlaceholderData)) {
    return (
      <div className="log-state log-state--error" role="alert">
        <p>
          Could not load the {name}: {error.message}
        </p>
        <button type="button" className="link-button" onClick={onRetry}>
          Try again
        </button>
      </div>
    )
  }
  return (
    <>
      <p className="log-refresh" role="status">
        {error
          ? `Showing saved data. Update failed: ${error.message}`
          : isFetching
            ? `Updating ${name}…`
            : ''}
      </p>
      {isEmpty ? <p className="log-state">{emptyMessage}</p> : children}
    </>
  )
}

function RankingTab() {
  const options = useOptionsStore((state) => state.options)
  const playerId = useMatchStore((state) => state.player.id)
  const [page, setPage] = useState(1)
  const query = useRanking({ ...options, page, pageSize: PAGE_SIZE })
  const data = query.data

  return (
    <>
      <p className="log-caption">{formatSettings(options.sessionTimeSec, options.enemySpawnTimeSec)}</p>
      <QueryView
        name="ranking"
        isPending={query.isPending}
        isFetching={query.isFetching}
        isPlaceholderData={query.isPlaceholderData}
        error={query.error}
        isEmpty={!data || data.items.length === 0}
        emptyMessage="No battles recorded for these settings yet. Be the first on the board!"
        onRetry={() => void query.refetch()}
      >
        <table className="log-table" data-testid="ranking-table" aria-busy={query.isFetching}>
          <caption className="visually-hidden">Ranking ordered by score</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Captain</th>
              <th scope="col">Points</th>
              <th scope="col">Played</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((entry) => (
              <tr key={entry.matchId} className={entry.playerId === playerId ? 'is-own' : undefined}>
                <td>{String(entry.rank).padStart(2, '0')}</td>
                <td>
                  {entry.playerName}
                  {entry.playerId === playerId && <span className="tag">You</span>}
                </td>
                <td>{entry.score}</td>
                <td>{formatPlayedAt(entry.playedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryView>
      {data && data.totalItems > 0 && (
        <Pagination
          page={Math.min(page, data.totalPages)}
          totalPages={data.totalPages}
          onChange={setPage}
          label="Ranking pages"
        />
      )}
    </>
  )
}

function HistoryTab() {
  const player = useMatchStore((state) => state.player)
  const pendingCount = useMatchStore((state) => state.pending.length)
  const [page, setPage] = useState(1)
  const query = useMatchHistory(player.id, page)
  const data = query.data

  return (
    <>
      <p className="log-caption">
        Battles of {player.name}
        {pendingCount > 0 ? ` · ${pendingCount} waiting to be registered` : ''}
      </p>
      <QueryView
        name="match history"
        isPending={query.isPending}
        isFetching={query.isFetching}
        isPlaceholderData={query.isPlaceholderData}
        error={query.error}
        isEmpty={!data || data.items.length === 0}
        emptyMessage="You have no registered battles yet. Play one to start your log."
        onRetry={() => void query.refetch()}
      >
        <table className="log-table" data-testid="history-table" aria-busy={query.isFetching}>
          <caption className="visually-hidden">Your match history, most recent first</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Points</th>
              <th scope="col">Duration</th>
              <th scope="col">Ended by</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((match) => (
              <tr key={match.id}>
                <td>{formatPlayedAt(match.playedAt)}</td>
                <td>{match.score}</td>
                <td>{formatClock(match.durationSec)}</td>
                <td>{END_REASON_LABEL[match.endReason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryView>
      {data && data.totalItems > 0 && (
        <Pagination
          page={Math.min(page, data.totalPages)}
          totalPages={data.totalPages}
          onChange={setPage}
          label="History pages"
        />
      )}
    </>
  )
}

const TABS: readonly { id: LogTab; label: string }[] = [
  { id: 'ranking', label: 'Ranking' },
  { id: 'history', label: 'Match History' },
]

export function CaptainsLog({ tab }: { tab: LogTab }) {
  const select = (next: LogTab) => navigate(`/log/${next}`, { replace: true })

  // Arrow keys move between tabs, as expected from the ARIA tabs pattern.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = tab === 'ranking' ? 'history' : 'ranking'
    select(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  return (
    <Screen wide labelledBy="log-title">
      <h1 id="log-title" className="panel-title">
        Captain&apos;s Log
      </h1>
      <div className="tabs" role="tablist" aria-label="Captain's log sections" onKeyDown={handleKeyDown}>
        {TABS.map((item) => (
          <MenuButton
            key={item.id}
            id={`tab-${item.id}`}
            role="tab"
            variant="secondary"
            selected={tab === item.id}
            aria-selected={tab === item.id}
            aria-controls="log-panel"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => select(item.id)}
          >
            {item.label}
          </MenuButton>
        ))}
      </div>
      <section id="log-panel" className="log-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'ranking' ? <RankingTab /> : <HistoryTab />}
      </section>
      <div className="menu-actions">
        <MenuButton onClick={() => navigate('/')}>Main Menu</MenuButton>
      </div>
    </Screen>
  )
}
