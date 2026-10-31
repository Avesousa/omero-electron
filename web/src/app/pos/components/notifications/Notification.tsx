/**
 * Notification.tsx
 *
 * Aviso transitorio arriba a la derecha (diseño claro del POS).
 *
 * Variantes:
 *   - success       — verde
 *   - error         — rojo
 *   - info          — azul
 *   - offline_saved — ámbar ("compra guardada sin conexión")
 *
 * Manual test checklist [US1-T012]:
 *   Trigger an offline failure in DevTools → notification with amber accent
 *   and message "Compra guardada sin conexion..." appears in top-right corner.
 */

import type { Notification as NotificationType } from '../../types'

interface NotificationProps {
  notification: NotificationType | null
}

const VARIANTS = {
  success: { cls: 'is-success', icon: '✓' },
  error: { cls: 'is-error', icon: '!' },
  offline_saved: { cls: 'is-warn', icon: '⏳' },
  info: { cls: 'is-info', icon: 'i' },
} as const

export const Notification = ({ notification }: NotificationProps) => {
  if (!notification) return null
  const v = VARIANTS[notification.type as keyof typeof VARIANTS] ?? VARIANTS.info

  return (
    // key: cada aviso nuevo repite la animación de entrada
    <div key={notification.message} role="status" className={`pos-toast ${v.cls}`}>
      <span className="ic font-extrabold">{v.icon}</span>
      <span>{notification.message}</span>
    </div>
  )
}
