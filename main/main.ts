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
import { waitForAppReady } from './app-ready'
import { readSavedTheme, THEME_BACKGROUND } from './ui-prefs'

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
async function failStartup(title: string, message: string, showDialog = true): Promise<void> {
  stopAll()
  await Promise.race([flushLogs(), new Promise((r) => setTimeout(r, FLUSH_LOGS_TIMEOUT_MS))]).catch(() => undefined)
  splashWindow?.destroy()
  splashWindow = null
  if (showDialog) dialog.showErrorBox(title, message)
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
    const previousPort = [...failedPorts].pop()
    const port = await findFreePort({ skip: failedPorts })
    if (port === null) throw new Error('no hay ningún puerto local disponible (loopback)')
    if (port !== PREFERRED_PORT) {
      electronLogger.warn(`puerto ${previousPort ?? PREFERRED_PORT} no disponible, usando ${port}`)
    }

    startFrontend(port, backendUrl)
    try {
      await waitForFrontend(port)
      return port
    } catch (err) {
      if (!(err instanceof FrontendExitedError)) throw err
      stopAll()
      failedPorts.add(port)
      electronLogger.warn(`intento ${attempt}/${MAX_START_ATTEMPTS} en el puerto ${port} falló: ${err.message}`)
      // Reintentar en otro puerto solo tiene sentido si el puerto estaba ocupado. Cualquier otro error
      // del SO (p. ej. Winsock no inicializado) va a fallar igual en los próximos 3 puertos: cortar ya
      // y subir el código de error para que quede en el log y en el diálogo de soporte.
      if (err.errorCode && err.errorCode !== 'EADDRINUSE') {
        throw new Error(`el Next local no pudo abrir un socket (error del sistema: ${err.errorCode})`)
      }
    }
  }
  throw new Error(`el POS local no pudo arrancar tras ${MAX_START_ATTEMPTS} intentos (puertos ${[...failedPorts].join(', ')})`)
}

/** Directorio de datos del Next local (mismo que `catalogCacheEnv` en process-manager): ahí vive ui-prefs.json. */
function dataDir(): string {
  return path.join(app.getPath('userData'), 'catalog-cache')
}

/** Tema guardado de la caja (claro por defecto): para pintar la carga y la ventana sin un destello del otro tema. */
function savedTheme() {
  return readSavedTheme(dataDir())
}

/**
 * Pantalla de carga (logo + "Cargando…"). Se muestra de inmediato y se mantiene hasta que la página del POS avisa que
 * ya pintó (ver `revealWhenReady`): así nunca hay una ventana en blanco entre el arranque del Next local y el login.
 */
function createSplashWindow(): void {
  const theme = savedTheme()
  splashWindow = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    resizable: false,
    backgroundColor: THEME_BACKGROUND[theme],
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  splashWindow.loadFile(path.join(__dirname, 'splash.html'), { query: { theme } })
}

function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
  splashWindow = null
}

const MAX_LOAD_RETRIES = 5
const LOAD_RETRY_DELAY_MS = 1000
const APP_READY_TIMEOUT_MS = 20_000

/**
 * Muestra la ventana del POS recién cuando la página avisó que está lista (hidratada, sesión restaurada, tema aplicado)
 * o venció el tope de espera (entonces se muestra igual: mejor ver algo que quedar en la carga para siempre).
 */
async function revealWhenReady(win: BrowserWindow): Promise<void> {
  const result = await waitForAppReady({
    evaluate: (expression) => win.webContents.executeJavaScript(expression),
    timeoutMs: APP_READY_TIMEOUT_MS,
  })
  if (win.isDestroyed()) return
  if (result === 'timeout') electronLogger.warn(`la página no avisó que estaba lista en ${APP_READY_TIMEOUT_MS} ms: se muestra igual`)
  closeSplash()
  win.show()
  electronLogger.info(`main window ready (${result})`)
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: THEME_BACKGROUND[savedTheme()],
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const win = mainWindow
  const url = buildPosUrl(frontendPort)
  let loadFailures = 0

  void win.loadURL(url).catch(() => undefined) // los fallos se manejan en did-fail-load
  setupKeyboardFilter(win)

  // La página es del Next local (ya respondió el health): un fallo de carga es transitorio; se reintenta unas veces.
  win.webContents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ERR_ABORTED: navegación reemplazada */) return
    electronLogger.warn(`la ventana no pudo cargar ${url}: ${description} (${code})`)
    if (++loadFailures > MAX_LOAD_RETRIES) {
      void offerRetry('No se pudo cargar la pantalla', 'Omero POS no pudo mostrar la pantalla principal.').then((retry) => {
        if (retry && !win.isDestroyed()) { loadFailures = 0; void win.loadURL(url).catch(() => undefined) } else app.exit(1)
      })
      return
    }
    setTimeout(() => { if (!win.isDestroyed()) void win.loadURL(url).catch(() => undefined) }, LOAD_RETRY_DELAY_MS)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    electronLogger.error(`el renderer terminó (${details.reason}): recargando`)
    if (!win.isDestroyed()) win.reload()
  })

  void revealWhenReady(win)

  // Keep POS window focused in production so OS shortcuts (Esc, etc.)
  // are always captured by the app before Windows intercepts them.
  if (app.isPackaged) {
    win.on('blur', () => mainWindow?.focus())
  }

  win.on('closed', () => {
    mainWindow = null
  })
}

/** Diálogo en español con "Reintentar" / "Salir". La pantalla de carga baja de capa para no taparlo. */
async function offerRetry(title: string, detail: string): Promise<boolean> {
  splashWindow?.setAlwaysOnTop(false)
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title,
    message: title,
    detail: `${detail} Podés reintentar o cerrar el programa. Si el problema continúa, contactá a soporte.`,
    buttons: ['Reintentar', 'Salir'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  splashWindow?.setAlwaysOnTop(true)
  return response === 0
}

/** Levanta el Next local y abre la ventana; si el servidor no llega a responder, ofrece reintentar (nunca queda en blanco). */
async function startPos(backendUrl: string): Promise<void> {
  for (;;) {
    try {
      frontendPort = await startFrontendWithFallback(backendUrl)
      electronLogger.info(`frontend ready on port ${frontendPort} — creating main window`)
      createMainWindow()
      checkForUpdatesSafely()
      setInterval(checkForUpdatesSafely, UPDATE_CHECK_INTERVAL_MS)
      return
    } catch (err) {
      electronLogger.error(`frontend failed to start: ${err}`)
      stopAll()
      if (!(await offerRetry('No se pudo iniciar Omero POS', 'El sistema local no respondió.'))) {
        await failStartup('No se pudo iniciar Omero POS', 'Cerrá el programa y volvé a abrirlo. Si el problema continúa, contactá a soporte.', false)
        return
      }
    }
  }
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

  await startPos(backendUrl)
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
