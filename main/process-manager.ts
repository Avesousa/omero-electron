import { spawn, ChildProcess } from 'child_process'
import { utilityProcess, UtilityProcess } from 'electron'
import { app } from 'electron'
import path from 'path'
import net from 'net'
import { backendLogger, frontendLogger, electronLogger, makeLineHandler, getBetterStackToken } from './logger'

const IS_PACKAGED = app.isPackaged
const ROOT = IS_PACKAGED
  ? path.dirname(app.getPath('exe'))
  : path.join(__dirname, '../../')

const JRE_JAVA   = path.join(ROOT, 'resources', 'jre', 'bin', IS_PACKAGED ? 'javaw.exe' : 'java')
const BACKEND_JAR = path.join(ROOT, 'resources', 'backend', 'omero-backend.jar')
const FRONTEND_DIR = path.join(ROOT, 'resources', 'frontend')
const DATA_DIR = path.join(app.getPath('userData'), 'data')

let backendProcess: ChildProcess | null = null
let frontendProcess: UtilityProcess | null = null

export function startBackend(): void {
  const token = getBetterStackToken()
  const metricsArgs = token
    ? [`-DBETTERSTACK_TOKEN=${token}`, '-DBETTERSTACK_METRICS_ENABLED=true']
    : []

  backendProcess = spawn(JRE_JAVA, [
    '-Xmx256m',
    '-XX:TieredStopAtLevel=1',
    `-DOMERO_DATA_DIR=${DATA_DIR}`,
    '-Dspring.profiles.active=local',
    ...metricsArgs,
    '-jar',
    BACKEND_JAR,
  ], {
    detached: false,
    windowsHide: true,
    stdio: 'pipe',
  })

  backendProcess.stdout?.on('data', makeLineHandler(backendLogger.info))
  backendProcess.stderr?.on('data', makeLineHandler(backendLogger.error))
  backendProcess.on('exit', (code) => electronLogger.info(`backend exited with code ${code}`))
}

export function startFrontend(): void {
  const serverJs = path.join(FRONTEND_DIR, 'server.js')
  frontendProcess = utilityProcess.fork(serverJs, [], {
    cwd: FRONTEND_DIR,
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_URL: 'http://localhost:8080',
      PORT: '3000',
      HOSTNAME: '127.0.0.1',
    },
    stdio: 'pipe',
  })

  frontendProcess.stdout?.on('data', makeLineHandler(frontendLogger.info))
  frontendProcess.stderr?.on('data', makeLineHandler(frontendLogger.error))
}

export async function waitForBackend(timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch('http://localhost:8080/api/health')
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('Backend did not start within 60 seconds')
}

export function stopAll(): void {
  if (frontendProcess) {
    frontendProcess.kill()
    frontendProcess = null
  }
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM')
    backendProcess = null
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
