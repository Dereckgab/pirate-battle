import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { type Arena, TILE_SIZE } from '../sim/arena'
import { createRng } from '../sim/rng'
import type { Simulation } from '../sim/Simulation'
import type { EnemyKind, Ship, SimEvent } from '../sim/types'
import { DECORATIONS, islandTile, WATER_TILE } from './arenaTiles'
import type { GameAssets } from './assets'
import type { ShipAtlasFrame } from './shipAtlasFrames'

type ShipSkin = 'player' | EnemyKind

/** First frame of each colour in the ship atlas; +6, +12 and +18 are its damage stages. */
const SKIN_BASE_FRAME: Record<ShipSkin, number> = { player: 5, chaser: 3, shooter: 2 }
const SKIN_SCALE: Record<ShipSkin, number> = { player: 0.72, chaser: 0.6, shooter: 0.72 }
const DAMAGE_STAGE_OFFSETS = [0, 6, 12] as const
const WRECK_OFFSET = 18
/** Ship art points down (+y) while a heading of 0 points to +x. */
const SPRITE_HEADING_OFFSET = -Math.PI / 2
const HEALTH_BAR_SCALE = 0.4
const MAX_DEVICE_PIXEL_RATIO = 2
const WAKE_INTERVAL_SEC = 0.12

function shipFrame(skin: ShipSkin, offset: number): ShipAtlasFrame {
  return `ship_${SKIN_BASE_FRAME[skin] + offset}` as ShipAtlasFrame
}

function lerpAngle(from: number, to: number, t: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  else if (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * t
}

/** Visual counterpart of a ship: hull with damage stages, fire, hit flash and a health bar. */
class ShipView {
  readonly root = new Container()
  readonly bar = new Container()
  readonly skin: ShipSkin
  seenFrame = 0
  hitFlash = 0
  wakeTimer = 0
  private readonly hull: Sprite
  private readonly flames: Sprite[]
  private readonly fill: Sprite
  private readonly assets: GameAssets
  private stage = -1

  constructor(assets: GameAssets, skin: ShipSkin) {
    this.assets = assets
    this.skin = skin
    this.hull = new Sprite(assets.ship[shipFrame(skin, 0)])
    this.hull.anchor.set(0.5)
    this.hull.scale.set(SKIN_SCALE[skin])
    this.hull.rotation = SPRITE_HEADING_OFFSET
    this.root.addChild(this.hull)

    this.flames = [assets.ship.fire_1, assets.ship.fire_2].map((texture, index) => {
      const flame = new Sprite(texture)
      flame.anchor.set(0.5, 0.9)
      flame.position.set(index === 0 ? -8 : 12, index === 0 ? 4 : -6)
      flame.visible = false
      this.root.addChild(flame)
      return flame
    })

    const frame = new Sprite(assets.healthBar.frame)
    this.fill = new Sprite(skin === 'player' ? assets.healthBar.fillGreen : assets.healthBar.fillRed)
    this.fill.position.set(assets.healthBar.fillOffset.x, assets.healthBar.fillOffset.y)
    this.bar.addChild(frame, this.fill)
    this.bar.scale.set(HEALTH_BAR_SCALE)
    this.bar.pivot.set(frame.width / 2, frame.height)
  }

  reset(): void {
    this.stage = -1
    this.hitFlash = 0
    this.wakeTimer = 0
    this.hull.tint = 0xffffff
  }

  update(ship: Ship, alpha: number, time: number, dt: number): void {
    const x = ship.prevX + (ship.x - ship.prevX) * alpha
    const y = ship.prevY + (ship.y - ship.prevY) * alpha
    this.root.position.set(x, y)
    this.root.rotation = lerpAngle(ship.prevAngle, ship.angle, alpha)
    this.bar.position.set(x, y - ship.radius - 20)

    const ratio = ship.health / ship.maxHealth
    this.fill.scale.x = Math.max(0, ratio)

    // Deterioration: the hull art degrades and fires break out as health drops.
    const stage = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2
    if (stage !== this.stage) {
      this.stage = stage
      this.hull.texture = this.assets.ship[shipFrame(this.skin, DAMAGE_STAGE_OFFSETS[stage])]
    }
    const flameCount = ratio < 0.25 ? 2 : ratio < 0.5 ? 1 : 0
    for (let i = 0; i < this.flames.length; i++) {
      const flame = this.flames[i]!
      flame.visible = i < flameCount
      if (flame.visible) {
        flame.rotation = -this.root.rotation
        flame.scale.set(0.8 + Math.sin(time * 18 + i * 2.1) * 0.15)
      }
    }

    this.hitFlash = Math.max(0, this.hitFlash - dt)
    this.hull.tint = this.hitFlash > 0 ? 0xff7a6b : 0xffffff
  }
}

interface Effect {
  sprite: Sprite
  age: number
  life: number
  vx: number
  vy: number
  spin: number
  scaleFrom: number
  scaleTo: number
  alphaFrom: number
  /** Optional texture sequence played across the effect lifetime. */
  frames: readonly Texture[] | null
}

interface EffectOptions {
  life: number
  scaleFrom: number
  scaleTo: number
  alphaFrom?: number
  vx?: number
  vy?: number
  spin?: number
  rotation?: number
  tint?: number
  frames?: readonly Texture[]
}

/**
 * Draws the simulation with PixiJS. It only reads simulation state and presentation events;
 * it never changes the rules. All display objects it creates are released in `destroy`.
 */
export class GameRenderer {
  readonly app: Application
  private readonly assets: GameAssets
  private readonly arena: Arena
  private readonly world = new Container()
  private readonly waterFx = new Container()
  private readonly shipLayer = new Container()
  private readonly projectileLayer = new Container()
  private readonly fxLayer = new Container()
  private readonly barLayer = new Container()
  private readonly trails = new Graphics()
  private readonly damageFlash = new Sprite(Texture.WHITE)

  private readonly views = new Map<number, ShipView>()
  private readonly viewPool: Record<ShipSkin, ShipView[]> = { player: [], chaser: [], shooter: [] }
  private readonly projectileSprites: Sprite[] = []
  private readonly effects: Effect[] = []
  private readonly spritePool: Sprite[] = []
  private readonly generated: Texture[] = []
  private readonly explosionFrames: readonly Texture[]
  private readonly debrisTextures: readonly Texture[]
  private readonly circle: Texture
  private readonly ring: Texture
  /** Cosmetic randomness only (debris directions); gameplay uses the simulation RNG. */
  private readonly random = createRng(7)

  private frame = 0
  private time = 0
  private shake = 0
  private playerWrecked = false
  private destroyed = false

  private constructor(app: Application, assets: GameAssets, arena: Arena) {
    this.app = app
    this.assets = assets
    this.arena = arena
    this.explosionFrames = [assets.ship.explosion_3, assets.ship.explosion_2, assets.ship.explosion_1]
    this.debrisTextures = [assets.ship.wood_1, assets.ship.wood_2, assets.ship.wood_3, assets.ship.wood_4]
    this.circle = this.generate(new Graphics().circle(0, 0, 16).fill(0xffffff))
    this.ring = this.generate(new Graphics().circle(0, 0, 30).stroke({ width: 4, color: 0xffffff }))

    const map = new Sprite(this.bakeMap())
    this.damageFlash.tint = 0xff3b30
    this.damageFlash.width = arena.width
    this.damageFlash.height = arena.height
    this.damageFlash.alpha = 0
    this.world.addChild(
      map,
      this.waterFx,
      this.trails,
      this.shipLayer,
      this.projectileLayer,
      this.fxLayer,
      this.barLayer,
      this.damageFlash,
    )
    app.stage.addChild(this.world)
  }

  static async create(host: HTMLElement, assets: GameAssets, arena: Arena): Promise<GameRenderer> {
    const app = new Application()
    await app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      resolution: Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO),
      autoDensity: true,
      antialias: false,
      background: 0x1d6fa5,
      powerPreference: 'high-performance',
      autoStart: false,
      sharedTicker: false,
    })
    app.canvas.setAttribute('aria-hidden', 'true')
    host.appendChild(app.canvas)
    const renderer = new GameRenderer(app, assets, arena)
    renderer.resize(host.clientWidth, host.clientHeight)
    return renderer
  }

  private generate(graphics: Graphics): Texture {
    const texture = this.app.renderer.generateTexture({ target: graphics, resolution: 2 })
    graphics.destroy()
    this.generated.push(texture)
    return texture
  }

  /** The arena never changes, so water, islands and props are flattened into one texture. */
  private bakeMap(): Texture {
    const { assets, arena } = this
    const map = new Container()
    const water = assets.tile(WATER_TILE)
    for (let y = 0; y < arena.height; y += TILE_SIZE) {
      for (let x = 0; x < arena.width; x += TILE_SIZE) {
        const sprite = new Sprite(water)
        sprite.position.set(x, y)
        map.addChild(sprite)
      }
    }
    for (const island of arena.islands) {
      for (let row = 0; row < island.rows; row++) {
        for (let col = 0; col < island.cols; col++) {
          const sprite = new Sprite(assets.tile(islandTile(island, col, row)))
          sprite.position.set((island.col + col) * TILE_SIZE, (island.row + row) * TILE_SIZE)
          map.addChild(sprite)
        }
      }
    }
    for (const decoration of DECORATIONS) {
      const sprite = new Sprite(assets.tile(decoration.tile))
      sprite.anchor.set(0.5)
      sprite.position.set(decoration.x, decoration.y)
      sprite.scale.set(decoration.scale ?? 1)
      sprite.rotation = decoration.rotation ?? 0
      map.addChild(sprite)
    }
    const texture = this.app.renderer.generateTexture({
      target: map,
      frame: new Rectangle(0, 0, arena.width, arena.height),
      resolution: Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO),
    })
    map.destroy({ children: true })
    this.generated.push(texture)
    return texture
  }

  /** Fits the arena to the host element, keeping its aspect ratio and the display density. */
  resize(width: number, height: number): void {
    if (this.destroyed || width <= 0 || height <= 0) return
    const resolution = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO)
    this.app.renderer.resize(width, height, resolution)
    const scale = Math.min(width / this.arena.width, height / this.arena.height)
    this.world.scale.set(scale)
    this.world.pivot.set(0, 0)
    this.world.position.set(
      (width - this.arena.width * scale) / 2,
      (height - this.arena.height * scale) / 2,
    )
  }

  // --- Effects ------------------------------------------------------------------------------

  private spawnEffect(
    layer: Container,
    texture: Texture,
    x: number,
    y: number,
    options: EffectOptions,
  ): void {
    const sprite = this.spritePool.pop() ?? new Sprite()
    sprite.texture = texture
    sprite.anchor.set(0.5)
    sprite.position.set(x, y)
    sprite.rotation = options.rotation ?? 0
    sprite.tint = options.tint ?? 0xffffff
    sprite.scale.set(options.scaleFrom)
    sprite.alpha = options.alphaFrom ?? 1
    layer.addChild(sprite)
    this.effects.push({
      sprite,
      age: 0,
      life: options.life,
      vx: options.vx ?? 0,
      vy: options.vy ?? 0,
      spin: options.spin ?? 0,
      scaleFrom: options.scaleFrom,
      scaleTo: options.scaleTo,
      alphaFrom: options.alphaFrom ?? 1,
      frames: options.frames ?? null,
    })
  }

  private updateEffects(dt: number): void {
    const effects = this.effects
    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i]!
      effect.age += dt
      const t = effect.age / effect.life
      const sprite = effect.sprite
      if (t >= 1) {
        sprite.removeFromParent()
        this.spritePool.push(sprite)
        effects[i] = effects[effects.length - 1]!
        effects.pop()
        continue
      }
      sprite.x += effect.vx * dt
      sprite.y += effect.vy * dt
      sprite.rotation += effect.spin * dt
      sprite.scale.set(effect.scaleFrom + (effect.scaleTo - effect.scaleFrom) * t)
      sprite.alpha = effect.alphaFrom * (1 - t * t)
      if (effect.frames) {
        sprite.texture = effect.frames[Math.min(effect.frames.length - 1, Math.floor(t * effect.frames.length))]!
      }
    }
  }

  private spawnDebris(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = this.random() * Math.PI * 2
      const speed = 40 + this.random() * 80
      this.spawnEffect(this.fxLayer, this.debrisTextures[i % this.debrisTextures.length]!, x, y, {
        life: 0.6 + this.random() * 0.4,
        scaleFrom: 0.9,
        scaleTo: 0.6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: (this.random() - 0.5) * 10,
        rotation: angle,
      })
    }
  }

  private spawnExplosion(x: number, y: number, scale: number): void {
    this.spawnEffect(this.fxLayer, this.explosionFrames[0]!, x, y, {
      life: 0.5,
      scaleFrom: scale * 0.7,
      scaleTo: scale * 1.3,
      frames: this.explosionFrames,
      rotation: this.random() * Math.PI * 2,
    })
    this.spawnEffect(this.waterFx, this.ring, x, y, {
      life: 0.6,
      scaleFrom: 0.3,
      scaleTo: scale * 1.6,
      alphaFrom: 0.7,
    })
  }

  /** Turns simulation events into visual feedback. */
  handleEvents(events: readonly SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'shot': {
          const dx = Math.cos(event.angle)
          const dy = Math.sin(event.angle)
          this.spawnEffect(this.fxLayer, this.explosionFrames[0]!, event.x, event.y, {
            life: 0.12,
            scaleFrom: 0.3,
            scaleTo: 0.55,
          })
          this.spawnEffect(this.fxLayer, this.circle, event.x + dx * 6, event.y + dy * 6, {
            life: 0.5,
            scaleFrom: 0.25,
            scaleTo: 0.9,
            alphaFrom: 0.45,
            vx: dx * 30,
            vy: dy * 30,
            tint: 0xdfe6ea,
          })
          break
        }
        case 'shipHit': {
          this.spawnEffect(this.fxLayer, this.explosionFrames[0]!, event.x, event.y, {
            life: 0.25,
            scaleFrom: 0.45,
            scaleTo: 0.9,
          })
          this.spawnDebris(event.x, event.y, 3)
          const view = this.views.get(event.shipId)
          if (view) view.hitFlash = 0.14
          if (event.target === 'player') this.punch(5, 0.22)
          break
        }
        case 'projectileBlocked':
          this.spawnEffect(this.fxLayer, this.circle, event.x, event.y, {
            life: 0.35,
            scaleFrom: 0.3,
            scaleTo: 1,
            alphaFrom: 0.7,
            tint: 0xe9d7a5,
          })
          break
        case 'projectileExpired':
          this.spawnEffect(this.waterFx, this.ring, event.x, event.y, {
            life: 0.45,
            scaleFrom: 0.15,
            scaleTo: 0.7,
            alphaFrom: 0.8,
          })
          break
        case 'enemyDestroyed': {
          this.spawnEffect(
            this.waterFx,
            this.assets.ship[shipFrame(event.kind, WRECK_OFFSET)],
            event.x,
            event.y,
            {
              life: 1.4,
              scaleFrom: SKIN_SCALE[event.kind],
              scaleTo: SKIN_SCALE[event.kind] * 0.8,
              rotation: event.angle + SPRITE_HEADING_OFFSET,
              spin: 0.3,
            },
          )
          this.spawnExplosion(event.x, event.y, 1.1)
          this.spawnDebris(event.x, event.y, 6)
          break
        }
        case 'playerRammed':
          this.punch(10, 0.3)
          break
        case 'matchEnded':
          // Handled in `render`, where the player transform is known.
          break
      }
    }
  }

  private punch(shake: number, flash: number): void {
    this.shake = Math.max(this.shake, shake)
    this.damageFlash.alpha = Math.max(this.damageFlash.alpha, flash)
  }

  // --- Frame --------------------------------------------------------------------------------

  private acquireView(skin: ShipSkin): ShipView {
    const view = this.viewPool[skin].pop() ?? new ShipView(this.assets, skin)
    view.reset()
    this.shipLayer.addChild(view.root)
    this.barLayer.addChild(view.bar)
    return view
  }

  private releaseView(id: number, view: ShipView): void {
    view.root.removeFromParent()
    view.bar.removeFromParent()
    this.views.delete(id)
    this.viewPool[view.skin].push(view)
  }

  private syncShip(ship: Ship, skin: ShipSkin, alpha: number, dt: number): void {
    let view = this.views.get(ship.id)
    if (!view) {
      view = this.acquireView(skin)
      this.views.set(ship.id, view)
    }
    view.seenFrame = this.frame
    view.update(ship, alpha, this.time, dt)

    if (ship.speed > 30 && dt > 0) {
      view.wakeTimer -= dt
      if (view.wakeTimer <= 0) {
        view.wakeTimer = WAKE_INTERVAL_SEC
        this.spawnEffect(
          this.waterFx,
          this.circle,
          view.root.x - Math.cos(ship.angle) * ship.radius,
          view.root.y - Math.sin(ship.angle) * ship.radius,
          { life: 0.9, scaleFrom: 0.35, scaleTo: 1.1, alphaFrom: 0.3 },
        )
      }
    }
  }

  /**
   * Draws one frame.
   * @param alpha interpolation factor between the previous and the current fixed step
   * @param dt seconds of presentation time elapsed (0 while paused, so effects freeze too)
   */
  render(sim: Simulation, alpha: number, dt: number): void {
    if (this.destroyed) return
    this.frame++
    this.time += dt

    const player = sim.player
    if (player.health > 0) {
      this.syncShip(player, 'player', alpha, dt)
    } else if (!this.playerWrecked) {
      this.playerWrecked = true
      this.spawnEffect(this.waterFx, this.assets.ship[shipFrame('player', WRECK_OFFSET)], player.x, player.y, {
        life: 2.2,
        scaleFrom: SKIN_SCALE.player,
        scaleTo: SKIN_SCALE.player * 0.8,
        rotation: player.angle + SPRITE_HEADING_OFFSET,
        spin: 0.25,
      })
      this.spawnExplosion(player.x, player.y, 1.5)
      this.spawnDebris(player.x, player.y, 8)
    }
    for (const enemy of sim.enemies) this.syncShip(enemy, enemy.kind, alpha, dt)
    for (const [id, view] of this.views) {
      if (view.seenFrame !== this.frame) this.releaseView(id, view)
    }

    // Projectiles need no identity: sprite i simply mirrors projectile i.
    const projectiles = sim.projectiles
    const trails = this.trails
    trails.clear()
    for (let i = 0; i < projectiles.length; i++) {
      const projectile = projectiles[i]!
      let sprite = this.projectileSprites[i]
      if (!sprite) {
        sprite = new Sprite(this.assets.ship.cannon_ball)
        sprite.anchor.set(0.5)
        this.projectileSprites.push(sprite)
        this.projectileLayer.addChild(sprite)
      }
      const x = projectile.prevX + (projectile.x - projectile.prevX) * alpha
      const y = projectile.prevY + (projectile.y - projectile.prevY) * alpha
      sprite.visible = true
      sprite.position.set(x, y)
      const tail = Math.min(0.09, projectile.age)
      trails.moveTo(x - projectile.vx * tail, y - projectile.vy * tail).lineTo(x, y)
    }
    if (projectiles.length > 0) trails.stroke({ width: 3, color: 0xffffff, alpha: 0.45, cap: 'round' })
    for (let i = projectiles.length; i < this.projectileSprites.length; i++) {
      this.projectileSprites[i]!.visible = false
    }

    this.updateEffects(dt)

    this.shake = Math.max(0, this.shake - dt * 40)
    this.damageFlash.alpha = Math.max(0, this.damageFlash.alpha - dt * 0.9)
    this.world.pivot.set(
      this.shake > 0 ? Math.sin(this.time * 90) * this.shake : 0,
      this.shake > 0 ? Math.cos(this.time * 70) * this.shake : 0,
    )
  }

  /** Live display object counts, exposed for profiling. */
  get stats(): { effects: number; pooledSprites: number; shipViews: number } {
    return {
      effects: this.effects.length,
      pooledSprites: this.spritePool.length,
      shipViews: this.views.size,
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.app.ticker.stop()
    for (const sprite of this.spritePool) sprite.destroy()
    for (const skin of Object.keys(this.viewPool) as ShipSkin[]) {
      for (const view of this.viewPool[skin]) {
        view.root.destroy({ children: true })
        view.bar.destroy({ children: true })
      }
      this.viewPool[skin].length = 0
    }
    this.spritePool.length = 0
    this.effects.length = 0
    this.views.clear()
    this.projectileSprites.length = 0
    // Generated textures belong to this renderer; atlas textures are shared and survive.
    for (const texture of this.generated) texture.destroy(true)
    this.generated.length = 0
    this.app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false })
  }
}
