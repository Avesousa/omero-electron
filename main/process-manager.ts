import { utilityProcess, UtilityProcess } from 'electron'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { frontendLogger, makeLineHandler } from './logger'
import { resolveBackendUrl } from './config'
import { readBuildConfig } from './build-config'
import { RESOURCES_DIR } from './paths'
import { LOOPBACK_HOST } from './ports'
import os from 'os'
import { DeviceStore, sanitize } from './device-store'
import { safeStorage } from 'electron'

const IS_PACKAGED = app.isPackaged
const FRONTEND_DIR = path.join(RESOURCES_DIR, 'frontend')

/**
 * Caché SQLite del catálogo (fase 2). Las bases viven en `<userData>/catalog-cache` (distinto de `<userData>/data`,
 * que usaba la H2 legacy). El binario nativo de better-sqlite3 se elige por plataforma/arquitectura: el DMG
 * universal y el instalador de Windows llevan uno por combinación en `resources/native`.
 * Si no está el binario (build sin `fetch:native`) el POS igual funciona, sin caché.
 */
function catalogCacheEnv(): Record<string, string> {
  const dataDir = path.join(app.getPath('userData'), 'catalog-cache')
  fs.mkdirSync(dataDir, { recursive: true })
  const env: Record<string, string> = { OMERO_DATA_DIR: dataDir }

  if (IS_PACKAGED) {
    const binding = path.join(RESOURCES_DIR, 'native', `better_sqlite3-${process.platform}-${process.arch}.node`)
    if (fs.existsSync(binding)) env.OMERO_SQLITE_BINDING = binding
    else frontendLogger.warn(`sin binario de SQLite para ${process.platform}-${process.arch}: el POS corre sin caché`)
  }
  frontendLogger.info(`catalog cache dir: ${dataDir}${env.OMERO_SQLITE_BINDING ? ' (binding nativo empaquetado)' : ''}`)
  return env
}

/**
 * Identidad y sesión larga de la caja (fase 4). El secreto se guarda con `safeStorage` (solo existe en este proceso):
 * al arrancar se descifra y se pasa al Next por env; el Next avisa por IPC cada vez que el secreto rota.
 */
let deviceStore: DeviceStore | null = null
let pendingSecrets: unknown = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
const PERSIST_DEBOUNCE_MS = 200

function getDeviceStore(): DeviceStore {
  return (deviceStore ??= new DeviceStore({
    dir: path.join(app.getPath('userData'), 'device'),
    safeStorage,
    log: (m) => frontendLogger.warn(m),
  }))
}

function deviceEnv(): Record<string, string> {
  const store = getDeviceStore()
  const persistent = store.persistent
  if (!persistent) frontendLogger.warn('safeStorage no disponible: la sesión larga de la caja vive solo en memoria (sin persistir)')
  return {
    OMERO_DEVICE_ID: store.deviceId,
    OMERO_DEVICE_NAME: os.hostname(),
    OMERO_DEVICE_PLATFORM: process.platform,
    OMERO_APP_VERSION: app.getVersion(),
    OMERO_DEVICE_PERSIST: persistent ? '1' : '0',
    OMERO_DEVICE_SECRETS: JSON.stringify(persistent ? store.load() : {}),
  }
}

function flushSecrets(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  if (pendingSecrets === null) return
  const secrets = sanitize(pendingSecrets)
  pendingSecrets = null
  getDeviceStore().save(secrets)
}

/** El Next avisa que los secretos cambiaron (login, rotación, logout): se persisten con un pequeño debounce. */
function onFrontendMessage(message: unknown): void {
  if (message === null || typeof message !== 'object') return
  const { type, secrets } = message as { type?: unknown; secrets?: unknown }
  if (type !== 'omero:device-secrets') return
  pendingSecrets = secrets
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(flushSecrets, PERSIST_DEBOUNCE_MS)
}

let frontendProcess: UtilityProcess | null = null
let frontendExitCode: number | null = null

/** El Next local terminó antes de responder (p. ej. no pudo abrir el puerto): vale la pena reintentar en otro. */
export class FrontendExitedError extends Error {
  constructor(readonly code: number | null) {
    super(`El POS local terminó inesperadamente (código ${code})`)
    this.name = 'FrontendExitedError'
  }
}

/** URL del backend de Railway (env BACKEND_URL > build-config). Lanza si no hay ninguna. */
export function resolveConfiguredBackendUrl(): string {
  return resolveBackendUrl(process.env, readBuildConfig())
}

/**
 * Levanta el Next standalone del POS en 127.0.0.1:<port> (modo desktop).
 * El Next hace de proxy hacia el omero-backend de Railway.
 */
export function startFrontend(port: number, backendUrl: string): void {
  const serverJs = path.join(FRONTEND_DIR, 'server.js')

  frontendLogger.info(`starting frontend (runtime=desktop, port=${port}, backend=${backendUrl})`)
  frontendExitCode = null
  const proc = utilityProcess.fork(serverJs, [], {
    cwd: FRONTEND_DIR,
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: LOOPBACK_HOST,
      OMERO_RUNTIME: 'desktop',
      BACKEND_URL: backendUrl,
      ...catalogCacheEnv(),
      ...deviceEnv(),
    },
    stdio: 'pipe',
  })
  frontendProcess = proc

  proc.on('message', onFrontendMessage)
  proc.stdout?.on('data', makeLineHandler(frontendLogger.info))
  proc.stderr?.on('data', makeLineHandler(frontendLogger.error))
  proc.on('exit', (code) => {
    // Un intento anterior (ya reemplazado) no debe pisar el estado del actual.
    if (frontendProcess === proc) frontendExitCode = code
    frontendLogger.info(`frontend exited with code ${code}`)
  })
}

/** Espera a que el Next local responda su health (no depende de la conexión con Railway). */
export async function waitForFrontend(port: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    // Si el Next murió (p. ej. configuración inválida o puerto no disponible) no tiene sentido seguir esperando.
    if (frontendExitCode !== null) throw new FrontendExitedError(frontendExitCode)
    try {
      const res = await fetch(`http://${LOOPBACK_HOST}:${port}/api/_local/health`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('El POS local no arrancó en 60 segundos')
}

export function stopAll(): void {
  flushSecrets() // no perder una rotación que todavía está en el debounce
  if (frontendProcess) {
    frontendProcess.kill()
    frontendProcess = null
  }
}
