import { app, BrowserWindow, dialog } from 'electron'
import path from 'path'
import { setupKeyboardFilter } from './keyboard'
import os from 'os'
import { buildPosUrl } from './config'
import {
  startFrontend, waitForFrontend, stopAll, resolveConfiguredBackendUrl, FrontendExitedError,
} from './process-manager'
import { findFreePort, PREFERRED_PORT } from './ports'
import { initLogger, electronLogger, flushLogs } from './logger'

import { autoUpdater } from 'electron-updater'

// Modo "solo avisar": SIN firma de código no instalamos updates en silencio (Gatekeeper/SmartScreen
// bloquearían el instalador nuevo igual que el actual). Solo consultamos el feed de GitHub Releases
// (app-update.yml embebido por electron-builder, ver electron-builder.config.ts) y avisamos al
// renderer para que el cajero se baje el instalador nuevo a mano. Reactivar autoDownload +
// quitAndInstall() el día que haya certificado.
autoUpdater.logger = null
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 h — la caja suele quedar abierta todo el día

autoUpdater.on('update-available', (info) => {
  electronLogger.info(`auto-updater: update available (${info.version})`)
  mainWindow?.webContents.send('omero:update-available', {
    version: info.version,
    url: `https://github.com/Avesousa/omero-electron/releases/tag/v${info.version}`
  })
})

autoUpdater.on('error', (err) => {
  // Sin conexión / rate limit de GitHub / etc.: nunca debe interrumpir el POS.
  electronLogger.warn(`auto-updater: check failed — ${err}`)
})

function checkForUpdatesSafely(): void {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdates().catch((err) => {
    electronLogger.warn(`auto-updater: checkForUpdates threw — ${err}`)
  })
}

let splashWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
/** Puerto en el que quedó el Next local (normalmente 3000; si no está libre se usa otro, sin avisar al cajero). */
let frontendPort = PREFERRED_PORT

// Una sola instancia: antes lo garantizaba (de rebote) el error de "puerto en uso"; con el fallback de
// puertos dos cajas abiertas compartirían las bases SQLite y subirían el outbox por duplicado.
const isPrimaryInstance = !app.isPackaged || app.requestSingleInstanceLock()
if (isPrimaryInstance) {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

const FLUSH_LOGS_TIMEOUT_MS = 2000
const MAX_START_ATTEMPTS = 4

/**
 * Falla de arranque: cierra la app DE VERDAD. El splash (alwaysOnTop) tapaba el diálogo de error y la
 * caja parecía colgada en "Iniciando…"; ahora se cierra antes, y `app.exit` no espera a nadie.
 * El mensaje es para el cajero (sin detalles técnicos): el detalle queda en el log para soporte.
 */
async function failStartup(title: string, message: string): Promise<void> {
  stopAll()
  await Promise.race([flushLogs(), new Promise((r) => setTimeout(r, FLUSH_LOGS_TIMEOUT_MS))]).catch(() => undefined)
  splashWindow?.destroy()
  splashWindow = null
  dialog.showErrorBox(title, message)
  app.exit(1)
}

/**
 * Levanta el Next local en un puerto libre. Si el Next muere antes de responder (p. ej. Windows no le
 * deja abrir el puerto aunque el sondeo dijo que estaba libre) se reintenta en el siguiente puerto.
 * Un timeout NO se reintenta: el proceso sigue vivo y otro intento solo alargaría la espera.
 */
async function startFrontendWithFallback(backendUrl: string): Promise<number> {
  const failedPorts = new Set<number>()
  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
    const port = await findFreePort({ skip: failedPorts })
    if (port === null) throw new Error('no hay ningún puerto local disponible (loopback)')
    if (port !== PREFERRED_PORT) electronLogger.warn(`puerto ${PREFERRED_PORT} no disponible, usando ${port}`)

    startFrontend(port, backendUrl)
    try {
      await waitForFrontend(port)
      return port
    } catch (err) {
      if (!(err instanceof FrontendExitedError)) throw err
      stopAll()
      failedPorts.add(port)
      electronLogger.warn(`intento ${attempt}/${MAX_START_ATTEMPTS} en el puerto ${port} falló: ${err.message}`)
    }
  }
  throw new Error(`el POS local no pudo arrancar tras ${MAX_START_ATTEMPTS} intentos (puertos ${[...failedPorts].join(', ')})`)
}

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 280,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadURL(buildPosUrl(frontendPort))

  setupKeyboardFilter(mainWindow)

  mainWindow.once('ready-to-show', () => {
    splashWindow?.close()
    splashWindow = null
    mainWindow?.show()
    electronLogger.info('main window ready')
  })

  // Keep POS window focused in production so OS shortcuts (Esc, etc.)
  // are always captured by the app before Windows intercepts them.
  if (app.isPackaged) {
    mainWindow.on('blur', () => mainWindow?.focus())
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', async () => {
  if (!isPrimaryInstance) {
    app.exit(0)
    return
  }
  initLogger()

  // In development (not packaged), skip process management and open directly
  if (!app.isPackaged) {
    electronLogger.info('dev mode — skipping process management')
    createMainWindow()
    return
  }

  electronLogger.info(
    `app starting (v${app.getVersion()}, ${process.platform}-${process.arch}, os ${os.release()}, electron ${process.versions.electron})`
  )
  createSplashWindow()

  let backendUrl: string
  try {
    backendUrl = resolveConfiguredBackendUrl()
  } catch (err) {
    // Sin URL de backend (ni BACKEND_URL ni build-config.json): no tiene sentido seguir.
    electronLogger.error(`cannot start frontend: ${err}`)
    await failStartup(
      'Configuración incompleta',
      'No se encontró la URL del servidor de Omero. Reinstalá la aplicación o contactá a soporte.'
    )
    return
  }

  try {
    frontendPort = await startFrontendWithFallback(backendUrl)
    electronLogger.info(`frontend ready on port ${frontendPort} — creating main window`)
    createMainWindow()
    checkForUpdatesSafely()
    setInterval(checkForUpdatesSafely, UPDATE_CHECK_INTERVAL_MS)
  } catch (err) {
    electronLogger.error(`frontend failed to start: ${err}`)
    await failStartup(
      'No se pudo iniciar Omero POS',
      'Cerrá el programa y volvé a abrirlo. Si el problema continúa, contactá a soporte.'
    )
  }
})

app.on('before-quit', async () => {
  electronLogger.info('app shutting down')
  stopAll()
  await flushLogs()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopAll()
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null && app.isPackaged) {
    createMainWindow()
  }
})
