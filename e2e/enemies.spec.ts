import type { E2EOptions, MatchSnapshot } from '../src/game/testing'
import { advance, boot, expect, getState, startMatch, test, waitForFreshMatch } from './support/fixtures'

function scenario(overrides: E2EOptions['scenario'], configOverrides?: E2EOptions['configOverrides']): E2EOptions {
  return { manualClock: true, scenario: { seed: 42, spawning: false, ...overrides }, configOverrides }
}

function distanceToPlayer(state: MatchSnapshot, index = 0): number {
  const enemy = state.enemies[index]!
  return Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y)
}

function insideObstacle(state: MatchSnapshot, x: number, y: number): boolean {
  return state.obstacles.some((rect) => x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h)
}

test.describe('chaser', () => {
  test('pursues the player, explodes on impact, deals damage and gives no points @mobile', async ({ page }) => {
    await boot(page, { e2e: scenario({ enemies: [{ kind: 'chaser', x: 800, y: 80, angle: Math.PI / 2 }] }) })
    await startMatch(page)

    const start = await getState(page)
    const closer = await advance(page, 1000)
    expect(distanceToPlayer(closer)).toBeLessThan(distanceToPlayer(start) - 60)

    const afterImpact = await advance(page, 3000)
    expect(afterImpact.enemies).toHaveLength(0)
    expect(afterImpact.player.health).toBe(82)
    expect(afterImpact.score).toBe(0)
    await expect(page.getByTestId('hud-health')).toHaveText('82')

    // A destroyed chaser never damages again.
    const later = await advance(page, 2000)
    expect(later.player.health).toBe(82)
  })

  test('turns towards the player instead of teleporting its heading', async ({ page }) => {
    // Facing away from the player.
    await boot(page, { e2e: scenario({ enemies: [{ kind: 'chaser', x: 800, y: 80, angle: -Math.PI / 2 }] }) })
    await startMatch(page)
    const step = await advance(page, 100)
    const turned = Math.abs(step.enemies[0]!.angle - -Math.PI / 2)
    expect(turned).toBeGreaterThan(0.1)
    expect(turned).toBeLessThanOrEqual(2.2 * 0.1 + 0.001)
  })

  test('sails around an island that blocks the straight path', async ({ page }) => {
    // The southern island sits between the chaser and the player.
    await boot(page, {
      e2e: scenario({
        player: { x: 768, y: 440 },
        enemies: [{ kind: 'chaser', x: 768, y: 840, angle: -Math.PI / 2 }],
      }),
    })
    await startMatch(page)

    let state = await getState(page)
    for (let i = 0; i < 80 && state.enemies.length > 0; i++) {
      state = await advance(page, 250)
      for (const enemy of state.enemies) {
        expect(insideObstacle(state, enemy.x, enemy.y), `chaser inside an island at tick ${state.tick}`).toBe(false)
      }
    }
    expect(state.enemies).toHaveLength(0)
    expect(state.player.health).toBe(82)
  })
})

test.describe('shooter', () => {
  test('approaches, holds its distance and only fires within attack range @mobile', async ({ page }) => {
    await boot(page, { e2e: scenario({ enemies: [{ kind: 'shooter', x: 1450, y: 420, angle: Math.PI }] }) })
    await startMatch(page)

    // Out of range (650 px > 400 px): it advances without shooting.
    let state = await getState(page)
    expect(distanceToPlayer(state)).toBeGreaterThan(400)
    while (distanceToPlayer(state) > 405) {
      expect(state.projectiles.filter((projectile) => projectile.owner === 'enemy')).toHaveLength(0)
      state = await advance(page, 100)
    }

    // In range: shots appear and eventually hit.
    let sawEnemyShot = false
    for (let i = 0; i < 60 && state.player.health === 100; i++) {
      state = await advance(page, 100)
      sawEnemyShot ||= state.projectiles.some((projectile) => projectile.owner === 'enemy')
    }
    expect(sawEnemyShot).toBe(true)
    expect(state.player.health).toBe(90)
    await expect(page.getByTestId('hud-health')).toHaveText('90')

    // It keeps its distance rather than ramming.
    const settled = await advance(page, 4000)
    expect(distanceToPlayer(settled)).toBeGreaterThan(250)
    expect(distanceToPlayer(settled)).toBeLessThanOrEqual(400)
    expect(settled.enemies[0]!.speed).toBe(0)
  })

  test('respects its cannon cooldown', async ({ page }) => {
    await boot(page, { e2e: scenario({ enemies: [{ kind: 'shooter', x: 1100, y: 420, angle: Math.PI }] }) })
    await startMatch(page)
    const seen = new Set<number>()
    for (let i = 0; i < 60; i++) {
      const state = await advance(page, 100)
      for (const projectile of state.projectiles) {
        if (projectile.owner === 'enemy') seen.add(projectile.id)
      }
    }
    // 6 s with a 1.8 s cooldown (first shot delayed by half a cooldown): 3 shots.
    expect(seen.size).toBe(3)
  })

  test('does not shoot through islands', async ({ page }) => {
    await boot(page, {
      e2e: scenario(
        {
          player: { x: 768, y: 440 },
          enemies: [{ kind: 'shooter', x: 768, y: 840, angle: -Math.PI / 2 }],
        },
        { shooter: { maxSpeed: 0 } },
      ),
    })
    await startMatch(page)
    const state = await advance(page, 5000)
    expect(state.projectiles).toHaveLength(0)
    expect(state.player.health).toBe(100)
  })

  test('can be destroyed and then stops firing', async ({ page }) => {
    await boot(page, {
      e2e: scenario(
        { enemies: [{ kind: 'shooter', x: 800, y: 200, angle: Math.PI / 2, health: 20 }] },
        { shooter: { maxSpeed: 0 } },
      ),
    })
    await startMatch(page)
    await page.keyboard.down('Space')
    const state = await advance(page, 500)
    await page.keyboard.up('Space')
    expect(state.enemies).toHaveLength(0)
    expect(state.score).toBe(1)

    const healthAfterKill = (await advance(page, 2000)).player.health
    const later = await advance(page, 5000)
    expect(later.player.health).toBe(healthAfterKill)
    expect(later.projectiles.filter((projectile) => projectile.owner === 'enemy')).toHaveLength(0)
  })
})

test.describe('spawning', () => {
  test('spawns on the configured interval, away from the player, with both enemy types @mobile', async ({ page }) => {
    await boot(page, { e2e: { manualClock: true, scenario: { seed: 42, spawning: true } } })
    await startMatch(page)

    const before = await advance(page, 2900)
    expect(before.spawnedCount).toBe(0)

    const first = await advance(page, 200)
    expect(first.spawnedCount).toBe(1)
    expect(first.enemies).toHaveLength(1)
    expect(first.enemies[0]!.kind).toBe('chaser')
    // Far enough that damage is never immediate, and never inside an island.
    expect(distanceToPlayer(first)).toBeGreaterThanOrEqual(400)
    expect(insideObstacle(first, first.enemies[0]!.x, first.enemies[0]!.y)).toBe(false)

    const beforeSecond = await advance(page, 2800)
    expect(beforeSecond.spawnedCount).toBe(1)
    const second = await advance(page, 200)
    expect(second.spawnedCount).toBe(2)
    expect(second.enemies.some((enemy) => enemy.kind === 'shooter')).toBe(true)

    const later = await advance(page, 9000)
    expect(later.spawnedCount).toBe(5)
  })

  test('uses the spawn interval chosen in the options', async ({ page }) => {
    await boot(page, {
      e2e: { manualClock: true, scenario: { seed: 7, spawning: true } },
      storage: { 'pirate-battle:options': { sessionTimeSec: 60, enemySpawnTimeSec: 1, soundEnabled: false } },
    })
    await startMatch(page)
    expect((await advance(page, 950)).spawnedCount).toBe(0)
    expect((await advance(page, 100)).spawnedCount).toBe(1)
    expect((await advance(page, 4000)).spawnedCount).toBe(5)
  })

  test('the same seed reproduces the same match', async ({ page }) => {
    await boot(page, { e2e: { manualClock: true, scenario: { seed: 1234, spawning: true } } })
    await startMatch(page)
    const first = await advance(page, 12_000)

    await page.keyboard.press('KeyP')
    await page.getByRole('button', { name: 'Restart' }).click()
    await waitForFreshMatch(page)
    const second = await advance(page, 12_000)

    expect(second.enemies.map(({ kind, x, y }) => ({ kind, x, y }))).toEqual(
      first.enemies.map(({ kind, x, y }) => ({ kind, x, y })),
    )
    expect(second.player.health).toBe(first.player.health)
  })
})
