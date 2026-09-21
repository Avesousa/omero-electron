import type { ConnectionStatusState } from '../hooks/useConnectionStatus'

/** "hace 3 min" / "hace 2 h" / "hace 1 día". */
export function formatCacheAge(seconds: number): string {
  if (seconds < 60) return 'hace instantes'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`
}

interface Props {
  status: ConnectionStatusState
  /** Ventas/gastos guardados en esta caja y aún sin subir al backend. */
  pendingCount: number
  /** Ventas/gastos que el backend marcó para revisión o rechazó (los resuelve un administrador / se marcan como vistos). */
  reviewCount?: number
  /** Abre la lista de pendientes / para revisar. */
  onOpenList?: () => void
  /** Por qué el envío está detenido aunque haya conexión (sesión vencida / backend sin soporte). */
  syncBlock?: 'unauthorized' | 'unsupported' | null
}

/**
 * Aviso del header del POS en DESKTOP. Se muestra SOLO si no hay conexión con el backend o hay cosas por subir.
 * El botón "Actualizar" únicamente verifica la conexión (no sincroniza ni envía datos).
 * En modo web no se renderiza: el header conserva su botón de refresco de productos.
 */
export function ConnectionStatus({ status, pendingCount, reviewCount = 0, onOpenList, syncBlock = null }: Props) {
  if (status.runtime !== 'desktop') return null
  if (status.online && pendingCount <= 0 && reviewCount <= 0) return null

  const { cache } = status
  const cacheText = cache
    ? cache.ageSeconds !== null
      ? ` · catálogo ${formatCacheAge(cache.ageSeconds)}`
      : ' · sin datos locales'
    : ''
  const checkedAt = status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleTimeString('es-AR') : null

  return (
    <div className="flex items-center gap-3" data-testid="connection-status">
      {!status.online && (
        <span
          className="bg-red-600 text-white text-sm font-bold px-3 py-1 rounded-full"
          title={checkedAt ? `Última verificación: ${checkedAt}` : undefined}
        >
          Sin conexión con el servidor{cacheText}
        </span>
      )}
      {pendingCount > 0 && (
        <button
          type="button"
          onClick={onOpenList}
          disabled={!onOpenList}
          title="Ver lo que falta subir"
          className="bg-amber-500 text-black text-sm font-bold px-3 py-1 rounded-full disabled:cursor-default"
        >
          {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''} sin sync
        </button>
      )}
      {pendingCount > 0 && syncBlock === 'unauthorized' && (
        <span className="bg-red-600 text-white text-sm font-bold px-3 py-1 rounded-full" data-testid="sync-blocked">
          Sesión vencida: iniciá sesión para subirlas
        </span>
      )}
      {pendingCount > 0 && syncBlock === 'unsupported' && (
        <span className="bg-red-600 text-white text-sm font-bold px-3 py-1 rounded-full" data-testid="sync-blocked">
          El servidor aún no acepta la sincronización
        </span>
      )}
      {reviewCount > 0 && (
        <button
          type="button"
          onClick={onOpenList}
          disabled={!onOpenList}
          title="Ver ventas y gastos para revisar"
          className="bg-orange-600 text-white text-sm font-bold px-3 py-1 rounded-full disabled:cursor-default"
        >
          {reviewCount} para revisar
        </button>
      )}
      <button
        onClick={() => void status.check()}
        disabled={status.checking}
        title="Verificar conexión con el servidor"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ borderColor: '#FF6B00', color: '#FF6B00', background: 'transparent' }}
      >
        <span className={status.checking ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
        <span>{status.checking ? 'Verificando…' : 'Actualizar'}</span>
      </button>
    </div>
  )
}
