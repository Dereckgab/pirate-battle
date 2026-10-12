import { boot, expect, getState, startMatch, test } from './support/fixtures'

test.describe('options', () => {
  test('navigates from the menu, validates and rejects out-of-range values @mobile', async ({ page }) => {
    await boot(page)
    await page.getByRole('button', { name: 'Options' }).click()
    await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible()

    const sessionTime = page.getByRole('spinbutton', { name: 'Game session time' })
    const spawnTime = page.getByRole('spinbutton', { name: 'Enemy spawn time' })
    await expect(sessionTime).toHaveValue('120')
    await expect(spawnTime).toHaveValue('3')

    await sessionTime.fill('30')
    await spawnTime.fill('0')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByRole('alert').filter({ hasText: 'Game session time' })).toHaveText(
      'Game session time must be between 60 and 180 seconds.',
    )
    await expect(page.getByRole('alert').filter({ hasText: 'Enemy spawn time' })).toHaveText(
      'Enemy spawn time must be between 0.5 and 10 seconds.',
    )
    await expect(sessionTime).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Options saved')).toHaveCount(0)

    // Nothing invalid was persisted.
    await page.reload()
    await expect(page.getByRole('spinbutton', { name: 'Game session time' })).toHaveValue('120')
  })

  test('saves valid values, keeps them after a refresh and applies them to the next match @mobile', async ({
    page,
  }) => {
    await boot(page, { route: '/options' })
    await page.getByRole('spinbutton', { name: 'Game session time' }).fill('90')
    await page.getByRole('spinbutton', { name: 'Enemy spawn time' }).fill('1.5')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Options saved' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('spinbutton', { name: 'Game session time' })).toHaveValue('90')
    await expect(page.getByRole('spinbutton', { name: 'Enemy spawn time' })).toHaveValue('1.5')

    await page.getByRole('button', { name: 'Main Menu' }).click()
    await startMatch(page)
    await expect(page.getByTestId('hud-time')).toHaveText('01:30')
    expect((await getState(page)).remainingSec).toBe(90)
  })

  test('stepper buttons respect the documented limits', async ({ page }) => {
    await boot(page, { route: '/options' })
    const spawnTime = page.getByRole('spinbutton', { name: 'Enemy spawn time' })
    await spawnTime.fill('10')
    await page.getByRole('button', { name: 'Increase enemy spawn time' }).click()
    await expect(spawnTime).toHaveValue('10')
    await page.getByRole('button', { name: 'Decrease enemy spawn time' }).click()
    await expect(spawnTime).toHaveValue('9.5')
  })

  test('a running match keeps the settings it started with', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    // Options change behind the match's back (e.g. another tab): the snapshot must not move.
    await page.evaluate(() => {
      window.localStorage.setItem(
        'pirate-battle:options',
        JSON.stringify({ sessionTimeSec: 60, enemySpawnTimeSec: 1, soundEnabled: false }),
      )
    })
    const state = await page.evaluate(() => window.__pb!.advance(1000))
    expect(state.remainingSec).toBe(119)
  })
})
