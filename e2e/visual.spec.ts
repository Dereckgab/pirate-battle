import type { Page } from '@playwright/test'
import { advance, boot, expect, startMatch, test } from './support/fixtures'

/** Waits until every image on the page (DOM and CSS backgrounds are preloaded by then) is decoded. */
async function waitForImages(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      [...document.images].map((image) => (image.complete ? image.decode().catch(() => undefined) : image.decode())),
    )
  })
}

test.describe('visual regression @mobile', () => {
  test('main menu', async ({ page }) => {
    await boot(page)
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await waitForImages(page)
    await expect(page).toHaveScreenshot('main-menu.png')
  })

  test('arena in a stable state', async ({ page }) => {
    // Fixed seed, no timed spawns and a frozen clock: nothing moves between frames.
    await boot(page, {
      e2e: {
        manualClock: true,
        scenario: {
          seed: 42,
          spawning: false,
          enemies: [
            { kind: 'chaser', x: 1100, y: 420, angle: Math.PI, health: 20 },
            { kind: 'shooter', x: 520, y: 480, angle: 0, health: 35 },
          ],
        },
        configOverrides: { chaser: { maxSpeed: 0, turnRate: 0 }, shooter: { maxSpeed: 0, turnRate: 0, attackRangePx: 0 } },
      },
    })
    await startMatch(page)
    await advance(page, 100)
    await waitForImages(page)
    // Two animation frames so the canvas shows the advanced state.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))),
    )
    await expect(page).toHaveScreenshot('arena-stable.png', { maxDiffPixelRatio: 0.02 })
  })

  test('result screen', async ({ page }) => {
    await boot(page, {
      route: '/result',
      storage: {
        'pirate-battle:player': { id: 'player-e2e', name: 'Captain E2E' },
        'pirate-battle:last-match': {
          id: '00000000-0000-4000-8000-000000000001',
          playerId: 'player-e2e',
          playerName: 'Captain E2E',
          playedAt: '2026-05-01T12:00:00.000Z',
          score: 24,
          durationSec: 120,
          endReason: 'time_up',
          settings: { sessionTimeSec: 120, enemySpawnTimeSec: 3, configVersion: '1.0.0' },
        },
      },
    })
    await expect(page.getByTestId('result-score')).toHaveText('24')
    await waitForImages(page)
    await expect(page).toHaveScreenshot('result.png')
  })
})
