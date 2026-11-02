import { getDeviceSession, ENDED_MESSAGES, type EndedCode } from './device-session'

/**
 * Fin de sesión de la caja detectado en una request NORMAL (no en el refresh): el backend verifica la caja en cada request
 * con JWT `scope=pos` y responde `403` con `DEVICE_REVOKED` / `DEVICE_EXPIRED` / `LOGIN_REQUIRED` aunque el JWT siga vigente.
 * Se trata igual que un error definitivo del refresh (NO es un 401 recuperable: no dispara la renovación obligatoria).
 */

export const ENDED_CODES: readonly EndedCode[] = ['DEVICE_REVOKED', 'DEVICE_EXPIRED', 'LOGIN_REQUIRED']

export function isEndedCode(code: unknown): code is EndedCode {
  return typeof code === 'string' && (ENDED_CODES as readonly string[]).includes(code)
}

/** Código de fin de sesión si la respuesta es un 403 de este tipo (no consume el body: lee un clon). */
export async function endedCodeOf(res: Response): Promise<EndedCode | null> {
  if (res.status !== 403) return null
  try {
    const code = ((await res.clone().json()) as { code?: unknown } | null)?.code
    return isEndedCode(code) ? code : null
  } catch {
    return null
  }
}

/**
 * Si la respuesta es un 403 de fin de sesión, marca la sesión como terminada YA (conserva el secreto para el sync-token).
 * Devuelve el código, o null si no era. Nunca lanza.
 */
export async function reportEndedResponse(tenantId: string | null, res: Response): Promise<EndedCode | null> {
  try {
    const code = await endedCodeOf(res)
    if (code && tenantId) getDeviceSession().reportEnded(tenantId, code)
    return code
  } catch {
    return null
  }
}

/** Respuesta local (sin ir al backend) para una caja cuya sesión ya terminó. */
export function endedResponse(code: EndedCode): Response {
  return new Response(JSON.stringify({ success: false, error: ENDED_MESSAGES[code], code }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
