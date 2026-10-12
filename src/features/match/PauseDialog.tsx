import { useEffect, useRef } from 'react'
import type { PauseReason } from '../../game/GameSession'
import { MenuButton } from '../../ui/components'
import { ControlsHelp } from '../menu/MainMenu'

interface PauseDialogProps {
  reason: PauseReason | null
  onResume: () => void
  onRestart: () => void
  onExit: () => void
}

/**
 * Modal pause menu. A native <dialog> opened with showModal() traps focus, makes the rest of
 * the page inert and restores focus when closed.
 */
export function PauseDialog({ reason, onResume, onRestart, onExit }: PauseDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [])

  // P resumes, mirroring the key that pauses. Escape is handled by the dialog itself.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyP' && !event.repeat) {
        event.preventDefault()
        onResume()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onResume])

  return (
    <dialog
      ref={dialogRef}
      className="pause-dialog"
      aria-labelledby="pause-title"
      aria-describedby="pause-description"
      onCancel={(event) => {
        event.preventDefault()
        onResume()
      }}
    >
      <div className="panel panel--dialog">
        <h2 id="pause-title" className="panel-title">
          Paused
        </h2>
        <p id="pause-description" className="tagline">
          {reason === 'focus'
            ? 'The battle was paused because the game lost focus.'
            : 'The battle is on hold. Nothing moves until you resume.'}
        </p>
        <div className="menu-actions">
          <MenuButton autoFocus onClick={onResume}>
            Resume
          </MenuButton>
          <MenuButton onClick={onRestart}>Restart</MenuButton>
          <MenuButton variant="secondary" onClick={onExit}>
            Main Menu
          </MenuButton>
        </div>
        <ControlsHelp />
      </div>
    </dialog>
  )
}
