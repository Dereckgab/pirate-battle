import type { Page } from '@playwright/test'
import type { E2EOptions } from '../src/game/testing'
import {
  advance,
  boot,
  expect,
  getRegisteredMatches,
  pressGameKey,
  setNetwork,
  SHORT_OPTIONS,
  startMatch,
  test,
  waitForArena,
} from './support/fixtures'

const SHORT_STORAGE = { 'pirate-battle:options': SHORT_OPTIONS }

/** One stationary, one-shot enemy straight ahead: an easy, deterministic point. */
const ONE_KILL: E2EOptions = {
  manualClock: true,
  scenario: {
    seed: 42,
    spawning: false,
    enemies: [{ kind: 'chaser', x: 800, y: 220, angle: Math.PI / 2, health: 20 }],
  },
  configOverrides: { chaser: { maxSpeed: 0, turnRate: 0 } },
}

/** Plays a complete 60-second match scoring exactly one point. */
async function playMatchWithOnePoint(page: Page): Promise<void> {
  await waitForArena(page)
  await pressGameKey(page, 'Space')
  const state = await advance(page, 1000)
  expect(state.score).toBe(1)
  await page.evaluate(() => window.__pb!.advance(60_000))
  await expect(page).toHaveURL(/#\/result$/)
  await expect(page.getByTestId('result-score')).toHaveText('1')
}

const rankingRows = (page: Page) => page.getByTestId('ranking-table').locator('tbody tr')
const historyRows = (page: Page) => page.getByTestId('history-table').locator('tbody tr')
const registration = (page: Page) => page.getByTestId('registration-status')

test.describe('ranking tab', () => {
  test('lists the board ordered by score and paginates @mobile', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'Ranking' }).click()
    await expect(page.getByRole('tab', { name: 'Ranking' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('120 second battles · 3 second spawn interval')).toBeVisible()

    await expect(rankingRows(page)).toHaveCount(5)
    await expect(page.getByText('Page 1 of 5')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await expect(rankingRows(page).first().locator('td').first()).toHaveText('01')

    const scores = (await rankingRows(page).locator('td:nth-child(3)').allTextContents()).map(Number)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))

    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page.getByText('Page 2 of 5')).toBeVisible()
    await expect(rankingRows(page).first().locator('td').first()).toHaveText('06')
    const nextScores = (await rankingRows(page).locator('td:nth-child(3)').allTextContents()).map(Number)
    expect(Math.max(...nextScores)).toBeLessThanOrEqual(Math.min(...scores))

    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page.getByText('Page 5 of 5')).toBeVisible()
    await expect(rankingRows(page)).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  test('shows a loading state while the request is in flight', async ({ page }) => {
    await boot(page, { network: { id: 'success', latencyMs: 1200 } })
    await page.getByRole('button', { name: 'Ranking' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Loading ranking…' })).toBeVisible()
    await expect(rankingRows(page)).toHaveCount(5)
    await expect(page.getByText('Loading ranking…')).toHaveCount(0)
  })

  test('shows an empty state', async ({ page }) => {
    await boot(page, { network: { id: 'empty' } })
    await page.getByRole('button', { name: 'Ranking' }).click()
    await expect(page.getByText('No battles recorded for these settings yet')).toBeVisible()
    await expect(page.getByTestId('ranking-table')).toHaveCount(0)
  })

  test('shows an accessible error and recovers with Try again', async ({ page }) => {
    await boot(page, { network: { id: 'ranking-error' } })
    await page.getByRole('button', { name: 'Ranking' }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Could not load the ranking: Ranking service is unavailable')

    // The failure is isolated: the history tab still works, and so does the game.
    await page.getByRole('tab', { name: 'Match History' }).click()
    await expect(page.getByText('You have no registered battles yet')).toBeVisible()
    await page.getByRole('tab', { name: 'Ranking' }).click()
    await expect(alert).toBeVisible()

    await setNetwork(page, { id: 'success' })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(rankingRows(page)).toHaveCount(5)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  for (const id of ['offline', 'timeout', 'http-400', 'http-500'] as const) {
    test(`reports "${id}" failures without blocking the game`, async ({ page }) => {
      test.slow(id === 'timeout')
      await boot(page, { network: { id } })
      await page.getByRole('button', { name: 'Ranking' }).click()
      await expect(page.getByRole('alert')).toContainText('Could not load the ranking', { timeout: 20_000 })

      await page.getByRole('button', { name: 'Main Menu' }).click()
      await startMatch(page)
      expect((await advance(page, 1000)).status).toBe('running')
    })
  }

  test('a slow, outdated response never overwrites a newer page', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'Ranking' }).click()
    await expect(page.getByText('Page 1 of 5')).toBeVisible()

    // From now on the first request takes 1.8 s and the second only 0.2 s.
    await setNetwork(page, { id: 'out-of-order' })
    const next = page.getByRole('button', { name: 'Next page' })
    await next.click() // page 2, slow
    await next.click() // page 3, fast

    await expect(rankingRows(page).first().locator('td').first()).toHaveText('11')
    await expect(page.getByText('Page 3 of 5')).toBeVisible()
    // Wait past the slow response: page 3 must still be on screen.
    await page.waitForTimeout(2200)
    await expect(rankingRows(page).first().locator('td').first()).toHaveText('11')
    await expect(page.getByText('Page 3 of 5')).toBeVisible()
  })
})

test.describe('match history tab', () => {
  test('starts empty, reports errors and recovers', async ({ page }) => {
    await boot(page, { network: { id: 'history-error' } })
    await page.getByRole('button', { name: 'Match History' }).click()
    await expect(page.getByRole('tab', { name: 'Match History' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('alert')).toContainText('Could not load the match history')

    await setNetwork(page, { id: 'success' })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('You have no registered battles yet')).toBeVisible()
  })

  test('tabs are keyboard operable', async ({ page }) => {
    await boot(page, { route: '/log/ranking' })
    await page.getByRole('tab', { name: 'Ranking' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Match History' })).toBeFocused()
    await expect(page.getByRole('tab', { name: 'Match History' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toContainText('Battles of Captain')
  })

  test('paginates the player history, most recent first', async ({ page }) => {
    const player = { id: 'player-e2e', name: 'Captain E2E' }
    const matches = Array.from({ length: 7 }, (_, index) => ({
      id: `seed-${index}`,
      playerId: player.id,
      playerName: player.name,
      playedAt: new Date(Date.UTC(2026, 4, 1 + index, 12)).toISOString(),
      registeredAt: new Date(Date.UTC(2026, 4, 1 + index, 12)).toISOString(),
      score: index,
      durationSec: 60,
      endReason: index % 2 ? 'time_up' : 'player_destroyed',
      settings: { sessionTimeSec: 60, enemySpawnTimeSec: 3, configVersion: '1.0.0' },
    }))
    await boot(page, {
      route: '/log/history',
      storage: { 'pirate-battle:player': player, 'pirate-battle:mock:matches': matches },
    })

    await expect(historyRows(page)).toHaveCount(5)
    await expect(page.getByText('Page 1 of 2')).toBeVisible()
    await expect(historyRows(page).first()).toContainText('07 May')
    await expect(historyRows(page).first().locator('td').nth(1)).toHaveText('6')
    await expect(historyRows(page).first()).toContainText('01:00')
    await expect(historyRows(page).first()).toContainText('Ship destroyed')

    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(historyRows(page)).toHaveCount(2)
    await expect(historyRows(page).last()).toContainText('01 May')
  })
})

test.describe('match registration', () => {
  test('registers a finished match once and refreshes both tabs @mobile', async ({ page }) => {
    await boot(page, { e2e: ONE_KILL, storage: SHORT_STORAGE })

    // Visit both tabs first so they have cached data that must be invalidated.
    await page.getByRole('button', { name: 'Match History' }).click()
    await expect(page.getByText('You have no registered battles yet')).toBeVisible()
    await page.getByRole('tab', { name: 'Ranking' }).click()
    await expect(page.getByText('Page 1 of 5')).toBeVisible()
    await page.getByRole('button', { name: 'Main Menu' }).click()

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await playMatchWithOnePoint(page)
    await expect(registration(page)).toHaveText('Saved to the ranking and match history.')

    const registered = await getRegisteredMatches(page)
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      score: 1,
      durationSec: 60,
      endReason: 'time_up',
      settings: { sessionTimeSec: 60, enemySpawnTimeSec: 3, configVersion: '1.0.0' },
    })
    expect(registered[0]!.id).toMatch(/^[0-9a-f-]{36}$/)

    await page.getByRole('button', { name: 'Main Menu' }).click()
    await page.getByRole('button', { name: 'Match History' }).click()
    await expect(historyRows(page)).toHaveCount(1)
    await expect(historyRows(page).first()).toContainText('Time up')
    await expect(historyRows(page).first().locator('td').nth(1)).toHaveText('1')

    // The same match shows up exactly once on the ranking board of its settings.
    await page.getByRole('tab', { name: 'Ranking' }).click()
    await expect(page.getByText('Page 1 of 5')).toBeVisible()
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page.getByText('Page 5 of 5')).toBeVisible()
    await expect(rankingRows(page)).toHaveCount(4)
    const own = rankingRows(page).filter({ hasText: 'You' })
    await expect(own).toHaveCount(1)
    await expect(own.locator('td').first()).toHaveText('24')
    await expect(own.locator('td').nth(2)).toHaveText('1')
  })

  test('keeps a pending match across failures and refreshes, then registers it once', async ({ page }) => {
    await boot(page, { e2e: ONE_KILL, storage: SHORT_STORAGE, network: { id: 'submit-unavailable' } })
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await playMatchWithOnePoint(page)

    // The API is down when the match ends: the result is still shown and kept locally.
    await expect(registration(page)).toContainText('Could not register this battle')
    await expect(registration(page)).toContainText('temporarily unavailable')
    expect(await getRegisteredMatches(page)).toHaveLength(0)

    // A pending registration never blocks playing again.
    await page.getByRole('button', { name: 'Play Again' }).click()
    await waitForArena(page)
    await page.keyboard.press('KeyP')
    await page.getByRole('button', { name: 'Main Menu' }).click()
    await expect(page.getByText('1 match is waiting to be registered.')).toBeVisible()

    // Refresh: the pending match is restored and retried, still failing.
    await page.reload()
    await expect(page.getByText('1 match is waiting to be registered.')).toBeVisible()
    await page.getByRole('button', { name: 'View result' }).click()
    await expect(page.getByTestId('result-score')).toHaveText('1')
    await expect(registration(page)).toContainText('Could not register this battle')

    // The service recovers. Impatient double click on retry: still a single record.
    await setNetwork(page, { id: 'success' })
    await page.getByRole('button', { name: 'Retry registration' }).dblclick()
    await expect(registration(page)).toHaveText('Saved to the ranking and match history.')
    expect(await getRegisteredMatches(page)).toHaveLength(1)
    expect(await page.evaluate(() => window.localStorage.getItem('pirate-battle:outbox'))).toBe('[]')

    await page.getByRole('button', { name: 'Main Menu' }).click()
    await expect(page.getByText('waiting to be registered')).toHaveCount(0)
    await page.getByRole('button', { name: 'Match History' }).click()
    await expect(historyRows(page)).toHaveCount(1)
  })

  test('recovers from a timeout after the server stored the match, without duplicating it', async ({ page }) => {
    test.slow()
    await boot(page, { e2e: ONE_KILL, storage: SHORT_STORAGE, network: { id: 'submit-timeout-after-save' } })
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await playMatchWithOnePoint(page)

    // First response is lost (client timeout); the automatic retry gets the existing record.
    await expect(registration(page)).toHaveText('Registering battle…')
    await expect(registration(page)).toHaveText('Saved to the ranking and match history.', { timeout: 20_000 })
    expect(await getRegisteredMatches(page)).toHaveLength(1)

    await page.getByRole('button', { name: 'Main Menu' }).click()
    await page.getByRole('button', { name: 'Match History' }).click()
    await expect(historyRows(page)).toHaveCount(1)
    await page.getByRole('tab', { name: 'Ranking' }).click()
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next page' }).click()
    await expect(rankingRows(page).filter({ hasText: 'You' })).toHaveCount(1)
  })

  test('registers after a refresh that happened while the request was lost', async ({ page }) => {
    await boot(page, { e2e: ONE_KILL, storage: SHORT_STORAGE, network: { id: 'timeout' } })
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await playMatchWithOnePoint(page)
    await expect(registration(page)).toHaveText('Registering battle…')

    // Refresh mid-request, with the network healthy again.
    await setNetwork(page, { id: 'success' })
    await page.reload()
    await expect(page.getByTestId('result-score')).toHaveText('1')
    await expect(registration(page)).toHaveText('Saved to the ranking and match history.')
    expect(await getRegisteredMatches(page)).toHaveLength(1)
  })
})

test.describe('network lab', () => {
  test('selects a scenario and restores the initial state', async ({ page }) => {
    await boot(page, { e2e: ONE_KILL, storage: SHORT_STORAGE })
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await playMatchWithOnePoint(page)
    await expect(registration(page)).toHaveText('Saved to the ranking and match history.')
    await page.getByRole('button', { name: 'Main Menu' }).click()

    await page.getByRole('button', { name: 'Network lab' }).click()
    await page.getByRole('radio', { name: /^HTTP 500/ }).check()
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByTestId('network-status')).toHaveText('Scenario "HTTP 500" is active.')
    expect(await page.evaluate(() => window.__pbMock!.getScenario().id)).toBe('http-500')

    // The scenario survives a refresh.
    await page.reload()
    await expect(page.getByRole('radio', { name: /^HTTP 500/ })).toBeChecked()

    await page.getByRole('button', { name: 'Reset Mocks' }).click()
    await expect(page.getByTestId('network-status')).toContainText('Mock server restored')
    await expect(page.getByRole('radio', { name: /^Success/ })).toBeChecked()
    expect(await getRegisteredMatches(page)).toHaveLength(0)

    await page.getByRole('button', { name: 'Main Menu' }).click()
    await page.getByRole('button', { name: 'Match History' }).click()
    await expect(page.getByText('You have no registered battles yet')).toBeVisible()
  })
})
