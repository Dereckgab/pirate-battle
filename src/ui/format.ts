import type { EndReason } from '../api/contracts'

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatPlayedAt(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '-' : DATE_FORMAT.format(date).replace(',', ' ·')
}

export const END_REASON_LABEL: Record<EndReason, string> = {
  time_up: 'Time up',
  player_destroyed: 'Ship destroyed',
}

export function formatSettings(sessionTimeSec: number, enemySpawnTimeSec: number): string {
  return `${sessionTimeSec} second battles · ${enemySpawnTimeSec} second spawn interval`
}
