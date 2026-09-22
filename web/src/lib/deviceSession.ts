import { clearSession, getAuthToken, setSession } from '@/lib/sessionManager'
import type { User } from '@/shared/types/auth'

/**
 * Cliente (renderer) de la sesión de la caja del POS de escritorio (fase 4). Solo habla con el Next LOCAL
 * (`/api/_local/session*`): el secreto de la caja vive en el servidor local (y cifrado en Electron) y JAMÁS llega acá;
 * el renderer solo recibe el JWT de 1 h renovado. En web todo devuelve "sin caja" y no hace nada.
 */

export type RenewCode = 'NO_DEVICE' | 'LOGIN_REQUIRED' | 'DEVICE_EXPIRED' | 'DEVICE_REVOKED' | 'DEVICE_SECRET_INVALID' | 'UNAVAILABLE'

export type RenewResult = { ok: true; user: User } | { ok: false; code: RenewCode; message: string }

export interface DeviceInfo {
  desktop: boolean
  hasDevice: boolean
  sessionActive: boolean
}

const NO_DEVICE_INFO: DeviceInfo = { desktop: false, hasDevice: false, sessionActive: false }
const RENEW_TIMEOUT_MS = 20_000

/** Motivos por los que se vuelve al login (`?reason=`). */
export type LoginReason = 'device-revoked' | 'device-expired' | 'login-required'

const REASON_BY_CODE: Partial<Record<RenewCode, LoginReason>> = {
  DEVICE_REVOKED: 'device-revoked',
  DEVICE_EXPIRED: 'device-expired',
  LOGIN_REQUIRED: 'login-required',
}

export function reasonFor(code: RenewCode): LoginReason | null {
  return REASON_BY_CODE[code] ?? null
}

const REASON_MESSAGES: Record<LoginReason, string> = {
  'device-revoked': 'Esta caja fue revocada por un administrador. Podés subir lo pendiente, pero no operar hasta que se autorice otra.',
  'device-expired': 'La sesión de esta caja venció por inactividad. Iniciá sesión para seguir.',
  'login-required': 'Iniciá sesión para seguir.',
}

export function loginReasonMessage(reason: string | null | undefined): string | null {
  return reason && reason in REASON_MESSAGES ? REASON_MESSAGES[reason as LoginReason] : null
}

/** Estado de la caja según el servidor local. Nunca lanza (ante cualquier error: sin caja). */
export async function fetchDeviceInfo(): Promise<DeviceInfo> {
  try {
    const token = getAuthToken()
    const res = await fetch('/api/_local/session', { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const body = (await res.json()) as { success?: boolean; data?: Partial<DeviceInfo> }
    if (!body?.success || !body.data) return NO_DEVICE_INFO
    return { desktop: !!body.data.desktop, hasDevice: !!body.data.hasDevice, sessionActive: !!body.data.sessionActive }
  } catch {
    return NO_DEVICE_INFO
  }
}

/**
 * Pide un JWT nuevo con la sesión de la caja y lo deja como sesión actual. Nunca lanza; el resultado dice qué hacer:
 * UNAVAILABLE = reintentar; el resto = hay que volver al login (con el motivo).
 */
export async function renewSession(): Promise<RenewResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RENEW_TIMEOUT_MS)
  try {
    // Con el JWT vencido puede seguir en sessionStorage: se manda como PISTA del tenant (el servidor no lo acepta como credencial)
    const expired = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('omero_auth_token') : null
    const res = await fetch('/api/_local/session/refresh', {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: expired ? { Authorization: `Bearer ${expired}` } : {},
    })
    const body = (await res.json()) as { success?: boolean; data?: { accessToken: string; user: User }; error?: string; code?: RenewCode }
    if (res.ok && body?.success && body.data?.accessToken && body.data.user) {
      setSession(body.data.accessToken, body.data.user)
      return { ok: true, user: body.data.user }
    }
    return { ok: false, code: body?.code ?? 'UNAVAILABLE', message: body?.error ?? 'No se pudo renovar la sesión' }
  } catch {
    return { ok: false, code: 'UNAVAILABLE', message: 'No se pudo renovar la sesión' }
  } finally {
    clearTimeout(timer)
  }
}

/** Logout de la caja (conserva el secreto para subir lo pendiente; renovar exigirá login). Best-effort. */
export function deviceLogout(): void {
  try {
    const token = getAuthToken()
    void fetch('/api/_local/session', {
      method: 'DELETE',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {})
  } catch {
    /* best-effort */
  }
}

/** La sesión no se puede renovar: se limpia y se vuelve al login con el motivo. */
export function dropSession(): void {
  clearSession()
}
