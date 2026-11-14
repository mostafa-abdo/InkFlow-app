import { useEffect, useRef, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  dividerAfter?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** Cursor-positioned context menu. Closes on outside click / Escape. */
export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp to viewport.
  const width = 230
  const height = items.length * 34 + 12
  const left = Math.min(x, window.innerWidth - width - 8)
  const top = Math.min(y, window.innerHeight - height - 8)

  return (
    <div
      ref={ref}
      className="fade-in fixed z-50 overflow-hidden rounded-lg border py-1.5 shadow-2xl"
      style={{
        left,
        top,
        width,
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-strong)',
        boxShadow: '0 14px 44px rgba(0,0,0,0.45)',
      }}
      role="menu"
    >
      {items.map((item) => (
        <div key={item.label}>
          <button
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onSelect()
              onClose()
            }}
            className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left text-[12px] transition-colors enabled:hover:bg-[var(--accent-soft)] disabled:opacity-40"
            style={{ color: item.danger ? 'var(--danger)' : 'var(--text-primary)' }}
          >
            {item.icon && <span className="flex w-4 items-center justify-center" style={{ color: 'inherit' }}>{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <kbd className="kbd">{item.shortcut}</kbd>}
          </button>
          {item.dividerAfter && <div className="my-1 h-px" style={{ background: 'var(--border)' }} />}
        </div>
      ))}
    </div>
  )
}
