import { app, BrowserWindow, dialog } from 'electron'
import path from 'path'
import { setupKeyboardFilter } from './keyboard'
import { POS_URL } from './config'
import { startBackend, startFrontend, waitForBackend, stopAll, isPortFree } from './process-manager'

import { autoUpdater } from 'electron-updater'
autoUpdater.logger = null

autoUpdater.on('update-available', () => {
  console.log('[auto-updater] Update available — stub, not yet active.')
})

autoUpdater.on('update-downloaded', () => {
  console.log('[auto-updater] Update downloaded — stub, not yet active.')
})

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
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', async () => {
  // In development (not packaged), skip process management and open directly
  if (!app.isPackaged) {
    createMainWindow()
    return
  }

  createSplashWindow()

  const [port8080Free, port3000Free] = await Promise.all([
    isPortFree(8080),
    isPortFree(3000),
  ])

  if (!port8080Free || !port3000Free) {
    const port = !port8080Free ? 8080 : 3000
    dialog.showErrorBox(
      'Puerto en uso',
      `El puerto ${port} ya está en uso. Cerrá la aplicación que lo está usando e intentá de nuevo.`
    )
    app.quit()
    return
  }

  startBackend()
  startFrontend()

  try {
    await waitForBackend()
    createMainWindow()
  } catch (err) {
    dialog.showErrorBox(
      'Error al iniciar',
      'No se pudo iniciar el servidor de Omero POS. Revisá los logs para más información.'
    )
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopAll()
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null && app.isPackaged) {
    // re-create would need to restart services — just open window if services still running
    createMainWindow()
  }
})
