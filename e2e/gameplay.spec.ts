import type { E2EOptions } from '../src/game/testing'
import { advance, boot, expect, getState, holdKey, pressGameKey, startMatch, test } from './support/fixtures'

const PLAYER_RADIUS = 26

function scenario(overrides: E2EOptions['scenario'], configOverrides?: E2EOptions['configOverrides']): E2EOptions {
  return { manualClock: true, scenario: { seed: 42, spawning: false, ...overrides }, configOverrides }
}

/** An enemy that neither moves nor turns, to observe combat in isolation. */
const FROZEN_CHASER = { chaser: { maxSpeed: 0, turnRate: 0, ramDamage: 0 } }

test.describe('movement', () => {
  test('starts a match with a fresh HUD @mobile', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    const state = await getState(page)
    expect(state).toMatchObject({ status: 'running', paused: false, tick: 0, score: 0 })
    expect(state.player).toMatchObject({ x: 800, y: 420, health: 100, speed: 0 })
    await expect(page.getByTestId('hud-score')).toHaveText('0')
    await expect(page.getByTestId('hud-time')).toHaveText('02:00')
    await expect(page.getByTestId('hud-health')).toHaveText('100')
    await expect(page.locator('[data-testid="arena"] canvas')).toHaveCount(1)
  })

  test('sails forward along the heading and coasts to a stop', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    const before = await getState(page)
    const moving = await holdKey(page, 'KeyW', 1000)

    // Facing up: only y changes.
    expect(moving.player.x).toBeCloseTo(before.player.x, 5)
    expect(moving.player.y).toBeLessThan(before.player.y - 80)
    expect(moving.player.speed).toBeCloseTo(190, 0)

    const stopped = await advance(page, 2000)
    expect(stopped.player.speed).toBe(0)
    const later = await advance(page, 500)
    expect(later.player.y).toBe(stopped.player.y)
  })

  test('rotates to both sides at the configured rate', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    const start = (await getState(page)).player.angle

    const right = await holdKey(page, 'KeyD', 500)
    expect(right.player.angle - start).toBeCloseTo(2.6 * 0.5, 2)
    expect(right.player.x).toBe(800)

    const left = await holdKey(page, 'ArrowLeft', 1000)
    expect(left.player.angle - right.player.angle).toBeCloseTo(-2.6, 2)
  })

  test('moves and turns at the same time', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    await page.keyboard.down('KeyW')
    await page.keyboard.down('KeyD')
    const state = await advance(page, 800)
    await page.keyboard.up('KeyW')
    await page.keyboard.up('KeyD')
    expect(state.player.angle).toBeGreaterThan(-Math.PI / 2 + 1.5)
    expect(state.player.x).toBeGreaterThan(810)
    expect(state.player.y).toBeLessThan(420)
  })

  test('cannot leave the visible arena', async ({ page }) => {
    await boot(page, { e2e: scenario({ player: { x: 80, y: 70, angle: -Math.PI / 2 } }) })
    await startMatch(page)
    const top = await holdKey(page, 'KeyW', 3000)
    expect(top.player.y).toBe(PLAYER_RADIUS)

    // Turn towards the left edge and keep pushing.
    await holdKey(page, 'KeyA', (Math.PI / 2 / 2.6) * 1000)
    const corner = await holdKey(page, 'KeyW', 3000)
    expect(corner.player.x).toBeCloseTo(PLAYER_RADIUS, 0)
    expect(corner.player.y).toBeGreaterThanOrEqual(PLAYER_RADIUS)
    expect(corner.player.x).toBeGreaterThanOrEqual(PLAYER_RADIUS)
  })

  test('is blocked by islands instead of sailing through them', async ({ page }) => {
    // Just north of the southern island, heading straight into it.
    await boot(page, { e2e: scenario({ player: { x: 768, y: 440, angle: Math.PI / 2 } }) })
    await startMatch(page)
    const { obstacles } = await getState(page)
    const island = obstacles.find((rect) => rect.x < 768 && rect.x + rect.w > 768 && rect.y > 440)!
    expect(island).toBeDefined()

    let state = await getState(page)
    await page.keyboard.down('KeyW')
    for (let i = 0; i < 12; i++) {
      state = await advance(page, 250)
      expect(state.player.y).toBeLessThanOrEqual(island.y - PLAYER_RADIUS + 0.001)
    }
    await page.keyboard.up('KeyW')
    expect(state.player.y).toBeCloseTo(island.y - PLAYER_RADIUS, 1)
    expect(state.player.x).toBeCloseTo(768, 1)
  })
})

test.describe('combat', () => {
  test('front cannon fires one projectile along the heading and respects its cooldown @mobile', async ({
    page,
  }) => {
    await boot(page)
    await startMatch(page)

    const first = await pressGameKey(page, 'Space')
    expect(first.projectiles).toHaveLength(1)
    expect(first.projectiles[0]).toMatchObject({ owner: 'player' })
    expect(first.projectiles[0]!.vx).toBeCloseTo(0, 5)
    expect(first.projectiles[0]!.vy).toBeCloseTo(-520, 5)
    expect(first.player.cooldowns.front).toBeCloseTo(0.45, 2)

    // Holding the trigger for one second fires on the 0.45 s cooldown, not every frame.
    await advance(page, 2000)
    const fired = new Set<number>()
    await page.keyboard.down('Space')
    for (let i = 0; i < 10; i++) {
      for (const projectile of (await advance(page, 100)).projectiles) fired.add(projectile.id)
    }
    await page.keyboard.up('Space')
    expect(fired.size).toBe(3)
  })

  test('broadsides fire three parallel projectiles to the chosen side', async ({ page }) => {
    await boot(page)
    await startMatch(page)

    const left = await pressGameKey(page, 'KeyQ')
    expect(left.projectiles).toHaveLength(3)
    for (const projectile of left.projectiles) {
      // Facing up, the port side points to -x.
      expect(projectile.vx).toBeCloseTo(-480, 5)
      expect(projectile.vy).toBeCloseTo(0, 5)
    }
    const ys = left.projectiles.map((projectile) => projectile.y).sort((a, b) => a - b)
    expect(ys[1]! - ys[0]!).toBeCloseTo(20, 5)
    expect(ys[2]! - ys[1]!).toBeCloseTo(20, 5)

    // The other side has its own cooldown and can fire right away.
    const both = await pressGameKey(page, 'KeyE')
    const right = both.projectiles.filter((projectile) => projectile.vx > 0)
    expect(right).toHaveLength(3)

    // The left battery is still reloading.
    const reloading = await pressGameKey(page, 'KeyQ')
    expect(reloading.projectiles).toHaveLength(6)
    await advance(page, 1100)
    const reloaded = await pressGameKey(page, 'KeyQ')
    expect(reloaded.projectiles.filter((projectile) => projectile.vx < 0).length).toBe(3)
  })

  test('can sail and shoot at the same time', async ({ page }) => {
    await boot(page)
    await startMatch(page)
    await page.keyboard.down('KeyW')
    await page.keyboard.down('Space')
    const state = await advance(page, 500)
    await page.keyboard.up('KeyW')
    await page.keyboard.up('Space')
    expect(state.player.y).toBeLessThan(420)
    expect(state.projectiles.length).toBeGreaterThanOrEqual(2)
  })

  test('each projectile damages once, is removed on impact and a kill scores exactly one point @mobile', async ({
    page,
  }) => {
    await boot(page, {
      e2e: scenario({ enemies: [{ kind: 'chaser', x: 800, y: 220, angle: Math.PI / 2 }] }, FROZEN_CHASER),
    })
    await startMatch(page)

    await pressGameKey(page, 'Space')
    const afterHit = await advance(page, 600)
    expect(afterHit.enemies).toHaveLength(1)
    expect(afterHit.enemies[0]!.health).toBe(20)
    expect(afterHit.projectiles).toHaveLength(0)
    expect(afterHit.score).toBe(0)
    await expect(page.getByTestId('hud-score')).toHaveText('0')

    await pressGameKey(page, 'Space')
    const afterKill = await advance(page, 600)
    expect(afterKill.enemies).toHaveLength(0)
    expect(afterKill.score).toBe(1)
    await expect(page.getByTestId('hud-score')).toHaveText('1')

    // More shots through the wreck's position change nothing.
    await holdKey(page, 'Space', 1500)
    const later = await advance(page, 1500)
    expect(later.score).toBe(1)
    await expect(page.getByTestId('announcer')).toHaveText('Enemy destroyed. Score 1.')
  })

  test('projectiles stop at islands and expire at their range', async ({ page }) => {
    // Southern island directly ahead.
    await boot(page, { e2e: scenario({ player: { x: 768, y: 440, angle: Math.PI / 2 } }) })
    await startMatch(page)
    await pressGameKey(page, 'Space')
    const blocked = await advance(page, 400)
    expect(blocked.projectiles).toHaveLength(0)

    // Open water to the west: the shot dies after its 560 px range.
    await holdKey(page, 'KeyD', (Math.PI / 2 / 2.6) * 1000)
    await advance(page, 500)
    const fired = await pressGameKey(page, 'Space')
    const startX = fired.projectiles[0]!.x
    const flying = await advance(page, 900)
    expect(flying.projectiles).toHaveLength(1)
    expect(startX - flying.projectiles[0]!.x).toBeGreaterThan(400)
    const expired = await advance(page, 300)
    expect(expired.projectiles).toHaveLength(0)
  })

  test('game keys are only captured during gameplay', async ({ page }) => {
    await boot(page, { route: '/options' })
    // In a form, Space and letters keep their normal behaviour.
    const field = page.getByRole('spinbutton', { name: 'Game session time' })
    await field.fill('')
    await field.pressSequentially('75')
    await expect(field).toHaveValue('75')
    await page.getByLabel('Sound effects').focus()
    await page.keyboard.press('Space')
    await expect(page.getByLabel('Sound effects')).not.toBeChecked()
  })
})
