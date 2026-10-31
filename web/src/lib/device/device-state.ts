/**
 * Estado de la caja (dispositivo) en el Next local del POS desktop (fase 4).
 *
 * Electron (main) descifra los secretos con `safeStorage` y los pasa por env al arrancar; acá viven SOLO en memoria del
 * servidor (jamás llegan al renderer) y cada cambio se avisa al main por IPC (`process.parentPort`) para que los
 * persista cifrados. En web / fuera de Electron todo es no-op: no hay caja.
 */

export interface TenantDeviceSecret {
  secret: string
  /** false tras un logout explícito: renovar exige un nuevo login. */
  sessionActive: boolean
}

export interface DeviceIdentity {
  /** UUID estable de la instalación (lo genera Electron). */
  deviceId: string
  name: string
  platform: string
  appVersion: string
  /** Electron puede cifrar y persistir los secretos (si no, la sesión larga vive solo en memoria). */
  persist: boolean
}

type Env = Record<string, string | undefined>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SECRET = 200

/** Identidad de la caja desde el env de Electron; null si no hay (web, dev sin Electron). */
export function readIdentity(env: Env = process.env): DeviceIdentity | null {
  const deviceId = env.OMERO_DEVICE_ID?.trim()
  if (!deviceId || !UUID.test(deviceId)) return null
  return {
    deviceId: deviceId.toLowerCase(),
    name: (env.OMERO_DEVICE_NAME ?? '').trim().slice(0, 100),
    platform: (env.OMERO_DEVICE_PLATFORM ?? '').trim().slice(0, 40),
    appVersion: (env.OMERO_APP_VERSION ?? '').trim().slice(0, 40),
    persist: env.OMERO_DEVICE_PERSIST === '1',
  }
}

function parseSecrets(raw: string | undefined): Record<string, TenantDeviceSecret> {
  const out: Record<string, TenantDeviceSecret> = {}
  if (!raw) return out
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out
    for (const [tenantId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!UUID.test(tenantId) || value === null || typeof value !== 'object') continue
      const { secret, sessionActive } = value as Record<string, unknown>
      if (typeof secret !== 'string' || !secret || secret.length > MAX_SECRET) continue
      out[tenantId.toLowerCase()] = { secret, sessionActive: sessionActive !== false }
    }
  } catch {
    /* env corrupto: se arranca sin secretos */
  }
  return out
}

export type Notify = (message: { type: 'omero:device-secrets'; secrets: Record<string, TenantDeviceSecret> }) => void

/** Avisa al proceso main de Electron (utilityProcess). Fuera de Electron no hace nada. */
export const notifyParent: Notify = (message) => {
  const port = (process as unknown as { parentPort?: { postMessage(m: unknown): void } }).parentPort
  try {
    port?.postMessage(message)
  } catch {
    /* el main puede haber terminado */
  }
}

export class DeviceState {
  readonly identity: DeviceIdentity | null
  private readonly secrets: Map<string, TenantDeviceSecret>
  /** Último tenant con login/renovación en este proceso (la renovación local no trae Authorization). */
  private active: string | null = null

  constructor(env: Env = process.env, private readonly notify: Notify = notifyParent) {
    this.identity = readIdentity(env)
    this.secrets = new Map(this.identity ? Object.entries(parseSecrets(env.OMERO_DEVICE_SECRETS)) : [])
  }

  /** Hay identidad de caja (solo desktop dentro de Electron). */
  get enabled(): boolean {
    return this.identity !== null
  }

  /** Alguna caja registrada (con o sin sesión activa). */
  get hasSecrets(): boolean {
    return this.secrets.size > 0
  }

  get(tenantId: string): TenantDeviceSecret | null {
    const entry = this.secrets.get(tenantId.toLowerCase())
    return entry ? { ...entry } : null
  }

  /** Guarda el secreto (login o rotación) y avisa al main para que lo persista. */
  set(tenantId: string, secret: string, sessionActive = true): void {
    if (!this.identity) return
    this.secrets.set(tenantId.toLowerCase(), { secret, sessionActive })
    if (sessionActive) this.active = tenantId.toLowerCase()
    this.changed()
  }

  /**
   * Tenant al que renovar/cerrar sesión cuando la request no lo dice: (1) el de la pista (JWT vencido que aún tenga el
   * renderer), (2) el último que inició sesión o renovó, (3) el único con sesión activa tras un reinicio.
   */
  resolveTenant(hint?: string | null): string | null {
    const h = hint?.toLowerCase()
    if (h && this.secrets.has(h)) return h
    if (this.active && this.secrets.has(this.active)) return this.active
    const live = [...this.secrets].filter(([, v]) => v.sessionActive).map(([k]) => k)
    return live.length === 1 ? live[0] : null
  }

  /** Logout explícito: conserva el secreto (para subir lo pendiente) pero exige login para renovar. */
  markLoggedOut(tenantId: string): void {
    const entry = this.secrets.get(tenantId.toLowerCase())
    if (!entry || !entry.sessionActive) return
    this.secrets.set(tenantId.toLowerCase(), { ...entry, sessionActive: false })
    this.changed()
  }

  /** Olvida el secreto (p. ej. el backend dijo que ya no sirve). */
  remove(tenantId: string): void {
    if (this.secrets.delete(tenantId.toLowerCase())) this.changed()
  }

  snapshot(): Record<string, TenantDeviceSecret> {
    return Object.fromEntries([...this.secrets].map(([k, v]) => [k, { ...v }]))
  }

  private changed(): void {
    if (this.identity?.persist) this.notify({ type: 'omero:device-secrets', secrets: this.snapshot() })
  }
}

const globalRef = globalThis as typeof globalThis & { __omeroDeviceState?: DeviceState }

/** Singleton del proceso. */
export function getDeviceState(): DeviceState {
  return (globalRef.__omeroDeviceState ??= new DeviceState())
}

/** Solo tests: descarta el singleton. */
export function resetDeviceState(): void {
  delete globalRef.__omeroDeviceState
}
