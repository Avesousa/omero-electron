import { useEffect } from 'react'

/**
 * Electron keyboard hook — same interface as useKeyboard.web.ts but WITHOUT the
 * allowedKeys filter. Input restriction is already applied at the OS level by the
 * Electron main process (omero-electron/main/keyboard.ts) via `before-input-event`.
 * Double-filtering here would cause issues with shortcode keys and modifier combos.
 *
 * This hook maps physical keycodes to logical key strings and forwards everything
 * through to the caller — including Ctrl/Meta/Alt combos, which Electron handles.
 *
 * NOTE: This file must not be imported by omero-electron/ — it lives in the shared
 * frontend repo and is selected at build time via NEXT_PUBLIC_ELECTRON=true or at
 * runtime via window.electronAPI.isElectron. Electron-specific OS-level filtering
 * belongs in omero-electron/main/keyboard.ts only.
 */
export const useKeyboard = (onKeyPress: (key: string) => void) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Map physical keys to logical equivalents — same keyMap as the web variant.
      const keyMap: Record<string, string> = {
        'Digit0': '0', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4',
        'Digit5': '5', 'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9',
        'Numpad0': '0', 'Numpad1': '1', 'Numpad2': '2', 'Numpad3': '3', 'Numpad4': '4',
        'Numpad5': '5', 'Numpad6': '6', 'Numpad7': '7', 'Numpad8': '8', 'Numpad9': '9',
        'NumpadAdd': '+', 'NumpadSubtract': '-', 'NumpadEnter': 'Enter',
        'Enter': 'Enter', 'NumpadDecimal': '.', 'Period': '.',
        'Backspace': 'Backspace',
        'NumpadMultiply': '*', 'Escape': 'Escape', 'Slash': '/', 'NumpadDivide': '/',
        'MetaLeft': 'Escape', 'MetaRight': 'Escape',
        // Some external numpads send ShiftLeft/ShiftRight or NumLock for their Esc key
        'ShiftLeft': 'Escape', 'ShiftRight': 'Escape',
        'NumLock': 'Escape',
        'Tab': 'Tab'
      }

      const mappedKey = keyMap[e.code] || e.key

      // NO allowedKeys filter — the Electron main process already restricts input.
      // Ctrl/Meta/Alt combos are allowed through so Electron system shortcuts work.
      e.preventDefault()
      onKeyPress(mappedKey)
    }

    // capture: true ensures Tab is intercepted before browser focus management
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [onKeyPress])
}
