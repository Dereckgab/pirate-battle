import { navigate } from '../../app/router'
import { useMatchRegistration } from '../../api/queries'
import { useMatchStore } from '../../state/matchStore'
import { MenuButton, Screen } from '../../ui/components'
import { END_REASON_LABEL, formatClock, formatSettings } from '../../ui/format'

/** Where the registration of a match currently stands, for the given match id. */
function RegistrationStatus({ matchId }: { matchId: string }) {
  const item = useMatchStore((state) => state.pending.find((entry) => entry.match.id === matchId))
  const { register } = useMatchRegistration()

  if (!item) {
    return (
      <p className="registration registration--saved" role="status" data-testid="registration-status">
        Saved to the ranking and match history.
      </p>
    )
  }
  if (item.status === 'failed') {
    return (
      <div className="registration registration--failed" role="alert" data-testid="registration-status">
        <p>Could not register this battle: {item.error ?? 'unknown error'}</p>
        <p>
          It is saved on this device.{' '}
          <button type="button" className="link-button" onClick={() => register(matchId)}>
            Retry registration
          </button>
        </p>
      </div>
    )
  }
  return (
    <p className="registration" role="status" data-testid="registration-status">
      Registering battle…
    </p>
  )
}

export function ResultScreen() {
  const match = useMatchStore((state) => state.lastMatch)

  if (!match) {
    return (
      <Screen labelledBy="result-title">
        <h1 id="result-title" className="panel-title">
          No battle yet
        </h1>
        <p className="tagline">Play a battle to see its result here.</p>
        <div className="menu-actions">
          <MenuButton onClick={() => navigate('/play')}>Play</MenuButton>
          <MenuButton variant="secondary" onClick={() => navigate('/')}>
            Main Menu
          </MenuButton>
        </div>
      </Screen>
    )
  }

  return (
    <Screen labelledBy="result-title">
      <h1 id="result-title" className="panel-title">
        {match.endReason === 'time_up' ? 'Battle complete' : 'Ship destroyed'}
      </h1>

      <p className="result-score" aria-label={`Total score: ${match.score} points`}>
        <span data-testid="result-score">{match.score}</span>
        <small>points</small>
      </p>

      <dl className="result-details">
        <div>
          <dt>Time played</dt>
          <dd data-testid="result-time">{formatClock(match.durationSec)}</dd>
        </div>
        <div>
          <dt>Ended by</dt>
          <dd data-testid="result-reason">{END_REASON_LABEL[match.endReason]}</dd>
        </div>
      </dl>
      <p className="result-settings">
        {formatSettings(match.settings.sessionTimeSec, match.settings.enemySpawnTimeSec)}
      </p>

      <RegistrationStatus matchId={match.id} />

      <div className="menu-actions">
        <MenuButton onClick={() => navigate('/play')}>Play Again</MenuButton>
        <MenuButton onClick={() => navigate('/')}>Main Menu</MenuButton>
      </div>
    </Screen>
  )
}
