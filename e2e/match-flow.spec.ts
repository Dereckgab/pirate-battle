import type { E2EOptions } from '../src/game/testing'
import {
  advance,
  boot,
  expect,
  getRegisteredMatches,
  getState,
  holdKey,
  SHORT_OPTIONS,
  startMatch,
  test,
  waitForFreshMatch,
} from './support/fixtures'

const SHORT_STORAGE = { 'pirate-battle:options': SHORT_OPTIONS }

/** The player dies on the first ram: 10 health against 18 ram damage. */
const DEATH_SCENARIO: E2EOptions = {
  manualClock: true,
  scenario: {
    seed: 42,
    spawning: false,
    player: { health: 10 },
    enemies: [{ kind: 'chaser', x: 800, y: 250, angle: Math.PI / 2 }],
  },
}

test.describe('match end', () => {
  test('ends when the time runs out and freezes the simulation @mobile', async ({ page }) => {
    await boot(page, { storage: SHORT_STORAGE })
    await startMatch(page)

    const almost = await advance(page, 59_000)
    expect(almost.status).toBe('running')
    await expect(page.getByTestId('hud-time')).toHaveText('00:01')

    // Ending and then trying to keep playing within the same task: nothing may advance.
    const [ended, later] = await page.evaluate(() => {
      const atEnd = window.__pb!.advance(2000)
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      return [atEnd, window.__pb!.advance(5000)]
    })
    expect(ended).toMatchObject({ status: 'ended', endReason: 'time_up', elapsedSec: 60, remainingSec: 0 })
    expect(later.tick).toBe(ended.tick)
    expect(later.player).toEqual(ended.player)
    expect(later.projectiles).toHaveLength(0)

    await expect(page).toHaveURL(/#\/result$/)
    await expect(page.getByRole('heading', { name: 'Battle complete' })).toBeVisible()
    await expect(page.getByTestId('result-score')).toHaveText('0')
    await expect(page.getByTestId('result-time')).toHaveText('01:00')
    await expect(page.getByTestId('result-reason')).toHaveText('Time up')
    await expect(page.getByTestId('registration-status')).toHaveText('Saved to the ranking and match history.')
  })

  test('ends when the player is destroyed and stops damage, spawns and scoring @mobile', async ({ page }) => {
    await boot(page, { e2e: DEATH_SCENARIO, storage: SHORT_STORAGE })
    await startMatch(page)

    const [ended, later] = await page.evaluate(() => {
      const atEnd = window.__pb!.advance(5000)
      return [atEnd, window.__pb!.advance(5000)]
    })
    expect(ended).toMatchObject({ status: 'ended', endReason: 'player_destroyed', score: 0 })
    expect(ended.player.health).toBe(0)
    expect(ended.elapsedSec).toBeLessThan(2)
    expect(later.tick).toBe(ended.tick)
    expect(later.spawnedCount).toBe(ended.spawnedCount)

    await expect(page.getByRole('heading', { name: 'Ship destroyed' })).toBeVisible()
    await expect(page.getByTestId('result-reason')).toHaveText('Ship destroyed')
    await expect(page.getByTestId('result-time')).toHaveText('00:01')
  })

  test('shows the result again after a refresh', async ({ page }) => {
    await boot(page, { e2e: DEATH_SCENARIO, storage: SHORT_STORAGE })
    await startMatch(page)
    await advance(page, 5000)
    await expect(page.getByTestId('result-reason')).toHaveText('Ship destroyed')
    const time = await page.getByTestId('result-time').textContent()

    await page.reload()
    await expect(page).toHaveURL(/#\/result$/)
    await expect(page.getByRole('heading', { name: 'Ship destroyed' })).toBeVisible()
    await expect(page.getByTestId('result-score')).toHaveText('0')
    await expect(page.getByTestId('result-time')).toHaveText(time!)

    // The menu also keeps a summary of the last completed match.
    await page.getByRole('button', { name: 'Main Menu' }).click()
    await expect(page.getByText('Last battle:')).toContainText('0 points')
  })

  test('Play Again and Restart start from a clean state', async ({ page }) => {
    await boot(page, { e2e: DEATH_SCENARIO, storage: SHORT_STORAGE })
    await startMatch(page)
    await holdKey(page, 'KeyD', 300)
    await page.keyboard.down('Space')
    await advance(page, 5000)
    await page.keyboard.up('Space')
    await expect(page).toHaveURL(/#\/result$/)

    await page.getByRole('button', { name: 'Play Again' }).click()
    await waitForFreshMatch(page)
    let state = await getState(page)
    expect(state).toMatchObject({ status: 'running', tick: 0, score: 0, elapsedSec: 0, remainingSec: 60 })
    expect(state.player).toMatchObject({ x: 800, y: 420, health: 10, speed: 0 })
    expect(state.enemies).toHaveLength(1)
    expect(state.projectiles).toHaveLength(0)
    await expect(page.locator('[data-testid="arena"] canvas')).toHaveCount(1)

    // Restart from the pause menu, mid-match.
    await holdKey(page, 'KeyA', 200)
    await page.keyboard.press('KeyP')
    await page.getByRole('button', { name: 'Restart' }).click()
    await waitForFreshMatch(page)
    state = await getState(page)
    expect(state).toMatchObject({ status: 'running', paused: false, tick: 0, score: 0 })
    expect(state.player.angle).toBeCloseTo(-Math.PI / 2, 5)
    await expect(page.getByTestId('hud-time')).toHaveText('01:00')
    await expect(page.locator('[data-testid="arena"] canvas')).toHaveCount(1)
  })
})

test.describe('pause', () => {
  test('manual pause suspends clock, cooldowns and simulation until the player resumes @mobile', async ({
    page,
  }) => {
    await boot(page)
    await startMatch(page)
    await page.keyboard.down('KeyW')
    await page.keyboard.down('Space')
    const running = await advance(page, 1000)
    await expect(page.getByTestId('hud-time')).toHaveText('01:59')

    await page.getByRole('button', { name: 'Pause' }).click()
    const dialog = page.getByRole('dialog', { name: 'Paused' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Resume' })).toBeFocused()

    const paused = await advance(page, 5000)
    expect(paused.paused).toBe(true)
    expect(paused.tick).toBe(running.tick)
    expect(paused.player).toEqual(running.player)
    expect(paused.projectiles).toEqual(running.projectiles)
    await expect(page.getByTestId('hud-time')).toHaveText('01:59')

    await dialog.getByRole('button', { name: 'Resume' }).click()
    await expect(dialog).toHaveCount(0)

    // The keys held before the pause are not replayed: the ship coasts and no shot is fired.
    const projectilesBefore = running.projectiles.length
    const resumed = await advance(page, 500)
    expect(resumed.paused).toBe(false)
    expect(resumed.tick).toBe(running.tick + 30)
    expect(resumed.player.speed).toBeLessThan(running.player.speed)
    expect(resumed.projectiles.length).toBeLessThanOrEqual(projectilesBefore)
    await page.keyboard.up('KeyW')
    await page.keyboard.up('Space')
  })

  test('keyboard toggles the pause and the dialog traps focus', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    await page.keyboard.press('Escape')
    const dialog = page.getByRole('dialog', { name: 'Paused' })
    await expect(dialog).toBeVisible()

    // Tabbing never reaches the page behind the dialog (HUD, touch controls).
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      const focusStaysInDialog = await dialog.evaluate((element) => {
        const active = document.activeElement
        return active === null || active === document.body || element.contains(active)
      })
      expect(focusStaysInDialog).toBe(true)
    }
    // Game keys are ignored while paused.
    await page.keyboard.press('KeyQ')
    await page.keyboard.press('KeyW')
    expect((await getState(page)).projectiles).toHaveLength(0)

    await page.keyboard.press('KeyP')
    await expect(dialog).toHaveCount(0)
    expect((await getState(page)).paused).toBe(false)
  })

  test('pauses automatically when the window loses focus or the tab is hidden', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    await advance(page, 500)

    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    const dialog = page.getByRole('dialog', { name: 'Paused' })
    await expect(dialog).toContainText('lost focus')
    expect((await advance(page, 3000)).tick).toBe(30)

    // Coming back is not enough: the player has to resume.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Resume' }).click()
    expect((await advance(page, 500)).tick).toBe(60)

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(dialog).toBeVisible()
    expect((await getState(page)).paused).toBe(true)
  })

  test('with the real clock, time spent paused is never added to the match', async ({ page }) => {
    await boot(page, { e2e: { manualClock: false, scenario: { seed: 42, spawning: false } } })
    await startMatch(page)
    await page.waitForFunction(() => window.__pb!.getState().tick > 20)

    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
    const pausedAt = (await getState(page)).tick
    const clock = await page.getByTestId('hud-time').textContent()

    await page.waitForTimeout(1500)
    expect((await getState(page)).tick).toBe(pausedAt)
    await expect(page.getByTestId('hud-time')).toHaveText(clock!)

    const resumedAt = Date.now()
    await page.getByRole('button', { name: 'Resume' }).click()
    await page.waitForFunction((tick) => window.__pb!.getState().tick > tick + 10, pausedAt)
    const state = await getState(page)
    const realStepsSinceResume = ((Date.now() - resumedAt) / 1000) * 60
    // Only time after the resume counts (plus a small scheduling margin).
    expect(state.tick - pausedAt).toBeLessThanOrEqual(realStepsSinceResume + 12)
  })
})

test.describe('leaving and coming back', () => {
  test('an abandoned match is not registered anywhere @mobile', async ({ page }) => {
    await boot(page, { storage: SHORT_STORAGE })
    await startMatch(page)
    await advance(page, 10_000)
    await page.keyboard.press('KeyP')
    await page.getByRole('button', { name: 'Main Menu' }).click()

    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await expect(page.getByText('Last battle:')).toHaveCount(0)
    await expect(page.locator('canvas')).toHaveCount(0)
    expect(await page.evaluate(() => window.__pb)).toBeUndefined()
    expect(await getRegisteredMatches(page)).toHaveLength(0)
    expect(await page.evaluate(() => window.localStorage.getItem('pirate-battle:outbox'))).toBeNull()

    await page.getByRole('button', { name: 'Match History' }).click()
    await expect(page.getByText('You have no registered battles yet')).toBeVisible()
  })

  test('reloading during combat discards the match and returns to the menu', async ({ page }) => {
    await boot(page, { storage: SHORT_STORAGE })
    await startMatch(page)
    await advance(page, 5000)
    await page.reload()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    expect(await getRegisteredMatches(page)).toHaveLength(0)
  })

  test('survives repeated navigation between screens without leaking canvases', async ({ page }) => {
    await boot(page)
    for (let round = 0; round < 4; round++) {
      await startMatch(page)
      await holdKey(page, 'KeyW', 300)
      await expect(page.locator('canvas')).toHaveCount(1)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Main Menu' }).click()
      await expect(page.locator('canvas')).toHaveCount(0)

      await page.getByRole('button', { name: 'Options' }).click()
      await page.getByRole('button', { name: 'Main Menu' }).click()
      await page.getByRole('button', { name: 'Ranking' }).click()
      await expect(page.getByTestId('ranking-table')).toBeVisible()
      await page.getByRole('tab', { name: 'Match History' }).click()
      await page.getByRole('button', { name: 'Main Menu' }).click()
    }
    // Browser back from the match also tears it down.
    await startMatch(page)
    await page.goBack()
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(0)
    expect(await page.evaluate(() => window.__pb)).toBeUndefined()
  })
})
