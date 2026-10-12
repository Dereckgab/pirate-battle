import { type FormEvent, useId, useState } from 'react'
import { navigate } from '../../app/router'
import { OPTION_LIMITS, type OptionField, validateOption } from '../../game/config/gameConfig'
import { useOptionsStore } from '../../state/optionsStore'
import { MenuButton, RoundButton, Screen } from '../../ui/components'

interface FieldProps {
  field: OptionField
  label: string
  value: string
  error: string | null
  onChange: (value: string) => void
}

function NumberField({ field, label, value, error, onChange }: FieldProps) {
  const id = useId()
  const limits = OPTION_LIMITS[field]

  const nudge = (direction: 1 | -1) => {
    const current = Number(value)
    const base = Number.isFinite(current) ? current : limits.min
    const next = Math.min(limits.max, Math.max(limits.min, base + direction * limits.step))
    onChange(String(Number(next.toFixed(2))))
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field__control">
        <RoundButton icon="minus" label={`Decrease ${label.toLowerCase()}`} onClick={() => nudge(-1)} />
        <input
          id={id}
          name={field}
          type="number"
          inputMode="decimal"
          min={limits.min}
          max={limits.max}
          step={limits.step}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          onChange={(event) => onChange(event.target.value)}
        />
        <RoundButton icon="plus" label={`Increase ${label.toLowerCase()}`} onClick={() => nudge(1)} />
      </div>
      <p id={`${id}-hint`} className="field__hint">
        {limits.min} to {limits.max} seconds
      </p>
      {error && (
        <p id={`${id}-error`} className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function OptionsScreen() {
  const { options, soundEnabled, save } = useOptionsStore()
  const [values, setValues] = useState({
    sessionTimeSec: String(options.sessionTimeSec),
    enemySpawnTimeSec: String(options.enemySpawnTimeSec),
  })
  const [sound, setSound] = useState(soundEnabled)
  const [touched, setTouched] = useState(false)
  const [saved, setSaved] = useState(false)

  const errors = {
    sessionTimeSec: validateOption('sessionTimeSec', values.sessionTimeSec),
    enemySpawnTimeSec: validateOption('enemySpawnTimeSec', values.enemySpawnTimeSec),
  }
  const hasErrors = Boolean(errors.sessionTimeSec || errors.enemySpawnTimeSec)

  const update = (field: OptionField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setTouched(true)
    setSaved(false)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouched(true)
    if (hasErrors) return
    save(
      {
        sessionTimeSec: Number(values.sessionTimeSec),
        enemySpawnTimeSec: Number(values.enemySpawnTimeSec),
      },
      sound,
    )
    setSaved(true)
  }

  return (
    <Screen labelledBy="options-title">
      <h1 id="options-title" className="panel-title">
        Options
      </h1>
      <form className="options-form" onSubmit={handleSubmit} noValidate>
        <NumberField
          field="sessionTimeSec"
          label="Game session time"
          value={values.sessionTimeSec}
          error={touched ? errors.sessionTimeSec : null}
          onChange={update('sessionTimeSec')}
        />
        <NumberField
          field="enemySpawnTimeSec"
          label="Enemy spawn time"
          value={values.enemySpawnTimeSec}
          error={touched ? errors.enemySpawnTimeSec : null}
          onChange={update('enemySpawnTimeSec')}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={sound}
            onChange={(event) => {
              setSound(event.target.checked)
              setSaved(false)
            }}
          />
          Sound effects
        </label>

        <p className="form-status" role="status">
          {saved ? 'Options saved. They apply to the next battle.' : ''}
        </p>

        <div className="menu-actions">
          <MenuButton type="submit">Save</MenuButton>
          <MenuButton variant="secondary" onClick={() => navigate('/')}>
            Main Menu
          </MenuButton>
        </div>
      </form>
    </Screen>
  )
}
