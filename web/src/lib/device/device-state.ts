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
  /** Última renovación exitosa (login o refresh), ms epoch. Ausente en secretos guardados por versiones anteriores. */
  lastCheckedAt?: number
  /** Vencimiento de la sesión de 14 días informado por el backend, ms epoch. */
  expiresAt?: number
}

/** Metadatos de una renovación que se guardan junto al secreto. */
export interface RenewalMeta {
  lastCheckedAt: number
  expiresAt?: number | null
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

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

function timestamps(lastCheckedAt: unknown, expiresAt: unknown): Pick<TenantDeviceSecret, 'lastCheckedAt' | 'expiresAt'> {
  return { ...(isTime(lastCheckedAt) ? { lastCheckedAt } : {}), ...(isTime(expiresAt) ? { expiresAt } : {}) }
}

function parseSecrets(raw: string | undefined): Record<string, TenantDeviceSecret> {
  const out: Record<string, TenantDeviceSecret> = {}
  if (!raw) return out
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return out
    for (const [tenantId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!UUID.test(tenantId) || value === null || typeof value !== 'object') continue
      const { secret, sessionActive, lastCheckedAt, expiresAt } = value as Record<string, unknown>
      if (typeof secret !== 'string' || !secret || secret.length > MAX_SECRET) continue
      out[tenantId.toLowerCase()] = { secret, sessionActive: sessionActive !== false, ...timestamps(lastCheckedAt, expiresAt) }
    }
  } catch {
    /* env corrupto: se arranca sin secretos */
  }
  return out
}

export interface SecretsMessage {
  type: 'omero:device-secrets'
  secrets: Record<string, TenantDeviceSecret>
  /** Presente cuando el llamador espera la confirmación de que quedó en disco (`omero:device-secrets-ack`). */
  ackId?: string
}

export type Notify = (message: SecretsMessage) => void

/** Espera la confirmación de Electron de que el mensaje quedó persistido. Resuelve false si no llega a tiempo. */
export type Durable = (message: SecretsMessage, timeoutMs: number) => Promise<boolean>

export const DURABLE_TIMEOUT_MS = 3000

/** Avisa al proceso main de Electron (utilityProcess). Fuera de Electron no hace nada. */
export const notifyParent: Notify = (message) => {
  const port = (process as unknown as { parentPort?: { postMessage(m: unknown): void } }).parentPort
  try {
    port?.postMessage(message)
  } catch {
    /* el main puede haber terminado */
  }
}

/** Pide a Electron persistir YA y espera su ack por `parentPort`. Sin Electron (sin `parentPort`) devuelve false. */
export const durableParent: Durable = (message, timeoutMs) => {
  const port = (process as unknown as {
    parentPort?: { postMessage(m: unknown): void; on(ev: 'message', fn: (e: { data?: unknown }) => void): void; off?(ev: 'message', fn: (e: { data?: unknown }) => void): void }
  }).parentPort
  if (!port || typeof port.on !== 'function') return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      port.off?.('message', onMessage)
      resolve(ok)
    }
    const onMessage = (e: { data?: unknown }) => {
      const d = e?.data as { type?: unknown; ackId?: unknown; ok?: unknown } | undefined
      if (d?.type === 'omero:device-secrets-ack' && d.ackId === message.ackId) finish(d.ok === true)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    port.on('message', onMessage)
    try {
      port.postMessage(message)
    } catch {
      finish(false)
    }
  })
}

export class DeviceState {
  readonly identity: DeviceIdentity | null
  private readonly secrets: Map<string, TenantDeviceSecret>
  /** Último tenant con login/renovación en este proceso (la renovación local no trae Authorization). */
  private active: string | null = null
  /** Motivo definitivo por el que la sesión de la caja terminó (solo memoria): lo lee la UI. Se limpia al volver a iniciar sesión. */
  private readonly ended = new Map<string, 'DEVICE_REVOKED' | 'DEVICE_EXPIRED' | 'LOGIN_REQUIRED'>()
  private seq = 0

  constructor(
    env: Env = process.env,
    private readonly notify: Notify = notifyParent,
    private readonly durable: Durable = durableParent,
    private readonly clock: () => number = Date.now,
  ) {
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
  set(tenantId: string, secret: string, sessionActive = true, meta?: RenewalMeta): void {
    this.store(tenantId, secret, sessionActive, meta)
    this.changed()
  }

  /**
   * Como `set`, pero espera a que Electron confirme que el secreto NUEVO quedó en disco (escritura inmediata, sin debounce).
   * Se usa tras una rotación: el viejo ya no sirve en el backend, así que no se sigue hasta tener el nuevo a salvo.
   * Devuelve false si no hubo confirmación (el secreto igual queda en memoria; se reintenta con el debounce normal).
   */
  async setDurable(tenantId: string, secret: string, meta?: RenewalMeta): Promise<boolean> {
    this.store(tenantId, secret, true, meta)
    if (!this.identity?.persist) return true // sin persistencia (sin cifrado del SO): solo memoria, nada que esperar
    const ackId = `${Date.now()}-${++this.seq}`
    const ok = await this.durable({ type: 'omero:device-secrets', secrets: this.snapshot(), ackId }, DURABLE_TIMEOUT_MS)
    if (!ok) this.changed() // por si el ack se perdió: el camino normal igual lo persiste
    return ok
  }

  private store(tenantId: string, secret: string, sessionActive: boolean, meta?: RenewalMeta): void {
    if (!this.identity) return
    const key = tenantId.toLowerCase()
    const prev = this.secrets.get(key)
    this.secrets.set(key, {
      secret,
      sessionActive,
      ...(meta ? timestamps(meta.lastCheckedAt, meta.expiresAt) : prev ? timestamps(prev.lastCheckedAt, prev.expiresAt) : {}),
    })
    if (sessionActive) {
      this.active = key
      this.ended.delete(key)
    }
  }

  /** Registra que la sesión terminó de forma definitiva (revocada / vencida / exige login). */
  markEnded(tenantId: string, code: 'DEVICE_REVOKED' | 'DEVICE_EXPIRED' | 'LOGIN_REQUIRED'): void {
    this.ended.set(tenantId.toLowerCase(), code)
  }

  /**
   * Motivo por el que la sesión terminó: el que registró una renovación fallida o, si pasaron los 14 días de la última
   * renovación exitosa (`expiresAt`) sin renovar, `DEVICE_EXPIRED`.
   */
  endedReason(tenantId: string): 'DEVICE_REVOKED' | 'DEVICE_EXPIRED' | 'LOGIN_REQUIRED' | null {
    const key = tenantId.toLowerCase()
    const ended = this.ended.get(key)
    if (ended) return ended
    const entry = this.secrets.get(key)
    return entry?.sessionActive && entry.expiresAt && entry.expiresAt <= this.clock() ? 'DEVICE_EXPIRED' : null
  }

  /** Anota que se intentó validar la sesión (aunque haya fallado por red): no se vuelve a validar hasta dentro de 24 h. */
  markChecked(tenantId: string, at: number): void {
    const key = tenantId.toLowerCase()
    const entry = this.secrets.get(key)
    if (!entry) return
    this.secrets.set(key, { ...entry, lastCheckedAt: at })
    this.changed()
  }

  /** Tenants con sesión activa (los que hay que renovar a diario). */
  activeTenants(): string[] {
    return [...this.secrets].filter(([, v]) => v.sessionActive).map(([k]) => k)
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
