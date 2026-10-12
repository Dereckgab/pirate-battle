import type { InputState } from '../sim/types'

export type GameAction = keyof InputState

const KEY_BINDINGS: Readonly<Record<string, GameAction>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyA: 'turnLeft',
  ArrowLeft: 'turnLeft',
  KeyD: 'turnRight',
  ArrowRight: 'turnRight',
  Space: 'fireFront',
  KeyQ: 'fireLeft',
  KeyE: 'fireRight',
}

const PAUSE_KEYS: ReadonlySet<string> = new Set(['KeyP', 'Escape'])

function emptyState(): InputState {
  return {
    forward: false,
    turnLeft: false,
    turnRight: false,
    fireFront: false,
    fireLeft: false,
    fireRight: false,
  }
}

/**
 * Translates keyboard and touch input into the intent consumed by the simulation.
 * Keys are only captured while the controller is enabled (active, unpaused gameplay).
 */
export class InputController {
  private readonly keys = emptyState()
  private readonly touch = emptyState()
  private readonly combined = emptyState()
  private readonly onPauseRequest: () => void
  private enabled = false
  private attached = false

  constructor(onPauseRequest: () => void) {
    this.onPauseRequest = onPauseRequest
  }

  attach(): void {
    if (this.attached) return
    this.attached = true
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    this.clear()
  }

  /** Disabling drops every held action, so nothing carries over a pause. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.clear()
  }

  /** Entry point for on-screen touch controls. */
  setAction(action: GameAction, pressed: boolean): void {
    if (!this.enabled && pressed) return
    this.touch[action] = pressed
  }

  snapshot(): Readonly<InputState> {
    const { keys, touch, combined } = this
    combined.forward = keys.forward || touch.forward
    combined.turnLeft = keys.turnLeft || touch.turnLeft
    combined.turnRight = keys.turnRight || touch.turnRight
    combined.fireFront = keys.fireFront || touch.fireFront
    combined.fireLeft = keys.fireLeft || touch.fireLeft
    combined.fireRight = keys.fireRight || touch.fireRight
    return combined
  }

  private clear(): void {
    Object.assign(this.keys, emptyState())
    Object.assign(this.touch, emptyState())
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.ctrlKey || event.metaKey || event.altKey) return
    if (PAUSE_KEYS.has(event.code)) {
      event.preventDefault()
      if (!event.repeat) this.onPauseRequest()
      return
    }
    const action = KEY_BINDINGS[event.code]
    if (!action) return
    event.preventDefault()
    this.keys[action] = true
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_BINDINGS[event.code]
    if (!action) return
    if (this.enabled) event.preventDefault()
    this.keys[action] = false
  }
}
