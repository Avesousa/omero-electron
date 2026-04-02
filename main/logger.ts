import log from 'electron-log/main'
import { Logtail } from '@logtail/node'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

log.initialize()
log.transports.file.maxSize = 10 * 1024 * 1024 // 10 MB per file

function readToken(): string | null {
  if (process.env.BETTERSTACK_TOKEN) return process.env.BETTERSTACK_TOKEN
  const tokenFile = app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'resources', 'betterstack.token')
    : path.join(__dirname, '../../resources/betterstack.token')
  try {
    if (fs.existsSync(tokenFile)) return fs.readFileSync(tokenFile, 'utf-8').trim()
  } catch { /* ignore */ }
  return null
}

export function getBetterStackToken(): string | null {
  return readToken()
}

let logtail: Logtail | null = null

export function initLogger(): void {
  const token = readToken()
  if (token) {
    logtail = new Logtail(token)
    log.info('[logger] Better Stack logging enabled')
  } else {
    log.warn('[logger] BETTERSTACK_TOKEN not found — logs saved locally only')
  }
}

// Buffer incoming data chunks into complete lines before logging
function makeLineHandler(logFn: (msg: string) => void): (d: Buffer) => void {
  let buf = ''
  return (d: Buffer) => {
    buf += d.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    lines.filter(l => l.trim()).forEach(logFn)
  }
}

export { makeLineHandler }

type Source = 'backend' | 'frontend' | 'electron'

function createLogger(source: Source) {
  return {
    info: (message: string): void => {
      log.info(`[${source}]`, message)
      logtail?.info(message, { source })
    },
    warn: (message: string): void => {
      log.warn(`[${source}]`, message)
      logtail?.warn(message, { source })
    },
    error: (message: string): void => {
      log.error(`[${source}]`, message)
      logtail?.error(message, { source })
    },
  }
}

export const backendLogger = createLogger('backend')
export const frontendLogger = createLogger('frontend')
export const electronLogger = createLogger('electron')

export async function flushLogs(): Promise<void> {
  if (logtail) await logtail.flush()
}
