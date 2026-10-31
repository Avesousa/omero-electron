import { getBackendUrl } from '../runtime'

/**
 * Cliente de los endpoints de sesión de caja del backend (`/api/auth/device/*`). Solo llamadas: sin reintentos ni
 * estado (los orquesta `token-provider`). Nunca lanza: todo resultado es tipado.
 *
 * Códigos: DEVICE_REVOKED · DEVICE_EXPIRED · LOGIN_REQUIRED · DEVICE_SECRET_INVALID · SYNC_WINDOW_CLOSED (del backend)
 * y UNAVAILABLE (red caída, timeout, 5xx o respuesta inválida: reintentable).
 */

export const DEVICE_TIMEOUT_MS = 15_000

export interface DeviceUser {
  id: string
  name: string | null
  email: string
  /** Nombre del rol asignado (ej. "omero-admin"), no un enum fijo — ver shared/permissions.ts. */
  role: string
  tenantId: string
  /** Permisos efectivos al momento de esta rotación — no se actualizan hasta la próxima (ver device-session.ts). */
  permissions: string[]
}

export interface RefreshOk {
  ok: true
  accessToken: string
  expiresIn: number
  deviceSecret: string
  deviceExpiresAt: string
  user: DeviceUser
}
export interface SyncTokenOk {
  ok: true
  accessToken: string
  expiresIn: number
}
export interface DeviceFailure {
  ok: false
  code: string
  status: number
  message: string
}

export interface DeviceClientDeps {
  fetchFn?: typeof fetch
  backendUrl?: () => string
  timeoutMs?: number
}

export class DeviceClient {
  private readonly deps: Required<DeviceClientDeps>

  constructor(deps: DeviceClientDeps = {}) {
    this.deps = {
      fetchFn: deps.fetchFn ?? fetch,
      backendUrl: deps.backendUrl ?? getBackendUrl,
      timeoutMs: deps.timeoutMs ?? DEVICE_TIMEOUT_MS,
    }
  }

  refresh(deviceSecret: string): Promise<RefreshOk | DeviceFailure> {
    return this.call<RefreshOk>('refresh', deviceSecret, (d) => {
      const x = d as Partial<RefreshOk>
      return typeof x.accessToken === 'string' && typeof x.deviceSecret === 'string' && !!x.user
        ? { ok: true, accessToken: x.accessToken, expiresIn: Number(x.expiresIn) || 3600, deviceSecret: x.deviceSecret,
            deviceExpiresAt: String(x.deviceExpiresAt ?? ''), user: x.user }
        : null
    })
  }

  syncToken(deviceSecret: string): Promise<SyncTokenOk | DeviceFailure> {
    return this.call<SyncTokenOk>('sync-token', deviceSecret, (d) => {
      const x = d as Partial<SyncTokenOk>
      return typeof x.accessToken === 'string' ? { ok: true, accessToken: x.accessToken, expiresIn: Number(x.expiresIn) || 3600 } : null
    })
  }

  /** Cierra la sesión del cajero en el backend (best-effort: el llamador ignora el resultado). */
  async logout(deviceSecret: string): Promise<{ ok: true } | DeviceFailure> {
    return this.call<{ ok: true }>('logout', deviceSecret, () => ({ ok: true }))
  }

  private async call<T>(path: string, deviceSecret: string, parse: (data: unknown) => T | null): Promise<T | DeviceFailure> {
    let res: Response
    try {
      res = await this.deps.fetchFn(`${this.deps.backendUrl()}/api/auth/device/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ deviceSecret }),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      })
    } catch {
      return unavailable(0, 'Sin conexión con el servidor')
    }

    const body = await readBody(res)

    if (res.status >= 500) return unavailable(res.status, body?.error ?? `Error ${res.status}`)
    if (!res.ok) {
      return { ok: false, status: res.status, code: body?.code ?? `HTTP_${res.status}`, message: body?.error ?? `Error ${res.status}` }
    }
    const parsed = body?.success ? parse(body.data) : null
    return parsed ?? unavailable(res.status, 'Respuesta inválida del servidor')
  }
}

interface Envelope {
  success?: boolean
  data?: unknown
  error?: string
  code?: string
}

async function readBody(res: Response): Promise<Envelope | null> {
  try {
    return (await res.json()) as Envelope
  } catch {
    return null // cuerpo vacío o no JSON
  }
}

function unavailable(status: number, message: string): DeviceFailure {
  return { ok: false, status, code: 'UNAVAILABLE', message }
}
