import { BrowserWindow } from 'electron'

/**
 * Minimal keyboard filter — only blocks F1 (opens browser help in some environments).
 * All other keys are passed through to the renderer, which handles its own logic.
 * OS-level key focus is maintained via the blur→focus handler in main.ts.
 */

const BLOCKED_KEYS = new Set<string>(['F1'])

export function setupKeyboardFilter(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (BLOCKED_KEYS.has(input.code)) {
      event.preventDefault()
    }
  })
}
