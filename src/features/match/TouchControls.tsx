import type { PointerEvent } from 'react'
import type { GameAction, InputController } from '../../game/input/InputController'
import { type IconName, RoundButton } from '../../ui/components'

interface ControlDef {
  action: GameAction
  icon: IconName
  label: string
}

const STEERING: readonly ControlDef[] = [
  { action: 'turnLeft', icon: 'turn_left', label: 'Turn left' },
  { action: 'forward', icon: 'forward', label: 'Sail forward' },
  { action: 'turnRight', icon: 'turn_right', label: 'Turn right' },
]

const WEAPONS: readonly ControlDef[] = [
  { action: 'fireLeft', icon: 'fire_left', label: 'Fire left broadside' },
  { action: 'fireFront', icon: 'fire_front', label: 'Fire front cannon' },
  { action: 'fireRight', icon: 'fire_right', label: 'Fire right broadside' },
]

function HoldButton({
  control,
  input,
  disabled,
}: {
  control: ControlDef
  input: InputController
  disabled: boolean
}) {
  const press = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    // Capturing keeps the action held even if the finger slides off the button.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // The pointer is already gone (very short taps); the release handlers still run.
    }
    input.setAction(control.action, true)
  }
  const release = () => input.setAction(control.action, false)

  return (
    <RoundButton
      icon={control.icon}
      label={control.label}
      className={`touch-button touch-button--${control.action}`}
      data-action={control.action}
      disabled={disabled}
      // Keyboard players use the key bindings; these buttons are pointer targets.
      tabIndex={-1}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}

/**
 * On-screen controls. Every button tracks its own pointer, so steering and firing with
 * several fingers at once works.
 */
export function TouchControls({ input, disabled }: { input: InputController; disabled: boolean }) {
  return (
    <div className="touch-controls" data-testid="touch-controls">
      <div className="touch-cluster touch-cluster--steer" role="group" aria-label="Steering">
        {STEERING.map((control) => (
          <HoldButton key={control.action} control={control} input={input} disabled={disabled} />
        ))}
      </div>
      <div className="touch-cluster touch-cluster--fire" role="group" aria-label="Cannons">
        {WEAPONS.map((control) => (
          <HoldButton key={control.action} control={control} input={input} disabled={disabled} />
        ))}
      </div>
    </div>
  )
}
