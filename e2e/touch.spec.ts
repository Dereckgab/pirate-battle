import type { CDPSession, Locator, Page } from '@playwright/test'
import { advance, boot, expect, getState, startMatch, test } from './support/fixtures'

/**
 * Real touch input through the DevTools protocol, so several fingers can be down at once
 * and the browser produces genuine pointer events for the on-screen controls.
 */
class Touchscreen {
  private readonly points = new Map<number, { x: number; y: number }>()
  private readonly client: CDPSession

  private constructor(client: CDPSession) {
    this.client = client
  }

  static async create(page: Page): Promise<Touchscreen> {
    return new Touchscreen(await page.context().newCDPSession(page))
  }

  private touchPoints() {
    return [...this.points].map(([id, point]) => ({ id, x: point.x, y: point.y }))
  }

  async press(id: number, target: Locator): Promise<void> {
    const box = (await target.boundingBox())!
    const first = this.points.size === 0
    this.points.set(id, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    await this.client.send('Input.dispatchTouchEvent', {
      type: first ? 'touchStart' : 'touchMove',
      touchPoints: this.touchPoints(),
    })
  }

  async release(id: number): Promise<void> {
    this.points.delete(id)
    await this.client.send('Input.dispatchTouchEvent', {
      type: this.points.size === 0 ? 'touchEnd' : 'touchMove',
      touchPoints: this.touchPoints(),
    })
  }
}

test.describe('touch controls @mobile', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'requires a touch device')

  test('are visible, labelled and fit inside the arena', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    const frame = (await page.locator('.arena-frame').boundingBox())!
    const viewport = page.viewportSize()!
    // The arena keeps its aspect ratio and is fully visible.
    expect(frame.width / frame.height).toBeCloseTo(1600 / 896, 1)
    expect(frame.x).toBeGreaterThanOrEqual(0)
    expect(frame.y).toBeGreaterThanOrEqual(0)
    expect(frame.x + frame.width).toBeLessThanOrEqual(viewport.width + 0.5)
    expect(frame.y + frame.height).toBeLessThanOrEqual(viewport.height + 0.5)

    const labels = [
      'Turn left',
      'Sail forward',
      'Turn right',
      'Fire left broadside',
      'Fire front cannon',
      'Fire right broadside',
      'Pause',
    ]
    for (const name of labels) {
      const button = page.getByRole('button', { name, exact: true })
      const box = (await button.boundingBox())!
      expect(box.width, `${name} is a comfortable touch target`).toBeGreaterThanOrEqual(40)
      expect(box.x).toBeGreaterThanOrEqual(frame.x)
      expect(box.y).toBeGreaterThanOrEqual(frame.y)
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5)
      expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5)
    }
    for (const id of ['hud-health', 'hud-score', 'hud-time']) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 })
    }
  })

  test('steer, sail and fire, including two fingers at once', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    const touch = await Touchscreen.create(page)
    const button = (name: string) => page.getByRole('button', { name, exact: true })

    await touch.press(1, button('Sail forward'))
    const sailing = await advance(page, 800)
    expect(sailing.player.y).toBeLessThan(420 - 40)

    // Second finger fires while the first keeps sailing.
    await touch.press(2, button('Fire front cannon'))
    const firing = await advance(page, 200)
    expect(firing.projectiles.filter((projectile) => projectile.owner === 'player')).toHaveLength(1)
    expect(firing.player.y).toBeLessThan(sailing.player.y)
    await touch.release(2)
    await touch.release(1)

    const coasting = await advance(page, 2000)
    expect(coasting.player.speed).toBe(0)

    await touch.press(1, button('Turn right'))
    const turned = await advance(page, 500)
    await touch.release(1)
    expect(turned.player.angle).toBeGreaterThan(coasting.player.angle + 1)

    await touch.press(1, button('Fire left broadside'))
    const port = await advance(page, 100)
    await touch.release(1)
    await touch.press(1, button('Fire right broadside'))
    const starboard = await advance(page, 100)
    await touch.release(1)
    expect(port.projectiles.length).toBeGreaterThanOrEqual(3)
    expect(starboard.projectiles.length).toBe(port.projectiles.length + 3)
  })

  test('pause button works by touch and releases held controls', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    const touch = await Touchscreen.create(page)
    await touch.press(1, page.getByRole('button', { name: 'Sail forward', exact: true }))
    await advance(page, 500)
    await touch.release(1)

    await page.getByRole('button', { name: 'Pause', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
    const paused = await getState(page)
    expect((await advance(page, 1000)).tick).toBe(paused.tick)

    await page.getByRole('button', { name: 'Resume' }).tap()
    const resumed = await advance(page, 300)
    expect(resumed.player.speed).toBeLessThan(paused.player.speed)
  })
})
