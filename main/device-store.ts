import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

/**
 * Persistencia de la identidad de la caja y de los secretos de sesión larga (fase 4).
 *
 *  - `device-id` (texto plano): UUID de la caja; NO es secreto (identifica la instalación).
 *  - `device-session.bin`: secretos por tenant, JSON cifrado con `safeStorage` (Keychain / DPAPI). Nunca en claro.
 *
 * `safeStorage` solo existe en el proceso main: el Next local (utilityProcess) recibe el estado por env al arrancar
 * y avisa por IPC cada cambio (ver process-manager). Si el cifrado del SO no está disponible (o es el `basic_text` de
 * Linux sin keyring, que no protege nada) NO se persiste: la sesión larga vive solo en memoria mientras la app está abierta.
 * Un archivo ilegible se aparta a `.corrupt-<ts>` (nunca se borra) y se arranca sin secretos.
 */

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Solo Linux: 'basic_text' = sin protección real. */
  getSelectedStorageBackend?: () => string
}

export interface TenantDeviceSecret {
  secret: string
  /** false tras un logout explícito: para renovar hay que volver a iniciar sesión. */
  sessionActive: boolean
}

export type DeviceSecrets = Record<string, TenantDeviceSecret>

export interface DeviceStoreDeps {
  dir: string
  safeStorage: SafeStorageLike
  newId?: () => string
  now?: () => number
  log?: (message: string) => void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SECRET_LENGTH = 200

export class DeviceStore {
  private readonly idFile: string
  private readonly secretsFile: string
  private readonly newId: () => string
  private readonly now: () => number
  private readonly log: (message: string) => void
  private cachedId: string | null = null

  constructor(private readonly deps: DeviceStoreDeps) {
    this.idFile = path.join(deps.dir, 'device-id')
    this.secretsFile = path.join(deps.dir, 'device-session.bin')
    this.newId = deps.newId ?? randomUUID
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? (() => {})
    fs.mkdirSync(deps.dir, { recursive: true })
  }

  /** El SO puede cifrar de verdad (no `basic_text`). */
  get persistent(): boolean {
    try {
      const { safeStorage } = this.deps
      if (!safeStorage.isEncryptionAvailable()) return false
      return safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
    } catch {
      return false
    }
  }

  /** UUID estable de esta instalación (se crea la primera vez). */
  get deviceId(): string {
    if (this.cachedId) return this.cachedId
    try {
      const stored = fs.readFileSync(this.idFile, 'utf8').trim()
      if (UUID.test(stored)) return (this.cachedId = stored.toLowerCase())
    } catch {
      /* no existe o ilegible: se crea uno nuevo */
    }
    const id = this.newId().toLowerCase()
    this.atomicWrite(this.idFile, Buffer.from(id, 'utf8'))
    return (this.cachedId = id)
  }

  /** Secretos guardados (descifrados) o {} si no hay / no se pueden leer. */
  load(): DeviceSecrets {
    if (!this.persistent || !fs.existsSync(this.secretsFile)) return {}
    try {
      const plain = this.deps.safeStorage.decryptString(fs.readFileSync(this.secretsFile))
      return sanitize(JSON.parse(plain))
    } catch (err) {
      this.quarantine(`no se pudo leer los secretos de la caja (${(err as Error).message})`)
      return {}
    }
  }

  /** Cifra y guarda. No hace nada si el SO no puede cifrar. Devuelve si escribió. */
  save(secrets: DeviceSecrets): boolean {
    if (!this.persistent) return false
    try {
      const encrypted = this.deps.safeStorage.encryptString(JSON.stringify(sanitize(secrets)))
      this.atomicWrite(this.secretsFile, encrypted)
      return true
    } catch (err) {
      this.log(`no se pudieron guardar los secretos de la caja: ${(err as Error).message}`)
      return false
    }
  }

  private atomicWrite(file: string, data: Buffer): void {
    const tmp = `${file}.tmp-${process.pid}`
    fs.writeFileSync(tmp, data, { mode: 0o600 })
    fs.renameSync(tmp, file)
  }

  private quarantine(reason: string): void {
    const target = `${this.secretsFile}.corrupt-${this.now()}`
    try {
      fs.renameSync(this.secretsFile, target)
      this.log(`${reason}: se apartó a ${path.basename(target)} y se arranca sin sesión larga`)
    } catch {
      this.log(`${reason}: no se pudo apartar el archivo`)
    }
  }
}

/** Solo tenants UUID con secreto de largo razonable; descarta todo lo demás. */
export function sanitize(input: unknown): DeviceSecrets {
  const out: DeviceSecrets = {}
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [tenantId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!UUID.test(tenantId) || value === null || typeof value !== 'object') continue
    const { secret, sessionActive } = value as Record<string, unknown>
    if (typeof secret !== 'string' || secret.length === 0 || secret.length > MAX_SECRET_LENGTH) continue
    out[tenantId.toLowerCase()] = { secret, sessionActive: sessionActive !== false }
  }
  return out
}
