import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef } from 'react'

const ICON_BASE = `${import.meta.env.BASE_URL}assets/ui@2x/controls/`

export type IconName =
  | 'close'
  | 'fire_front'
  | 'fire_left'
  | 'fire_right'
  | 'forward'
  | 'home'
  | 'minus'
  | 'pause'
  | 'play'
  | 'plus'
  | 'restart'
  | 'settings'
  | 'turn_left'
  | 'turn_right'

function iconUrl(name: IconName): string {
  return `${ICON_BASE}icon_${name}.png`
}

/** Full-screen menu backdrop with a centred wooden panel. */
export function Screen({
  children,
  wide = false,
  layout = 'column',
  labelledBy,
}: {
  children: ReactNode
  wide?: boolean
  /** "menu" lays its two child columns side by side on short landscape screens. */
  layout?: 'column' | 'menu'
  labelledBy: string
}) {
  const panelRef = useRef<HTMLElement>(null)
  // Move focus to the new screen so keyboard and screen reader users start at its heading.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div className="screen">
      <main
        ref={panelRef}
        className={`panel${wide ? ' panel--wide' : ''}${layout === 'menu' ? ' panel--menu' : ''}`}
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </main>
      <img className="screen__brand" src={`${import.meta.env.BASE_URL}assets/logo_jungle_gaming.svg`} alt="" />
    </div>
  )
}

interface MenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary'
  /** Marks toggle-like buttons such as tabs as selected. */
  selected?: boolean
}

export function MenuButton({ variant = 'primary', selected, className, ...props }: MenuButtonProps) {
  const classes = ['menu-button', `menu-button--${variant}`]
  if (selected) classes.push('is-selected')
  if (className) classes.push(className)
  return <button type="button" {...props} className={classes.join(' ')} />
}

interface RoundButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Accessible name; the icon itself is decorative. */
  label: string
}

export function RoundButton({ icon, label, className, ...props }: RoundButtonProps) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className={className ? `round-button ${className}` : 'round-button'}
    >
      <img src={iconUrl(icon)} alt="" draggable={false} />
    </button>
  )
}

export function Pagination({
  page,
  totalPages,
  onChange,
  label,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
  label: string
}) {
  return (
    <nav className="pagination" aria-label={label}>
      <RoundButton
        icon="turn_left"
        label="Previous page"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      />
      <span className="pagination__status" aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <RoundButton
        icon="turn_right"
        label="Next page"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      />
    </nav>
  )
}
