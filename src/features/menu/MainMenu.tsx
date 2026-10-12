import { navigate } from '../../app/router'
import { useMatchRegistration } from '../../api/queries'
import { audio } from '../../game/audio/AudioManager'
import { useMatchStore } from '../../state/matchStore'
import { MenuButton, Screen } from '../../ui/components'
import { END_REASON_LABEL, formatClock } from '../../ui/format'

const CONTROLS: readonly { action: string; keys: string }[] = [
  { action: 'Sail forward', keys: 'W / ↑' },
  { action: 'Turn', keys: 'A D / ← →' },
  { action: 'Front cannon', keys: 'Space' },
  { action: 'Broadsides', keys: 'Q (left) · E (right)' },
  { action: 'Pause', keys: 'P / Esc' },
]

export function ControlsHelp() {
  return (
    <section className="controls-help" aria-labelledby="controls-title">
      <h2 id="controls-title">Controls</h2>
      <dl>
        {CONTROLS.map((control) => (
          <div key={control.action}>
            <dt>{control.action}</dt>
            <dd>{control.keys}</dd>
          </div>
        ))}
      </dl>
      <p>On touch screens use the on-screen buttons: steer on the left, fire on the right.</p>
    </section>
  )
}

function PendingNotice() {
  const pending = useMatchStore((state) => state.pending)
  const { registerAll } = useMatchRegistration()
  if (pending.length === 0) return null
  const sending = pending.some((item) => item.status === 'sending')
  return (
    <div className="notice" role="status">
      <span>
        {pending.length === 1 ? '1 match is' : `${pending.length} matches are`} waiting to be
        registered.
      </span>
      <button type="button" className="link-button" onClick={registerAll} disabled={sending}>
        {sending ? 'Sending…' : 'Retry now'}
      </button>
    </div>
  )
}

export function MainMenu() {
  const lastMatch = useMatchStore((state) => state.lastMatch)

  return (
    <Screen labelledBy="menu-title" layout="menu">
      <div className="menu-col">
      <h1 id="menu-title" className="title-logo">
        <img src={`${import.meta.env.BASE_URL}assets/ui@2x/menu/title_pirate_battle.png`} alt="Pirate Battle" />
      </h1>
      <p className="tagline">Set sail. Take command.</p>

      <nav className="menu-actions" aria-label="Main menu">
        <MenuButton
          onClick={() => {
            audio.play('click', 0.4)
            navigate('/play')
          }}
        >
          Play
        </MenuButton>
        <MenuButton onClick={() => navigate('/options')}>Options</MenuButton>
      </nav>
      </div>

      <div className="menu-col">
      <ControlsHelp />

      {lastMatch && (
        <p className="last-match">
          Last battle: <strong>{lastMatch.score}</strong> points in {formatClock(lastMatch.durationSec)} (
          {END_REASON_LABEL[lastMatch.endReason]}).{' '}
          <button type="button" className="link-button" onClick={() => navigate('/result')}>
            View result
          </button>
        </p>
      )}
      <PendingNotice />

      <nav className="menu-tabs" aria-label="Captain's log">
        <MenuButton variant="secondary" onClick={() => navigate('/log/ranking')}>
          Ranking
        </MenuButton>
        <MenuButton variant="secondary" onClick={() => navigate('/log/history')}>
          Match History
        </MenuButton>
      </nav>

      <button type="button" className="link-button menu-footer-link" onClick={() => navigate('/network')}>
        Network lab
      </button>
      </div>
    </Screen>
  )
}
