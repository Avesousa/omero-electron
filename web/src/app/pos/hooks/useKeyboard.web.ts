import { useEffect } from 'react'

/**
 * Web keyboard hook — accepts full keyboard input (alphabetic + numeric + control keys).
 * No numpad restriction applied here; the web POS must accept shortcodes typed from
 * a standard keyboard. Numpad restriction is handled at the OS level in the Electron
 * main process (main/keyboard.ts) and must NOT be added here.
 *
 * Shared core boundary: this hook must not import anything from omero-electron/.
 */
export const useKeyboard = (onKeyPress: (key: string) => void) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Map numpad physical keys to their logical equivalents so numpad works
      // in the web app too — but we do NOT restrict to numpad-only keys.
      const keyMap: Record<string, string> = {
        'Digit0': '0', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4',
        'Digit5': '5', 'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9',
        'Numpad0': '0', 'Numpad1': '1', 'Numpad2': '2', 'Numpad3': '3', 'Numpad4': '4',
        'Numpad5': '5', 'Numpad6': '6', 'Numpad7': '7', 'Numpad8': '8', 'Numpad9': '9',
        'NumpadAdd': '+', 'NumpadSubtract': '-', 'Minus': '-', 'NumpadEnter': 'Enter',
        'Enter': 'Enter', 'NumpadDecimal': '.', 'Period': '.',
        'Backspace': 'Backspace',
        'NumpadMultiply': '*', 'Escape': 'Escape', 'Slash': '/', 'NumpadDivide': '/',
        'MetaLeft': 'Escape', 'MetaRight': 'Escape',
        'Tab': 'Tab'
      }

      const mappedKey = keyMap[e.code] || e.key

      // Skip modifier-only combos (Ctrl+C, Ctrl+V, etc.) so browser shortcuts work
      // Exception: MetaLeft/MetaRight alone are mapped to Escape (numpad "volver" key)
      if (e.ctrlKey || e.altKey) return
      if (e.metaKey && e.code !== 'MetaLeft' && e.code !== 'MetaRight') return

      e.preventDefault()
      onKeyPress(mappedKey)
    }

    // capture: true ensures Tab is intercepted before browser focus management
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [onKeyPress])
}
