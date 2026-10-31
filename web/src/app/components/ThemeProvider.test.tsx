import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadDeviceTheme = vi.fn()
const saveTheme = vi.fn(async () => {})
vi.mock('@/lib/uiPrefs', async (orig) => ({
  ...(await orig<typeof import('@/lib/uiPrefs')>()),
  loadDeviceTheme: () => loadDeviceTheme(),
  saveTheme: (t: string) => saveTheme(t),
}))

import { ThemeProvider, useTheme } from './ThemeProvider'

function Probe() {
  const { theme, toggle, settled } = useTheme()
  return <button onClick={toggle} data-testid="t">{theme}|{String(settled)}</button>
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.setAttribute('data-theme', 'light')
  loadDeviceTheme.mockReset()
  saveTheme.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('<ThemeProvider />', () => {
  it('restaura el tema oscuro guardado en el dispositivo y lo aplica al <html>', async () => {
    loadDeviceTheme.mockResolvedValue('dark')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    await waitFor(() => expect(screen.getByTestId('t')).toHaveTextContent('dark|true'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('omero-theme-v2')).toBe('dark')
    expect(saveTheme).not.toHaveBeenCalled() // restaurar no reescribe el archivo
  })

  it('sin tema guardado queda el que ya tenía (claro) y marca settled', async () => {
    loadDeviceTheme.mockResolvedValue(null)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    await waitFor(() => expect(screen.getByTestId('t')).toHaveTextContent('light|true'))
  })

  it('al alternar persiste la elección', async () => {
    loadDeviceTheme.mockResolvedValue(null)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    await waitFor(() => expect(screen.getByTestId('t')).toHaveTextContent('true'))
    fireEvent.click(screen.getByTestId('t'))
    expect(saveTheme).toHaveBeenCalledWith('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('si localStorage falla al restaurar, igual aplica el tema', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('x') })
    loadDeviceTheme.mockResolvedValue('dark')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    await waitFor(() => expect(screen.getByTestId('t')).toHaveTextContent('dark|true'))
  })

  it('desmontar antes de que responda no actualiza nada', async () => {
    let resolve!: (v: string) => void
    loadDeviceTheme.mockReturnValue(new Promise(r => { resolve = r }))
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>)
    unmount()
    await act(async () => { resolve('dark') })
    expect(localStorage.getItem('omero-theme-v2')).toBeNull()
  })
})
