import { useState } from 'react'
import type { HudState } from '../../game/GameSession'
import { RoundButton } from '../../ui/components'
import { formatClock } from '../../ui/format'

const HUD_ASSETS = `${import.meta.env.BASE_URL}assets/ui@2x/hud/`
/** Geometry of the fill inside `health_frame.png`, from the UI atlas metadata (1x units). */
const HEALTH_FRAME_WIDTH = 256
const HEALTH_FILL = { x: 30, width: 196 }

function healthColor(ratio: number): 'green' | 'amber' | 'red' {
  return ratio > 0.5 ? 'green' : ratio > 0.25 ? 'amber' : 'red'
}

/**
 * Builds the sparse screen reader announcements of the match. Only meaningful changes are
 * announced (score, low health, time milestones, state changes), never per-frame updates.
 */
function describeChange(last: HudState, hud: HudState): string | null {
  if (hud.phase !== last.phase) {
    if (hud.phase === 'paused') return 'Game paused.'
    if (hud.phase === 'running') return 'Game resumed.'
    return hud.endReason === 'time_up' ? 'Time is up. Battle complete.' : 'Your ship was destroyed.'
  }
  if (hud.score !== last.score) return `Enemy destroyed. Score ${hud.score}.`
  const lowHealth = hud.maxHealth * 0.25
  if (hud.health <= lowHealth && last.health > lowHealth) {
    return `Warning: hull at ${hud.health} of ${hud.maxHealth}.`
  }
  if (hud.timeLeftSec !== last.timeLeftSec && (hud.timeLeftSec === 30 || hud.timeLeftSec === 10)) {
    return `${hud.timeLeftSec} seconds left.`
  }
  return null
}

function useAnnouncement(hud: HudState): string {
  const [state, setState] = useState({ hud, message: 'Battle started.' })
  // Derived during render from the previous snapshot; no effect needed.
  if (state.hud !== hud) {
    setState({ hud, message: describeChange(state.hud, hud) ?? state.message })
  }
  return state.message
}

export function Hud({ hud, onPause }: { hud: HudState; onPause: () => void }) {
  const announcement = useAnnouncement(hud)
  const ratio = Math.max(0, hud.health / hud.maxHealth)
  const clipRight = ((HEALTH_FRAME_WIDTH - (HEALTH_FILL.x + HEALTH_FILL.width * ratio)) / HEALTH_FRAME_WIDTH) * 100

  return (
    <div className="hud" data-testid="hud" data-phase={hud.phase}>
      <div className="hud__health">
        <img className="hud__heart" src={`${HUD_ASSETS}icon_heart.png`} alt="" />
        <div className="hud__bar">
          <img src={`${HUD_ASSETS}health_frame.png`} alt="" />
          <img
            src={`${HUD_ASSETS}health_fill_${healthColor(ratio)}.png`}
            alt=""
            style={{ clipPath: `inset(0 ${clipRight}% 0 0)` }}
          />
          <span className="hud__bar-label">
            <span className="visually-hidden">Hull: </span>
            <span data-testid="hud-health">{hud.health}</span> / {hud.maxHealth}
          </span>
        </div>
      </div>

      <div className="hud__counters">
        <div className="hud__counter">
          <img src={`${HUD_ASSETS}icon_score.png`} alt="" />
          <span className="visually-hidden">Score: </span>
          <span data-testid="hud-score">{hud.score}</span>
        </div>
        <div className="hud__counter" role="timer" aria-live="off">
          <img src={`${HUD_ASSETS}icon_time.png`} alt="" />
          <span className="visually-hidden">Time left: </span>
          <span data-testid="hud-time">{formatClock(hud.timeLeftSec)}</span>
        </div>
        <RoundButton
          icon="pause"
          label="Pause"
          className="hud__pause"
          onClick={onPause}
          disabled={hud.phase !== 'running'}
        />
      </div>

      <p className="visually-hidden" role="status" aria-live="polite" data-testid="announcer">
        {announcement}
      </p>
    </div>
  )
}
