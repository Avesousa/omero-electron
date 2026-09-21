/**
 * Identifica el tenant a partir del JWT del header `Authorization` (claim `tenantId`).
 *
 * IMPORTANTE (seguridad): NO se verifica la firma (offline no es posible). El valor se usa ÚNICAMENTE para
 * elegir el archivo de caché local; nunca para autorizar nada (el backend siempre valida el JWT). Por eso
 * se valida estrictamente como UUID: se usa como nombre de archivo y no puede permitir path traversal.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function payloadOf(authHeader: string | null | undefined): Record<string, unknown> | null {
  if (!authHeader) return null
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
  if (!match) return null

  const parts = match[1].split('.')
  if (parts.length !== 3) return null

  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const payload: unknown = JSON.parse(json)
    return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** UUID del tenant en minúsculas, o null si no hay token/claim válido. */
export function tenantFromAuthHeader(authHeader: string | null | undefined): string | null {
  const claim = payloadOf(authHeader)?.tenantId
  return typeof claim === 'string' && UUID.test(claim) ? claim.toLowerCase() : null
}

/** `exp` del JWT en segundos epoch, o null si no existe/no es numérico. */
export function tokenExpiry(authHeader: string | null | undefined): number | null {
  const exp = payloadOf(authHeader)?.exp
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null
}

/** UUID del usuario (claim `userId`, informativo: cajero que creó la venta) o null si no hay/ no es UUID. */
export function userIdFromAuthHeader(authHeader: string | null | undefined): string | null {
  const claim = payloadOf(authHeader)?.userId
  return typeof claim === 'string' && UUID.test(claim) ? claim.toLowerCase() : null
}
