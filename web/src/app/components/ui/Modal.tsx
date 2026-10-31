'use client'

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Modal compartido de Omero.
 *
 * - Desktop: diálogo centrado, header/footer fijos, body con scroll interno.
 * - Mobile (<640px): pantalla completa (comportamiento de "page").
 * - Colores 100% por tokens (globals.css) → dark/light sin código extra.
 * - `tone="dark"` fuerza el tema oscuro (POS, que es siempre oscuro).
 *
 * Estilos: sección "MODAL SYSTEM" de globals.css.
 */

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
export type ModalAccent = 'primary' | 'brand' | 'success' | 'danger' | 'warning' | 'info'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  /** Contenido de la barra inferior (usar <ModalButton/>). */
  footer?: ReactNode
  children?: ReactNode
  size?: ModalSize
  accent?: ModalAccent
  /** `dark` fuerza tema oscuro sin importar el tema del usuario. */
  tone?: 'auto' | 'dark'
  /** Cerrar al hacer click en el fondo (default: false para no perder datos). */
  closeOnOverlay?: boolean
  /** Cerrar con Escape (default: true). Desactivar si el contenedor ya maneja Esc. */
  closeOnEsc?: boolean
  /** Oculta la X del header. */
  hideClose?: boolean
  /** Body sin padding (listas/tablas que van de borde a borde). */
  flush?: boolean
  /** z-index para modales apilados sobre otros. */
  zIndex?: number
  className?: string
}

// Pila de modales abiertos: solo el de arriba responde a Esc.
const modalStack: string[] = []
let scrollLocks = 0

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  footer,
  children,
  size = 'md',
  accent = 'primary',
  tone = 'auto',
  closeOnOverlay = false,
  closeOnEsc = true,
  hideClose = false,
  flush = false,
  zIndex,
  className,
}: ModalProps) {
  const id = useId()
  const titleId = `${id}-title`
  const [mounted, setMounted] = useState(false)

  // onClose/closeOnEsc en ref: evita re-registrar (y reordenar la pila) en cada render del padre
  const live = useRef({ onClose, closeOnEsc })
  live.current = { onClose, closeOnEsc }

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!isOpen) return
    modalStack.push(id)
    if (scrollLocks++ === 0) document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && live.current.closeOnEsc && modalStack[modalStack.length - 1] === id) {
        e.stopPropagation()
        live.current.onClose()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      const i = modalStack.indexOf(id)
      if (i >= 0) modalStack.splice(i, 1)
      if (--scrollLocks === 0) document.body.style.overflow = ''
    }
  }, [isOpen, id])

  if (!isOpen || !mounted) return null

  return createPortal(
    <div
      className="o-modal-overlay"
      data-theme={tone === 'dark' ? 'dark' : undefined}
      style={zIndex ? ({ '--modal-z': zIndex } as CSSProperties) : undefined}
      onMouseDown={e => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`o-modal${className ? ` ${className}` : ''}`}
        data-size={size}
        data-accent={accent}
      >
        {(title || !hideClose) && (
          <div className="o-modal-header">
            <div className="min-w-0">
              {title && <h2 id={titleId} className="o-modal-title">{title}</h2>}
              {subtitle && <p className="o-modal-subtitle">{subtitle}</p>}
            </div>
            {!hideClose && (
              <button type="button" className="o-modal-close" onClick={onClose} aria-label="Cerrar">
                <X size={20} />
              </button>
            )}
          </div>
        )}
        <div className="o-modal-body" data-flush={flush}>{children}</div>
        {footer && <div className="o-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/* ── Piezas reutilizables dentro del modal ─────────────────────────────── */

type ButtonVariant = 'primary' | 'brand' | 'success' | 'danger' | 'secondary' | 'ghost'

export function ModalButton({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`o-btn o-btn-${variant}${className ? ` ${className}` : ''}`} {...props} />
}

export function ModalAlert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'success' | 'warning' | 'info'
  children: ReactNode
}) {
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`o-alert o-alert-${kind}`}>{children}</div>
}

/** Grilla responsive: 1 col mobile → `cols` en desktop. Hijos con `o-col-full` ocupan toda la fila. */
export function FormGrid({ cols = 2, children, className }: { cols?: 1 | 2 | 3 | 4; children: ReactNode; className?: string }) {
  return <div className={`o-form-grid${className ? ` ${className}` : ''}`} data-cols={cols}>{children}</div>
}

export function FormSection({ children }: { children: ReactNode }) {
  return <div className="o-form-section o-col-full">{children}</div>
}

/** Label + control + hint/error. `full` hace que ocupe toda la fila de la grilla. */
export function Field({
  label,
  hint,
  error,
  full,
  span2,
  action,
  children,
}: {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  full?: boolean
  span2?: boolean
  /** Elemento a la derecha del label (ej. link "+ Nueva"). */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={full ? 'o-col-full' : span2 ? 'o-col-2' : undefined}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {label && <label className="o-field-label !mb-0">{label}</label>}
          {action}
        </div>
      )}
      {children}
      {error ? <p className="o-field-error">{error}</p> : hint ? <p className="o-field-hint">{hint}</p> : null}
    </div>
  )
}
