import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let auth = { isLoading: true }
let theme = { settled: false }
vi.mock('@/shared', () => ({ useAuth: () => auth }))
vi.mock('./ThemeProvider', () => ({ useTheme: () => theme }))

import { AppReadyMarker, APP_READY_ATTR } from './AppReadyMarker'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  document.documentElement.removeAttribute(APP_READY_ATTR)
})
afterEach(() => vi.useRealTimers())

describe('<AppReadyMarker />', () => {
  it('no marca mientras la sesión o el tema siguen resolviéndose', () => {
    auth = { isLoading: true }; theme = { settled: true }
    const { rerender } = render(<AppReadyMarker />)
    vi.advanceTimersByTime(100)
    expect(document.documentElement.hasAttribute(APP_READY_ATTR)).toBe(false)
    auth = { isLoading: false }; theme = { settled: false }
    rerender(<AppReadyMarker />)
    vi.advanceTimersByTime(100)
    expect(document.documentElement.hasAttribute(APP_READY_ATTR)).toBe(false)
  })

  it('marca <html> cuando sesión y tema están listos (tras pintar)', () => {
    auth = { isLoading: false }; theme = { settled: true }
    render(<AppReadyMarker />)
    expect(document.documentElement.hasAttribute(APP_READY_ATTR)).toBe(false)
    vi.advanceTimersByTime(100)
    expect(document.documentElement.getAttribute(APP_READY_ATTR)).toBe('1')
  })

  it('desmontar cancela el marcado pendiente', () => {
    auth = { isLoading: false }; theme = { settled: true }
    const { unmount } = render(<AppReadyMarker />)
    unmount()
    vi.advanceTimersByTime(100)
    expect(document.documentElement.hasAttribute(APP_READY_ATTR)).toBe(false)
  })
})
