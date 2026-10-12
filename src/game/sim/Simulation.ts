import type { GameConfig, ShipStats, WeaponConfig } from '../config/gameConfig'
import {
  type Arena,
  circleHitsObstacle,
  clamp,
  createArena,
  isPathClear,
  resolveCircleRect,
} from './arena'
import { NavGrid } from './navGrid'
import { createRng, type Rng } from './rng'
import type {
  EndReason,
  Enemy,
  EnemyKind,
  InputState,
  MatchResult,
  MatchScenario,
  Player,
  Projectile,
  ProjectileOwner,
  Ship,
  SimEvent,
  WeaponSlot,
} from './types'

/** Fixed simulation step. Rules always advance in increments of this size. */
export const FIXED_STEP_SEC = 1 / 60

const TWO_PI = Math.PI * 2
const SPAWN_EDGE_INSET = 44
const SPAWN_ATTEMPTS = 40

function normalizeAngle(angle: number): number {
  let result = angle % TWO_PI
  if (result > Math.PI) result -= TWO_PI
  else if (result < -Math.PI) result += TWO_PI
  return result
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta)
  return Math.max(target, current - maxDelta)
}

/**
 * Authoritative game rules: movement, combat, collisions, enemy behaviour, spawning and
 * match flow. It has no dependency on rendering, input devices, React or wall-clock time.
 */
export class Simulation {
  readonly config: GameConfig
  readonly arena: Arena
  readonly player: Player
  readonly enemies: Enemy[] = []
  readonly projectiles: Projectile[] = []
  /** Presentation events produced since the last `drainEvents` call. */
  private events: SimEvent[] = []

  status: 'running' | 'ended' = 'running'
  endReason: EndReason | null = null
  score = 0
  /** Number of fixed steps executed; elapsed time derives from it to avoid float drift. */
  tick = 0
  spawnedCount = 0

  private readonly rng: Rng
  private readonly nav: NavGrid
  private readonly spawningEnabled: boolean
  private spawnTimer: number
  private nextId = 1
  private readonly waypoint = { x: 0, y: 0 }

  constructor(config: GameConfig, scenario: MatchScenario = {}) {
    this.config = config
    this.arena = createArena(config.arena.width, config.arena.height)
    this.rng = createRng(scenario.seed ?? 1)
    this.nav = new NavGrid(this.arena, Math.max(config.chaser.radius, config.shooter.radius) + 4)
    this.spawningEnabled = scenario.spawning ?? true
    this.spawnTimer = config.spawn.intervalSec

    const start = this.arena.playerStart
    this.player = {
      ...this.createShip(
        config.player,
        scenario.player?.x ?? start.x,
        scenario.player?.y ?? start.y,
        scenario.player?.angle ?? start.angle,
      ),
      cooldowns: { front: 0, left: 0, right: 0 },
    }
    if (scenario.player?.health !== undefined) this.player.health = scenario.player.health

    for (const enemy of scenario.enemies ?? []) {
      const created = this.addEnemy(enemy.kind, enemy.x, enemy.y, enemy.angle ?? 0)
      if (enemy.health !== undefined) created.health = enemy.health
    }
    this.events.length = 0
  }

  get elapsedSec(): number {
    return Math.min(this.tick * FIXED_STEP_SEC, this.config.match.durationSec)
  }

  get remainingSec(): number {
    return Math.max(0, this.config.match.durationSec - this.elapsedSec)
  }

  get result(): MatchResult | null {
    if (this.status !== 'ended' || !this.endReason) return null
    return { score: this.score, durationSec: this.elapsedSec, endReason: this.endReason }
  }

  drainEvents(): SimEvent[] {
    const drained = this.events
    this.events = []
    return drained
  }

  /** Advances the match by exactly one fixed step. Does nothing once the match has ended. */
  step(input: Readonly<InputState>): void {
    if (this.status === 'ended') return
    const dt = FIXED_STEP_SEC
    this.tick++

    this.updatePlayer(input, dt)
    this.nav.setTarget(this.player.x, this.player.y)
    this.updateEnemies(dt)
    this.separateShips()
    this.updateProjectiles(dt)
    this.updateSpawner(dt)

    if (this.player.health <= 0) this.end('player_destroyed')
    else if (this.tick * dt >= this.config.match.durationSec - 1e-9) this.end('time_up')
  }

  // --- Player -----------------------------------------------------------------------------

  private updatePlayer(input: Readonly<InputState>, dt: number): void {
    const player = this.player
    const stats = this.config.player
    this.rememberTransform(player)

    const turn = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0)
    player.angle = normalizeAngle(player.angle + turn * stats.turnRate * dt)
    player.speed = input.forward
      ? approach(player.speed, stats.maxSpeed, stats.acceleration * dt)
      : approach(player.speed, 0, stats.drag * dt)
    this.moveShip(player, dt)

    const cooldowns = player.cooldowns
    cooldowns.front = Math.max(0, cooldowns.front - dt)
    cooldowns.left = Math.max(0, cooldowns.left - dt)
    cooldowns.right = Math.max(0, cooldowns.right - dt)

    if (input.fireFront && cooldowns.front <= 0) {
      cooldowns.front = stats.frontCannon.cooldownSec
      const muzzle = player.radius + 6
      this.fire(
        'player',
        'front',
        stats.frontCannon,
        player.x + Math.cos(player.angle) * muzzle,
        player.y + Math.sin(player.angle) * muzzle,
        player.angle,
      )
    }
    if (input.fireLeft && cooldowns.left <= 0) {
      cooldowns.left = stats.broadside.cooldownSec
      this.fireBroadside('left')
    }
    if (input.fireRight && cooldowns.right <= 0) {
      cooldowns.right = stats.broadside.cooldownSec
      this.fireBroadside('right')
    }
  }

  private fireBroadside(side: 'left' | 'right'): void {
    const player = this.player
    const weapon = this.config.player.broadside
    // Screen space has +y pointing down, so "left of the heading" is angle - 90 degrees.
    const fireAngle = player.angle + (side === 'left' ? -Math.PI / 2 : Math.PI / 2)
    const alongX = Math.cos(player.angle)
    const alongY = Math.sin(player.angle)
    const outX = Math.cos(fireAngle)
    const outY = Math.sin(fireAngle)
    const middle = (weapon.projectileCount - 1) / 2
    for (let i = 0; i < weapon.projectileCount; i++) {
      const offset = (i - middle) * weapon.spacingPx
      this.fire(
        'player',
        side,
        weapon,
        player.x + alongX * offset + outX * (player.radius * 0.6),
        player.y + alongY * offset + outY * (player.radius * 0.6),
        fireAngle,
      )
    }
  }

  // --- Enemies ----------------------------------------------------------------------------

  private updateEnemies(dt: number): void {
    const player = this.player
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]!
      const stats = enemy.kind === 'chaser' ? this.config.chaser : this.config.shooter
      this.rememberTransform(enemy)

      const toPlayerX = player.x - enemy.x
      const toPlayerY = player.y - enemy.y
      const distance = Math.hypot(toPlayerX, toPlayerY)
      const hasLineOfSight = isPathClear(
        this.arena,
        enemy.x,
        enemy.y,
        player.x,
        player.y,
        enemy.radius * 0.7,
      )

      let desiredAngle = Math.atan2(toPlayerY, toPlayerX)
      if (!hasLineOfSight && this.nav.nextWaypoint(enemy.x, enemy.y, this.waypoint)) {
        desiredAngle = Math.atan2(this.waypoint.y - enemy.y, this.waypoint.x - enemy.x)
      }
      const aimError = normalizeAngle(desiredAngle - enemy.angle)
      enemy.angle = normalizeAngle(
        enemy.angle + clamp(aimError, -stats.turnRate * dt, stats.turnRate * dt),
      )

      // Slow down while turning sharply so ships do not orbit their target.
      let targetSpeed = stats.maxSpeed * clamp(Math.cos(aimError), 0.25, 1)
      if (enemy.kind === 'shooter') {
        const shooter = this.config.shooter
        if (hasLineOfSight && distance <= shooter.holdDistancePx) targetSpeed = 0
        enemy.cooldown = Math.max(0, enemy.cooldown - dt)
        const canFire =
          hasLineOfSight &&
          distance <= shooter.attackRangePx &&
          Math.abs(aimError) <= shooter.aimToleranceRad &&
          enemy.cooldown <= 0
        if (canFire) {
          enemy.cooldown = shooter.cannon.cooldownSec
          const muzzle = enemy.radius + 6
          this.fire(
            'enemy',
            'front',
            shooter.cannon,
            enemy.x + Math.cos(enemy.angle) * muzzle,
            enemy.y + Math.sin(enemy.angle) * muzzle,
            enemy.angle,
          )
        }
      }
      enemy.speed = approach(
        enemy.speed,
        targetSpeed,
        (targetSpeed > enemy.speed ? stats.acceleration : stats.drag) * dt,
      )
      this.moveShip(enemy, dt)

      if (enemy.kind === 'chaser') {
        const reach = enemy.radius + player.radius
        const dx = player.x - enemy.x
        const dy = player.y - enemy.y
        if (dx * dx + dy * dy <= reach * reach) {
          player.health = Math.max(0, player.health - this.config.chaser.ramDamage)
          this.events.push({ type: 'playerRammed', x: enemy.x, y: enemy.y })
          this.destroyEnemy(i, false)
        }
      }
    }
  }

  /** Keeps ships from stacking on top of each other. */
  private separateShips(): void {
    const enemies = this.enemies
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i]!
      for (let j = i + 1; j < enemies.length; j++) {
        this.pushApart(a, enemies[j]!, 0.5)
      }
      // Shooters never ram: the player shoves them aside instead.
      if (a.kind === 'shooter') this.pushApart(a, this.player, 0.8)
    }
    this.constrainToArena(this.player)
  }

  private pushApart(a: Ship, b: Ship, shareOfA: number): void {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const minDistance = a.radius + b.radius
    const distanceSq = dx * dx + dy * dy
    if (distanceSq >= minDistance * minDistance) return
    const distance = Math.sqrt(distanceSq) || 0.001
    const overlap = minDistance - distance
    const nx = dx / distance
    const ny = dy / distance
    a.x -= nx * overlap * shareOfA
    a.y -= ny * overlap * shareOfA
    b.x += nx * overlap * (1 - shareOfA)
    b.y += ny * overlap * (1 - shareOfA)
    this.constrainToArena(a)
  }

  // --- Shared ship helpers ------------------------------------------------------------------

  private createShip(stats: ShipStats, x: number, y: number, angle: number): Ship {
    return {
      id: this.nextId++,
      x,
      y,
      angle,
      speed: 0,
      health: stats.maxHealth,
      maxHealth: stats.maxHealth,
      radius: stats.radius,
      prevX: x,
      prevY: y,
      prevAngle: angle,
    }
  }

  private rememberTransform(ship: Ship): void {
    ship.prevX = ship.x
    ship.prevY = ship.y
    ship.prevAngle = ship.angle
  }

  private moveShip(ship: Ship, dt: number): void {
    ship.x += Math.cos(ship.angle) * ship.speed * dt
    ship.y += Math.sin(ship.angle) * ship.speed * dt
    if (this.constrainToArena(ship)) {
      // Scraping an island or the arena edge bleeds speed instead of sliding at full pace.
      ship.speed *= 0.96
    }
  }

  /** Keeps a ship inside the visible arena and outside islands. */
  private constrainToArena(ship: Ship): boolean {
    let collided = false
    for (const rect of this.arena.obstacles) {
      if (resolveCircleRect(ship, ship.radius, rect)) collided = true
    }
    const { width, height } = this.arena
    const x = clamp(ship.x, ship.radius, width - ship.radius)
    const y = clamp(ship.y, ship.radius, height - ship.radius)
    if (x !== ship.x || y !== ship.y) {
      ship.x = x
      ship.y = y
      collided = true
    }
    return collided
  }

  // --- Projectiles --------------------------------------------------------------------------

  private fire(
    owner: ProjectileOwner,
    weapon: WeaponSlot,
    config: WeaponConfig,
    x: number,
    y: number,
    angle: number,
  ): void {
    this.projectiles.push({
      id: this.nextId++,
      owner,
      x,
      y,
      prevX: x,
      prevY: y,
      vx: Math.cos(angle) * config.projectileSpeed,
      vy: Math.sin(angle) * config.projectileSpeed,
      damage: config.damage,
      travelled: 0,
      maxRange: config.rangePx,
      age: 0,
      lifetime: config.lifetimeSec,
    })
    this.events.push({ type: 'shot', owner, weapon, x, y, angle })
  }

  private updateProjectiles(dt: number): void {
    const { width, height } = this.arena
    const radius = this.config.projectile.radius
    const projectiles = this.projectiles

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i]!
      projectile.prevX = projectile.x
      projectile.prevY = projectile.y
      const stepX = projectile.vx * dt
      const stepY = projectile.vy * dt
      projectile.x += stepX
      projectile.y += stepY
      projectile.travelled += Math.hypot(stepX, stepY)
      projectile.age += dt

      // A projectile is removed the moment it resolves, so it can never apply damage twice.
      let remove = false
      if (
        projectile.x < 0 ||
        projectile.y < 0 ||
        projectile.x > width ||
        projectile.y > height
      ) {
        remove = true
      } else if (circleHitsObstacle(this.arena, projectile.x, projectile.y, radius)) {
        this.events.push({ type: 'projectileBlocked', x: projectile.x, y: projectile.y })
        remove = true
      } else if (projectile.owner === 'player') {
        const hitIndex = this.findEnemyHit(projectile, radius)
        if (hitIndex >= 0) {
          this.damageEnemy(hitIndex, projectile)
          remove = true
        }
      } else if (this.overlaps(projectile, this.player, radius)) {
        this.player.health = Math.max(0, this.player.health - projectile.damage)
        this.events.push({
          type: 'shipHit',
          target: 'player',
          x: projectile.x,
          y: projectile.y,
          shipId: this.player.id,
        })
        remove = true
      }

      if (
        !remove &&
        (projectile.travelled >= projectile.maxRange || projectile.age >= projectile.lifetime)
      ) {
        this.events.push({ type: 'projectileExpired', x: projectile.x, y: projectile.y })
        remove = true
      }

      if (remove) {
        projectiles[i] = projectiles[projectiles.length - 1]!
        projectiles.pop()
      }
    }
  }

  private overlaps(projectile: Projectile, ship: Ship, projectileRadius: number): boolean {
    const dx = projectile.x - ship.x
    const dy = projectile.y - ship.y
    const reach = ship.radius + projectileRadius
    return dx * dx + dy * dy <= reach * reach
  }

  private findEnemyHit(projectile: Projectile, projectileRadius: number): number {
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.overlaps(projectile, this.enemies[i]!, projectileRadius)) return i
    }
    return -1
  }

  private damageEnemy(index: number, projectile: Projectile): void {
    const enemy = this.enemies[index]!
    enemy.health = Math.max(0, enemy.health - projectile.damage)
    this.events.push({
      type: 'shipHit',
      target: 'enemy',
      x: projectile.x,
      y: projectile.y,
      shipId: enemy.id,
    })
    if (enemy.health <= 0) {
      this.score += 1
      this.destroyEnemy(index, true)
    }
  }

  /** Removing the enemy from the list takes it out of AI, combat and collisions at once. */
  private destroyEnemy(index: number, byPlayer: boolean): void {
    const enemy = this.enemies[index]!
    this.enemies.splice(index, 1)
    this.events.push({
      type: 'enemyDestroyed',
      kind: enemy.kind,
      shipId: enemy.id,
      x: enemy.x,
      y: enemy.y,
      angle: enemy.angle,
      byPlayer,
    })
  }

  // --- Spawning ---------------------------------------------------------------------------

  private updateSpawner(dt: number): void {
    if (!this.spawningEnabled) return
    this.spawnTimer -= dt
    while (this.spawnTimer <= 1e-9) {
      this.spawnTimer += this.config.spawn.intervalSec
      this.spawnEnemy()
    }
  }

  private pickEnemyKind(): EnemyKind {
    // The first two spawns guarantee both enemy types show up in every match.
    if (this.spawnedCount === 0) return 'chaser'
    if (this.spawnedCount === 1) return 'shooter'
    const { chaser, shooter } = this.config.spawn.weights
    return this.rng() * (chaser + shooter) < chaser ? 'chaser' : 'shooter'
  }

  private spawnEnemy(): void {
    if (this.enemies.length >= this.config.spawn.maxAliveEnemies) return
    const kind = this.pickEnemyKind()
    const stats = kind === 'chaser' ? this.config.chaser : this.config.shooter
    const point = this.findSpawnPoint(stats.radius)
    if (!point) return
    const angle = Math.atan2(this.player.y - point.y, this.player.x - point.x)
    this.addEnemy(kind, point.x, point.y, angle)
    this.spawnedCount++
  }

  private isValidSpawn(x: number, y: number, radius: number, minPlayerDistance: number): boolean {
    if (circleHitsObstacle(this.arena, x, y, radius + 8)) return false
    if (!this.nav.isReachable(x, y)) return false
    const dx = x - this.player.x
    const dy = y - this.player.y
    if (dx * dx + dy * dy < minPlayerDistance * minPlayerDistance) return false
    for (const enemy of this.enemies) {
      const ex = x - enemy.x
      const ey = y - enemy.y
      const gap = radius + enemy.radius
      if (ex * ex + ey * ey < gap * gap) return false
    }
    return true
  }

  /** Picks a free point on the arena border, away from the player. */
  private findSpawnPoint(radius: number): { x: number; y: number } | null {
    const { width, height } = this.arena
    const minDistance = this.config.spawn.minDistanceFromPlayerPx
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const edge = Math.floor(this.rng() * 4)
      const t = this.rng()
      const x =
        edge === 0
          ? SPAWN_EDGE_INSET
          : edge === 1
            ? width - SPAWN_EDGE_INSET
            : SPAWN_EDGE_INSET + t * (width - SPAWN_EDGE_INSET * 2)
      const y =
        edge === 2
          ? SPAWN_EDGE_INSET
          : edge === 3
            ? height - SPAWN_EDGE_INSET
            : SPAWN_EDGE_INSET + t * (height - SPAWN_EDGE_INSET * 2)
      if (this.isValidSpawn(x, y, radius, minDistance)) return { x, y }
    }
    return null
  }

  private addEnemy(kind: EnemyKind, x: number, y: number, angle: number): Enemy {
    const stats = kind === 'chaser' ? this.config.chaser : this.config.shooter
    const enemy: Enemy = {
      ...this.createShip(stats, x, y, angle),
      kind,
      // Shooters need a moment to line up before their first shot.
      cooldown: kind === 'shooter' ? this.config.shooter.cannon.cooldownSec * 0.5 : 0,
    }
    this.enemies.push(enemy)
    this.events.push({ type: 'enemySpawned', kind, shipId: enemy.id })
    return enemy
  }

  // --- Match flow ---------------------------------------------------------------------------

  private end(reason: EndReason): void {
    this.status = 'ended'
    this.endReason = reason
    this.events.push({ type: 'matchEnded', reason })
  }
}
