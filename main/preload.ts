import { contextBridge } from 'electron'

/**
 * Minimal contextBridge API exposed to the renderer (POS web page).
 * Only expose what the POS explicitly needs — keep this surface minimal.
 *
 * Current exposure: platform detection so the POS can select
 * useKeyboard.electron.ts at build/runtime if needed.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true
})
