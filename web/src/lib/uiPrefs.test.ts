import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDeviceTheme, saveTheme, THEME_STORAGE_KEY } from './uiPrefs'

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('tema del dispositivo (renderer)', () => {
  it('desktop: lee el tema guardado en el archivo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ success: true, data: { available: true, theme: 'dark' } }))
    expect(await loadDeviceTheme()).toBe('dark')
  })

  it.each([
    ['web (available:false)', { success: true, data: { available: false } }],
    ['sin tema guardado', { success: true, data: { available: true } }],
    ['tema inválido', { success: true, data: { available: true, theme: 'neon' } }],
    ['respuesta de error', { success: false }],
  ])('%s → null', async (_n, body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(body))
    expect(await loadDeviceTheme()).toBeNull()
  })

  it('servidor local caído o respuesta no JSON → null, sin lanzar', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    expect(await loadDeviceTheme()).toBeNull()
    f.mockResolvedValue(new Response('<html>', { status: 500 }))
    expect(await loadDeviceTheme()).toBeNull()
  })

  it('un servidor colgado no bloquea: se aborta por timeout', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))
    }))
    const p = loadDeviceTheme()
    await vi.advanceTimersByTimeAsync(2_100)
    expect(await p).toBeNull()
    vi.useRealTimers()
  })

  it('saveTheme: guarda en localStorage y avisa al servidor local', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ success: true, data: { available: true, saved: true } }))
    await saveTheme('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(f).toHaveBeenCalledWith('/api/_local/ui-prefs', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ theme: 'dark' }) }))
  })

  it('saveTheme nunca lanza (sin servidor ni storage)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cuota') })
    await expect(saveTheme('light')).resolves.toBeUndefined()
  })
})
