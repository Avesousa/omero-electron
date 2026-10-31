import { contextBridge, ipcRenderer } from 'electron'

export interface UpdateAvailableInfo {
  version: string
  url: string
}

/**
 * Minimal contextBridge API exposed to the renderer (POS web page).
 * Only expose what the POS explicitly needs — keep this surface minimal.
 *
 * - platform/isElectron: so the POS can select useKeyboard.electron.ts at build/runtime if needed.
 * - onUpdateAvailable: 'omero:update-available' forwarded from main (see main.ts autoUpdater,
 *   notify-only — no ipcRenderer exposed directly, only this one-shot subscription).
 */
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  onUpdateAvailable: (callback: (info: UpdateAvailableInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: UpdateAvailableInfo) => callback(info)
    ipcRenderer.on('omero:update-available', listener)
    return () => ipcRenderer.removeListener('omero:update-available', listener)
  }
})
