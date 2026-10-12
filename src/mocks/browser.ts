import { setupWorker } from 'msw/browser'
import type { MatchRecord } from '../api/contracts'
import { listConfirmedMatches, resetDatabase } from './db'
import { handlers, resetHandlerState } from './handlers'
import {
  applyScenarioFromUrl,
  getScenario,
  type NetworkScenario,
  resetScenario,
  setScenario,
} from './scenarios'

/** Console/test access to the mocked backend: `window.__pbMock`. */
export interface MockApi {
  getScenario: () => NetworkScenario
  setScenario: (scenario: Partial<NetworkScenario>) => NetworkScenario
  /** Restores the default scenario and removes every registered match. */
  reset: () => void
  getMatches: () => MatchRecord[]
}

declare global {
  interface Window {
    __pbMock?: MockApi
  }
}

export function applyScenario(scenario: Partial<NetworkScenario>): NetworkScenario {
  resetHandlerState()
  return setScenario(scenario)
}

export function resetMockBackend(): void {
  resetHandlerState()
  resetScenario()
  resetDatabase()
}

const START_TIMEOUT_MS = 4000

/**
 * Starts the Mock Service Worker. The same handlers back development, tests and the
 * published demo. Failing to start never blocks the game: API calls will simply error.
 */
export async function startMockBackend(): Promise<boolean> {
  applyScenarioFromUrl(window.location.search)
  window.__pbMock = {
    getScenario,
    setScenario: applyScenario,
    reset: resetMockBackend,
    getMatches: listConfirmedMatches,
  }
  try {
    const worker = setupWorker(...handlers)
    await Promise.race([
      worker.start({
        onUnhandledFrame: 'bypass',
        quiet: true,
        serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
      }),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('Mock Service Worker start timed out')), START_TIMEOUT_MS)
      }),
    ])
    return true
  } catch (error) {
    console.warn('[mocks] Ranking and history APIs are unavailable:', error)
    return false
  }
}
