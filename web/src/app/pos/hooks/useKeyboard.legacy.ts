/**
 * SUPERSEDED — do NOT use or import this file directly.
 *
 * This is the original monolithic keyboard hook kept for reference only.
 * It is replaced by:
 *   - useKeyboard.web.ts      — web app variant (full keyboard, no allowedKeys filter)
 *   - useKeyboard.electron.ts — Electron variant (no OS-level double-filtering)
 *
 * The active export is re-exported via hooks/index.ts from useKeyboard.web.ts.
 */
import { useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const useKeyboard = (onKeyPress: (key: string) => void) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      
      // Map physical keys to logical keys
      const keyMap: Record<string, string> = {
        'Digit0': '0', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4',
        'Digit5': '5', 'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9',
        'Numpad0': '0', 'Numpad1': '1', 'Numpad2': '2', 'Numpad3': '3', 'Numpad4': '4',
        'Numpad5': '5', 'Numpad6': '6', 'Numpad7': '7', 'Numpad8': '8', 'Numpad9': '9',
        'NumpadAdd': '+', 'NumpadSubtract': '-', 'NumpadEnter': 'Enter', 
        'Enter': 'Enter', 'NumpadDecimal': '.', 'Period': '.',
        'ShiftLeft': 'Shift', 'ShiftRight': 'Shift', 'Backspace': 'Backspace',
        'NumpadMultiply': '*', 'Escape': 'Escape', 'Slash': '/', 'NumpadDivide': '/'
      }

      const mappedKey = keyMap[e.code] || e.key
      
      // Only allow numeric keypad keys and specific control keys
      const allowedKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 
                          '.', '+', '-', 'Enter', 'Shift', 'Backspace', '*', 'Escape', '/']
      
      if (allowedKeys.includes(mappedKey)) {
        onKeyPress(mappedKey)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onKeyPress])
} 