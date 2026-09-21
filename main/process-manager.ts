import { utilityProcess, UtilityProcess } from 'electron'
import { app } from 'electron'
import path from 'path'
import net from 'net'
import { frontendLogger, makeLineHandler } from './logger'
import { resolveBackendUrl } from './config'
import { readBuildConfig } from './build-config'

const IS_PACKAGED = app.isPackaged
const ROOT = IS_PACKAGED
  ? path.dirname(app.getPath('exe'))
  : path.join(__dirname, '../../')

const FRONTEND_DIR = path.join(ROOT, 'resources', 'frontend')
const FRONTEND_PORT = 3000
const FRONTEND_HOST = '127.0.0.1'

let frontendProcess: UtilityProcess | null = null
let frontendExitCode: number | null = null

/**
 * Levanta el Next standalone del POS en 127.0.0.1:3000 (modo desktop).
 * El Next hace de proxy hacia el omero-backend de Railway: BACKEND_URL sale de la variable de
 * entorno (override) o del default embebido en el build. Lanza si no hay ninguna.
 */
export function startFrontend(): void {
  const backendUrl = resolveBackendUrl(process.env, readBuildConfig())
  const serverJs = path.join(FRONTEND_DIR, 'server.js')

  frontendLogger.info(`starting frontend (runtime=desktop, backend=${backendUrl})`)
  frontendExitCode = null
  frontendProcess = utilityProcess.fork(serverJs, [], {
    cwd: FRONTEND_DIR,
    env: {
      NODE_ENV: 'production',
      PORT: String(FRONTEND_PORT),
      HOSTNAME: FRONTEND_HOST,
      OMERO_RUNTIME: 'desktop',
      BACKEND_URL: backendUrl,
    },
    stdio: 'pipe',
  })

  frontendProcess.stdout?.on('data', makeLineHandler(frontendLogger.info))
  frontendProcess.stderr?.on('data', makeLineHandler(frontendLogger.error))
  frontendProcess.on('exit', (code) => {
    frontendExitCode = code
    frontendLogger.info(`frontend exited with code ${code}`)
  })
}

/** Espera a que el Next local responda su health (no depende de la conexión con Railway). */
export async function waitForFrontend(timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    // Si el Next murió (p. ej. configuración inválida) no tiene sentido seguir esperando.
    if (frontendExitCode !== null) throw new Error(`El POS local terminó inesperadamente (código ${frontendExitCode})`)
    try {
      const res = await fetch(`http://${FRONTEND_HOST}:${FRONTEND_PORT}/api/_local/health`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('El POS local no arrancó en 60 segundos')
}

export function stopAll(): void {
  if (frontendProcess) {
    frontendProcess.kill()
    frontendProcess = null
  }
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => { server.close(); resolve(true) })
    server.listen(port)
  })
}
