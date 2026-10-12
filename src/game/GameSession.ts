import { Ticker } from 'pixi.js'
import { audio } from './audio/AudioManager'
import type { GameConfig } from './config/gameConfig'
import { InputController } from './input/InputController'
import type { GameAssets } from './render/assets'
import { GameRenderer } from './render/GameRenderer'
import { FIXED_STEP_SEC, Simulation } from './sim/Simulation'
import type { EndReason, MatchResult, MatchScenario, SimEvent } from './sim/types'
import type { FrameStats, MatchSnapshot, MatchTestApi } from './testing'

export type PauseReason = 'manual' | 'focus'
export type MatchPhase = 'running' | 'paused' | 'ended'

/** The slice of match state the React HUD needs. It changes a few times per second at most. */
export interface HudState {
  phase: MatchPhase
  pauseReason: PauseReason | null
  endReason: EndReason | null
  score: number
  timeLeftSec: number
  health: number
  maxHealth: number
}

export interface GameSessionOptions {
  host: HTMLElement
  assets: GameAssets
  config: GameConfig
  scenario?: MatchScenario
  /** Test mode: the match only advances through the test API. */
  manualClock?: boolean
  exposeTestApi?: boolean
  soundEnabled: boolean
  onEnd: (result: MatchResult) => void
}

/** Longest frame gap converted into simulation time; longer stalls are dropped, not replayed. */
const MAX_FRAME_SEC = 0.1
const MAX_STEPS_PER_FRAME = 6
const END_SCREEN_DELAY_MS = 900
const FRAME_SAMPLE_CAPACITY = 30_000

/**
 * Owns one match: simulation, renderer, input and the frame loop that ties them together.
 * Create it with `GameSession.create` and always call `destroy` when leaving the match.
 */
export class GameSession {
  readonly input: InputController
  private readonly sim: Simulation
  private readonly renderer: GameRenderer
  private readonly options: GameSessionOptions
  private readonly listeners = new Set<() => void>()
  private readonly resizeObserver: ResizeObserver
  /** Private ticker: the session decides when the scene is updated and drawn. */
  private readonly ticker = new Ticker()
  /** Set when the canvas must be redrawn although the simulation did not advance. */
  private needsRedraw = true
  private readonly frameSamples = new Float32Array(FRAME_SAMPLE_CAPACITY)
  private frameSampleCount = 0
  private entitySum = 0
  private entityMax = 0

  private hud: HudState
  private paused = false
  private pauseReason: PauseReason | null = null
  private accumulator = 0
  private alpha = 1
  private lastFrameTime = performance.now()
  private pendingPresentationSec = 0
  private endTimer: number | undefined
  private endNotified = false
  private destroyed = false
  private testApi: MatchTestApi | null = null

  private constructor(options: GameSessionOptions, renderer: GameRenderer, sim: Simulation) {
    this.options = options
    this.renderer = renderer
    this.sim = sim
    this.input = new InputController(() => this.pause('manual'))
    this.hud = this.readHud()

    this.resizeObserver = new ResizeObserver(() => {
      renderer.resize(options.host.clientWidth, options.host.clientHeight)
      this.needsRedraw = true
    })
    this.resizeObserver.observe(options.host)

    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    window.addEventListener('blur', this.handleBlur)
    this.input.attach()
    this.input.setEnabled(true)

    this.ticker.add(this.frame)
    this.ticker.start()

    if (options.exposeTestApi) {
      this.testApi = this.createTestApi()
      window.__pb = this.testApi
    }
    if (options.soundEnabled) {
      audio.play('gameStart', 0.4)
      audio.startAmbience()
    }
  }

  static async create(options: GameSessionOptions): Promise<GameSession> {
    const sim = new Simulation(options.config, options.scenario)
    const renderer = await GameRenderer.create(options.host, options.assets, sim.arena)
    return new GameSession(options, renderer, sim)
  }

  // --- External store consumed with useSyncExternalStore --------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getHud = (): HudState => this.hud

  private readHud(): HudState {
    const { sim } = this
    return {
      phase: sim.status === 'ended' ? 'ended' : this.paused ? 'paused' : 'running',
      pauseReason: this.pauseReason,
      endReason: sim.endReason,
      score: sim.score,
      timeLeftSec: Math.ceil(sim.remainingSec - 1e-6),
      health: Math.ceil(sim.player.health),
      maxHealth: sim.player.maxHealth,
    }
  }

  /** Publishes a new HUD snapshot only when something visible actually changed. */
  private syncHud(): void {
    const next = this.readHud()
    const current = this.hud
    if (
      next.phase === current.phase &&
      next.pauseReason === current.pauseReason &&
      next.score === current.score &&
      next.timeLeftSec === current.timeLeftSec &&
      next.health === current.health
    ) {
      return
    }
    this.hud = next
    for (const listener of this.listeners) listener()
  }

  // --- Pause ----------------------------------------------------------------------------------

  pause(reason: PauseReason): void {
    if (this.destroyed || this.paused || this.sim.status !== 'running') return
    this.paused = true
    this.pauseReason = reason
    this.input.setEnabled(false)
    if (this.options.soundEnabled) audio.play('pause', 0.4)
    this.syncHud()
  }

  /** Must be triggered by a player action. Time spent paused is discarded, never replayed. */
  resume(): void {
    if (this.destroyed || !this.paused) return
    this.paused = false
    this.pauseReason = null
    this.accumulator = 0
    this.lastFrameTime = performance.now()
    this.input.setEnabled(true)
    if (this.options.soundEnabled) audio.play('resume', 0.4)
    this.syncHud()
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.pause('focus')
  }

  private readonly handleBlur = (): void => {
    this.pause('focus')
  }

  // --- Frame loop -----------------------------------------------------------------------------

  private stepOnce(): void {
    this.sim.step(this.input.snapshot())
    const events = this.sim.drainEvents()
    if (events.length > 0) {
      this.renderer.handleEvents(events)
      if (this.options.soundEnabled) this.playSounds(events)
    }
    if (this.sim.status === 'ended') this.finish()
  }

  private readonly frame = (): void => {
    if (this.destroyed) return
    const now = performance.now()
    const frameSec = Math.min((now - this.lastFrameTime) / 1000, MAX_FRAME_SEC)
    const rawFrameMs = now - this.lastFrameTime
    this.lastFrameTime = now

    let presentationSec = 0
    if (this.options.manualClock) {
      presentationSec = this.pendingPresentationSec
      this.pendingPresentationSec = 0
    } else if (this.sim.status === 'ended') {
      // Let the final explosions play out behind the result transition.
      presentationSec = frameSec
    } else if (!this.paused) {
      this.accumulator += frameSec
      let steps = 0
      while (this.accumulator >= FIXED_STEP_SEC && steps < MAX_STEPS_PER_FRAME) {
        this.accumulator -= FIXED_STEP_SEC
        steps++
        this.stepOnce()
        if (this.sim.status !== 'running' || this.paused) break
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0
      this.alpha = this.sim.status === 'running' ? this.accumulator / FIXED_STEP_SEC : 1
      presentationSec = frameSec
      this.recordFrame(rawFrameMs)
      this.syncHud()
    }

    // A frozen scene (paused, or a test clock that did not move) is not redrawn every frame.
    if (presentationSec > 0 || this.needsRedraw) {
      this.needsRedraw = false
      this.renderer.render(this.sim, this.options.manualClock ? 1 : this.alpha, presentationSec)
      this.renderer.app.render()
    }
  }

  private recordFrame(frameMs: number): void {
    if (this.frameSampleCount < FRAME_SAMPLE_CAPACITY) {
      this.frameSamples[this.frameSampleCount++] = frameMs
    }
    const entities =
      1 + this.sim.enemies.length + this.sim.projectiles.length + this.renderer.stats.effects
    this.entitySum += entities
    if (entities > this.entityMax) this.entityMax = entities
  }

  private playSounds(events: readonly SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'shot':
          if (event.owner === 'enemy') audio.play('enemyCannon', 0.25)
          else audio.play(event.weapon === 'front' ? 'cannon' : 'broadside', 0.4)
          break
        case 'shipHit':
          audio.play('woodHit', 0.45)
          break
        case 'projectileExpired':
          audio.play('splash', 0.2)
          break
        case 'enemyDestroyed':
          audio.play('explosion', 0.5)
          if (event.byPlayer) audio.play('point', 0.5)
          break
        case 'playerRammed':
          audio.play('collision', 0.6)
          break
        case 'matchEnded':
          audio.play(event.reason === 'time_up' ? 'gameComplete' : 'gameOver', 0.6)
          break
        default:
          break
      }
    }
  }

  private finish(): void {
    if (this.endNotified) return
    this.endNotified = true
    this.input.setEnabled(false)
    this.syncHud()
    const result = this.sim.result
    if (!result) return
    const notify = (): void => {
      if (!this.destroyed) this.options.onEnd(result)
    }
    if (this.options.manualClock) notify()
    else this.endTimer = window.setTimeout(notify, END_SCREEN_DELAY_MS)
  }

  // --- Test instrumentation ---------------------------------------------------------------------

  private snapshot(): MatchSnapshot {
    const { sim } = this
    const ship = (s: { id: number; x: number; y: number; angle: number; speed: number; health: number }) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      angle: s.angle,
      speed: s.speed,
      health: s.health,
    })
    return {
      status: sim.status,
      paused: this.paused,
      endReason: sim.endReason,
      tick: sim.tick,
      elapsedSec: sim.elapsedSec,
      remainingSec: sim.remainingSec,
      score: sim.score,
      spawnedCount: sim.spawnedCount,
      player: { ...ship(sim.player), cooldowns: { ...sim.player.cooldowns } },
      enemies: sim.enemies.map((enemy) => ({ ...ship(enemy), kind: enemy.kind })),
      projectiles: sim.projectiles.map(({ id, owner, x, y, vx, vy }) => ({ id, owner, x, y, vx, vy })),
      obstacles: sim.arena.obstacles.map((rect) => ({ ...rect })),
      arena: { width: sim.arena.width, height: sim.arena.height },
    }
  }

  private frameStats(): FrameStats {
    const count = this.frameSampleCount
    if (count === 0) {
      return { frames: 0, averageFps: 0, p95FrameMs: 0, maxFrameMs: 0, maxEntities: 0, averageEntities: 0 }
    }
    const sorted = this.frameSamples.slice(0, count).sort()
    let total = 0
    for (let i = 0; i < count; i++) total += sorted[i]!
    return {
      frames: count,
      averageFps: 1000 / (total / count),
      p95FrameMs: sorted[Math.min(count - 1, Math.floor(count * 0.95))]!,
      maxFrameMs: sorted[count - 1]!,
      maxEntities: this.entityMax,
      averageEntities: this.entitySum / count,
    }
  }

  private createTestApi(): MatchTestApi {
    return {
      getState: () => this.snapshot(),
      advance: (ms) => {
        const steps = Math.round(ms / 1000 / FIXED_STEP_SEC)
        for (let i = 0; i < steps; i++) {
          if (this.destroyed || this.paused || this.sim.status !== 'running') break
          this.stepOnce()
          this.pendingPresentationSec += FIXED_STEP_SEC
        }
        this.syncHud()
        return this.snapshot()
      },
      getFrameStats: () => this.frameStats(),
      resetFrameStats: () => {
        this.frameSampleCount = 0
        this.entitySum = 0
        this.entityMax = 0
      },
    }
  }

  // --- Teardown -------------------------------------------------------------------------------

  /** Releases every listener, timer, ticker callback and GPU resource owned by the match. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    window.clearTimeout(this.endTimer)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    window.removeEventListener('blur', this.handleBlur)
    this.input.detach()
    this.ticker.destroy()
    this.renderer.destroy()
    this.listeners.clear()
    audio.stopAmbience()
    if (this.testApi && window.__pb === this.testApi) delete window.__pb
  }
}
