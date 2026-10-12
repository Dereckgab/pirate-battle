import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { navigate } from '../../app/router'
import type { MatchSubmission } from '../../api/contracts'
import { createMatchConfig } from '../../game/config/gameConfig'
import { GameSession, type HudState } from '../../game/GameSession'
import { type GameAssets, loadGameAssets } from '../../game/render/assets'
import type { MatchResult } from '../../game/sim/types'
import { getE2EOptions } from '../../game/testing'
import { useMatchStore } from '../../state/matchStore'
import { useOptionsStore } from '../../state/optionsStore'
import { MenuButton } from '../../ui/components'
import { Hud } from './Hud'
import { PauseDialog } from './PauseDialog'
import { TouchControls } from './TouchControls'

type LoadState =
  | { status: 'loading'; progress: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; assets: GameAssets }

/** Loads the combat assets (with progress and retry) before any match can start. */
export function MatchScreen() {
  const [attempt, setAttempt] = useState(0)
  const [matchNumber, setMatchNumber] = useState(0)
  const [load, setLoad] = useState<LoadState>({ status: 'loading', progress: 0 })

  useEffect(() => {
    let cancelled = false
    let settled = false
    loadGameAssets((progress) => {
      // Files still in flight keep reporting progress after another one has failed.
      if (!cancelled && !settled) setLoad({ status: 'loading', progress })
    }).then(
      (assets) => {
        settled = true
        if (!cancelled) setLoad({ status: 'ready', assets })
      },
      () => {
        settled = true
        if (!cancelled) {
          setLoad({
            status: 'error',
            message: 'The battle assets could not be loaded. Check your connection and try again.',
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = () => {
    setLoad({ status: 'loading', progress: 0 })
    setAttempt((value) => value + 1)
  }

  return (
    <div className="match-stage">
      <div className="arena-frame">
        {load.status === 'ready' ? (
          // A new key tears the whole match down and builds a fresh one.
          <Match
            key={matchNumber}
            assets={load.assets}
            onRestart={() => setMatchNumber((value) => value + 1)}
          />
        ) : load.status === 'loading' ? (
          <div className="match-overlay" role="status" aria-live="polite">
            <p>Loading battle assets…</p>
            <progress max={1} value={load.progress} aria-label="Asset loading progress" />
            <p className="match-overlay__detail">{Math.round(load.progress * 100)}%</p>
          </div>
        ) : (
          <div className="match-overlay" role="alert">
            <p>{load.message}</p>
            <div className="menu-actions menu-actions--row">
              <MenuButton onClick={retry}>Try Again</MenuButton>
              <MenuButton variant="secondary" onClick={() => navigate('/')}>
                Main Menu
              </MenuButton>
            </div>
          </div>
        )}
      </div>
      <div className="rotate-hint" role="status">
        <p>Rotate your device to landscape to play.</p>
      </div>
    </div>
  )
}

const NO_HUD: HudState | null = null
const subscribeNothing = () => () => undefined
const getNoHud = () => NO_HUD

function Match({ assets, onRestart }: { assets: GameAssets; onRestart: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [session, setSession] = useState<GameSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let created: GameSession | null = null

    const e2e = getE2EOptions()
    // Snapshot of the options at match start: later changes only affect new matches.
    const { options, soundEnabled } = useOptionsStore.getState()
    const config = createMatchConfig(options, e2e?.configOverrides)

    const handleEnd = (result: MatchResult) => {
      const { player, completeMatch } = useMatchStore.getState()
      const match: MatchSubmission = {
        id: crypto.randomUUID(),
        playerId: player.id,
        playerName: player.name,
        playedAt: new Date().toISOString(),
        score: result.score,
        durationSec: Math.round(result.durationSec * 10) / 10,
        endReason: result.endReason,
        settings: {
          sessionTimeSec: options.sessionTimeSec,
          enemySpawnTimeSec: options.enemySpawnTimeSec,
          configVersion: config.version,
        },
      }
      completeMatch(match)
      navigate('/result')
    }

    GameSession.create({
      host,
      assets,
      config,
      scenario: e2e?.scenario ?? { seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 },
      manualClock: e2e?.manualClock ?? false,
      exposeTestApi: e2e !== null,
      soundEnabled: soundEnabled && e2e === null,
      onEnd: handleEnd,
    }).then(
      (instance) => {
        // React Strict Mode (and fast navigation) may unmount before the renderer is ready.
        if (disposed) {
          instance.destroy()
          return
        }
        created = instance
        setSession(instance)
      },
      () => {
        if (!disposed) setError('The battle could not be started on this device.')
      },
    )

    return () => {
      disposed = true
      created?.destroy()
    }
  }, [assets])

  const hud = useSyncExternalStore(
    session ? session.subscribe : subscribeNothing,
    session ? session.getHud : getNoHud,
  )

  // Portrait phones cannot fit the arena comfortably: pause until the device is rotated.
  useEffect(() => {
    if (!session) return
    const portrait = window.matchMedia('(orientation: portrait) and (max-width: 900px)')
    const pauseIfPortrait = () => {
      if (portrait.matches) session.pause('focus')
    }
    pauseIfPortrait()
    portrait.addEventListener('change', pauseIfPortrait)
    return () => portrait.removeEventListener('change', pauseIfPortrait)
  }, [session])

  const resume = useCallback(() => session?.resume(), [session])

  return (
    <>
      <div ref={hostRef} className="arena-canvas" data-testid="arena" data-ready={session ? 'true' : 'false'} />
      {error && (
        <div className="match-overlay" role="alert">
          <p>{error}</p>
          <MenuButton onClick={() => navigate('/')}>Main Menu</MenuButton>
        </div>
      )}
      {session && hud && (
        <>
          <Hud hud={hud} onPause={() => session.pause('manual')} />
          <TouchControls input={session.input} disabled={hud.phase !== 'running'} />
          {hud.phase === 'paused' && (
            <PauseDialog
              reason={hud.pauseReason}
              onResume={resume}
              onRestart={onRestart}
              onExit={() => navigate('/')}
            />
          )}
        </>
      )}
    </>
  )
}
