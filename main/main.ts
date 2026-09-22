import { app, BrowserWindow, dialog } from 'electron'
import path from 'path'
import { setupKeyboardFilter } from './keyboard'
import { POS_URL } from './config'
import { startFrontend, waitForFrontend, stopAll, isPortFree } from './process-manager'
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

  mainWindow.loadURL(POS_URL)

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
  initLogger()

  // In development (not packaged), skip process management and open directly
  if (!app.isPackaged) {
    electronLogger.info('dev mode — skipping process management')
    createMainWindow()
    return
  }

  electronLogger.info('app starting')
  createSplashWindow()

  if (!(await isPortFree(3000))) {
    electronLogger.error('port 3000 already in use — aborting startup')
    dialog.showErrorBox(
      'Puerto en uso',
      'El puerto 3000 ya está en uso. Cerrá la aplicación que lo está usando e intentá de nuevo.'
    )
    app.quit()
    return
  }

  try {
    startFrontend()
  } catch (err) {
    // Sin URL de backend (ni BACKEND_URL ni build-config.json): no tiene sentido seguir.
    electronLogger.error(`cannot start frontend: ${err}`)
    dialog.showErrorBox(
      'Configuración incompleta',
      'No se encontró la URL del servidor de Omero. Reinstalá la aplicación o contactá a soporte.'
    )
    app.quit()
    return
  }

  try {
    await waitForFrontend()
    electronLogger.info('frontend ready — creating main window')
    createMainWindow()
    checkForUpdatesSafely()
    setInterval(checkForUpdatesSafely, UPDATE_CHECK_INTERVAL_MS)
  } catch (err) {
    electronLogger.error(`frontend failed to start: ${err}`)
    dialog.showErrorBox(
      'Error al iniciar',
      'No se pudo iniciar Omero POS. Revisá los logs para más información.'
    )
    app.quit()
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
