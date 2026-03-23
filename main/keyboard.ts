import { BrowserWindow } from 'electron'

/**
 * Numpad restriction + shortcode interception at OS level.
 *
 * IMPORTANT: This file must NOT be imported by any shared POS hook in omero/.
 * Electron-specific input restriction lives here only.
 *
 * Allowed keys:
 *   - Digits 0–9 (numpad and top row)
 *   - Enter / NumpadEnter
 *   - Backspace
 *   - Decimal point / NumpadDecimal
 *   - Numpad operators: +, -, *, /
 *   - Escape
 *   - Shortcode keys (configurable via SHORTCODE_KEYS)
 *
 * All alphabetic and other non-numeric keys are blocked.
 */

// Shortcode keys allowed through the filter (e.g. F-keys or single letters mapped to POS actions)
const SHORTCODE_KEYS = new Set<string>([
  // Add shortcode keyCodes here as needed, e.g.: 'KeyV' for "ventas", 'F1', 'F2' ...
])

const ALLOWED_KEY_CODES = new Set<string>([
  // Numpad digits
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4',
  'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
  // Top-row digits
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  // Control keys
  'NumpadEnter', 'Enter', 'Backspace', 'Escape',
  // Numpad operators
  'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide',
  'NumpadDecimal', 'Period'
])

export function setupKeyboardFilter(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    // Allow modifier combos (Ctrl+R for reload in dev, etc.)
    if (input.control || input.meta || input.alt) return

    const allowed = ALLOWED_KEY_CODES.has(input.code) || SHORTCODE_KEYS.has(input.code)
    if (!allowed) {
      event.preventDefault()
    }
  })
}
