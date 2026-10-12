import { boot, expect, test, waitForArena } from './support/fixtures'

const SHIP_ATLAS = '**/assets/spritesheet/ships_miscellaneous_sheet.png'

// Requests that pass through a service worker are invisible to Playwright's router, so these
// tests run without it. As a bonus they prove the game itself never depends on the mock API.
test.use({ serviceWorkers: 'block' })

test.describe('asset loading', () => {
  test('shows loading progress while the combat assets download', async ({ page, context }) => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await context.route(SHIP_ATLAS, async (route) => {
      await gate
      await route.continue()
    })

    await boot(page)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.getByText('Loading battle assets…')).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Asset loading progress' })).toBeVisible()
    // Combat must not start before every texture is available.
    await expect(page.locator('[data-testid="arena"]')).toHaveCount(0)

    release()
    await waitForArena(page)
    await expect(page.getByText('Loading battle assets…')).toHaveCount(0)
  })

  test('reports a failed download and recovers with Try Again @mobile', async ({ page, context }) => {
    let failing = true
    await context.route(SHIP_ATLAS, (route) => (failing ? route.abort('failed') : route.continue()))

    await boot(page)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('The battle assets could not be loaded')
    await expect(page.locator('[data-testid="arena"]')).toHaveCount(0)

    // Still failing: the error is shown again.
    await page.getByRole('button', { name: 'Try Again' }).click()
    await expect(alert).toContainText('The battle assets could not be loaded')

    failing = false
    await page.getByRole('button', { name: 'Try Again' }).click()
    await waitForArena(page)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('a failed load does not block the menus', async ({ page, context }) => {
    await context.route(SHIP_ATLAS, (route) => route.abort('failed'))
    await boot(page)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByRole('button', { name: 'Main Menu' }).click()
    await expect(page.getByRole('button', { name: 'Options' })).toBeVisible()
  })
})
