import { getSyncer } from '../catalog/syncer'
import { wireDevice } from '../device/device-wiring'
import { getSender } from './outbox-sender'

/**
 * Registra el `Authorization` de una request autenticada para el tenant, asegurando ANTES que el sender del outbox
 * existe y escucha al syncer. El orden importa: `remember` publica un evento "token nuevo" y, tras un reinicio con
 * ventas pendientes, ese evento es lo que pone a subirlas (aunque el cajero todavía no haya hecho ninguna venta).
 * El token queda solo en memoria. Nunca lanza.
 */
export function rememberSession(tenantId: string, authorization: string): void {
  try {
    wireDevice() // la caja renueva el JWT sola (syncer y sender)
    getSender()
  } catch (err) {
    console.warn(`[outbox] no se pudo iniciar el envío: ${(err as Error).message}`)
  }
  getSyncer().remember(tenantId, authorization)
}
