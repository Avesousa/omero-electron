/**
 * Notification.tsx
 *
 * Renders a transient notification banner in the top-right corner.
 *
 * Supported variants:
 *   - success      — green banner
 *   - error        — red banner
 *   - info         — blue banner
 *   - offline_saved — amber/yellow banner for "purchase saved offline" state
 *
 * Manual test checklist [US1-T012]:
 *   Trigger an offline failure in DevTools → notification with amber background
 *   and message "Compra guardada sin conexion..." appears in top-right corner.
 */

import type { Notification as NotificationType } from '../../types'

interface NotificationProps {
  notification: NotificationType | null
}

export const Notification = ({ notification }: NotificationProps) => {
  if (!notification) return null

  const colorClass =
    notification.type === 'error'
      ? 'bg-red-600 border-red-400 text-white'
      : notification.type === 'success'
      ? 'bg-green-600 border-green-400 text-white'
      : notification.type === 'offline_saved'
      ? 'bg-amber-500 border-amber-300 text-black'
      : 'bg-blue-600 border-blue-400 text-white'

  return (
    <div
      className={`fixed top-4 right-4 z-[100] px-6 py-3 rounded-lg border-2 font-bold text-lg animate-pulse ${colorClass}`}
    >
      {notification.message}
    </div>
  )
}
