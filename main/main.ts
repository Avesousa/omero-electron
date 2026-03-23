import { app, BrowserWindow } from 'electron'
import path from 'path'
import { setupKeyboardFilter } from './keyboard'
import { POS_URL } from './config'

// Auto-updater stub — not functional until code signing is configured.
// See README.md for setup instructions.
// To enable: configure a publish provider in electron-builder.config.ts, set up
// code signing certificates, then remove the `autoUpdater.logger = null` line and
// wire update-downloaded to prompt the user.
import { autoUpdater } from 'electron-updater'
autoUpdater.logger = null // suppress logs until signing and publish are configured

autoUpdater.on('update-available', () => {
  console.log('[auto-updater] Update available — stub, not yet active.')
})

autoUpdater.on('update-downloaded', () => {
  console.log('[auto-updater] Update downloaded — stub, not yet active.')
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,            // No OS title bar — POS provides its own drag region
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadURL(POS_URL)

  setupKeyboardFilter(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('ready', createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
