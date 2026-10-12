import { expect, type Page, test as base } from '@playwright/test'
import type { MatchSubmission } from '../../src/api/contracts'
import type { E2EOptions, MatchSnapshot } from '../../src/game/testing'
import type { NetworkScenario } from '../../src/mocks/scenarios'

export { expect }

export interface BootOptions {
  /** Test instrumentation. Defaults to a manual clock, seed 42 and no timed spawns. */
  e2e?: E2EOptions
  /** Network scenario of the mocked APIs. Defaults to success with no latency. */
  network?: Partial<NetworkScenario>
  /** Raw localStorage entries to seed before the app boots (first load only). */
  storage?: Record<string, unknown>
  route?: string
}

export const DEFAULT_E2E: E2EOptions = {
  manualClock: true,
  scenario: { seed: 42, spawning: false },
}

/** Console messages caused on purpose by failure scenarios (browser network logging). */
const EXPECTED_CONSOLE_NOISE = [/Failed to load resource/i, /net::ERR_/i]

export const test = base.extend<{ consoleErrors: string[] }>({
  // Every test fails if the page logs an unexpected error or throws.
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        if (!EXPECTED_CONSOLE_NOISE.some((pattern) => pattern.test(text))) errors.push(text)
      })
      await use(errors)
      expect(errors, 'unexpected console errors').toEqual([])
    },
    { auto: true },
  ],
})

/**
 * Opens the app with test instrumentation. Every test runs in a fresh browser context, so
 * storage, service worker and mock database start empty.
 */
export async function boot(page: Page, options: BootOptions = {}): Promise<void> {
  const e2e = options.e2e ?? DEFAULT_E2E
  const network = { id: 'success', latencyMs: 0, seed: 1, ...options.network }
  await page.addInitScript(
    ({ e2e, network, storage }) => {
      window.__PB_E2E__ = e2e
      // Seed storage once per test, not again on reloads performed by the test itself.
      if (window.sessionStorage.getItem('pb-e2e-seeded')) return
      window.sessionStorage.setItem('pb-e2e-seeded', '1')
      window.localStorage.setItem('pirate-battle:mock:scenario', JSON.stringify(network))
      for (const [key, value] of Object.entries(storage)) {
        window.localStorage.setItem(key, JSON.stringify(value))
      }
    },
    { e2e, network, storage: options.storage ?? {} },
  )
  await page.goto(`/#${options.route ?? '/'}`)
}

/** Starts a match from the main menu and waits until the arena is rendering. */
export async function startMatch(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await waitForArena(page)
}

export async function waitForArena(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="arena"][data-ready="true"]')).toBeVisible()
  await page.waitForFunction(() => window.__pb !== undefined)
}

/** Waits for a brand-new match (after Restart or Play Again) to be ready. */
export async function waitForFreshMatch(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="arena"][data-ready="true"]')).toBeVisible()
  await page.waitForFunction(() => window.__pb !== undefined && window.__pb.getState().tick === 0)
}

export function getState(page: Page): Promise<MatchSnapshot> {
  return page.evaluate(() => window.__pb!.getState())
}

/** Advances the simulation clock; rules, input and rendering run as in a real session. */
export function advance(page: Page, ms: number): Promise<MatchSnapshot> {
  return page.evaluate((duration) => window.__pb!.advance(duration), ms)
}

/** Holds a key down while the game clock advances. */
export async function holdKey(page: Page, key: string, ms: number): Promise<MatchSnapshot> {
  await page.keyboard.down(key)
  const state = await advance(page, ms)
  await page.keyboard.up(key)
  return state
}

export async function pressGameKey(page: Page, key: string): Promise<MatchSnapshot> {
  return holdKey(page, key, 1000 / 60)
}

export function setNetwork(page: Page, scenario: Partial<NetworkScenario>): Promise<NetworkScenario> {
  return page.evaluate((next) => window.__pbMock!.setScenario(next), scenario)
}

export function getRegisteredMatches(page: Page): Promise<MatchSubmission[]> {
  return page.evaluate(() => window.__pbMock!.getMatches())
}

/** Plays a full 60-second match that ends by time with the given number of kills. */
export async function playTimedMatch(page: Page): Promise<void> {
  await startMatch(page)
  await page.evaluate(() => window.__pb!.advance(61_000))
  await expect(page).toHaveURL(/#\/result$/)
}

export const SHORT_OPTIONS = { sessionTimeSec: 60, enemySpawnTimeSec: 3, soundEnabled: false }
