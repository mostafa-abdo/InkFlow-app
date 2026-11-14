import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** Minimal, accessible modal dialog. Closes on Escape and backdrop click. */
export default function Modal({
  title,
  children,
  onClose,
  width = 420,
  footer,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  width?: number
  footer?: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(8, 8, 14, 0.55)', backdropFilter: 'blur(3px)' }}
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="fade-in flex flex-col rounded-xl border shadow-2xl"
        style={{
          width,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 96px)',
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border-strong)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-[13px] font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button
            className="rounded-md p-1.5 transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-secondary)' }}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
