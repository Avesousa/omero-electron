import { describe, expect, it, vi } from 'vitest'
import { READY_EXPRESSION, waitForAppReady } from './app-ready'

function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => { t += ms } }
}

describe('waitForAppReady', () => {
  it('devuelve ready en cuanto la página marca el atributo', async () => {
    const c = clock()
    const evaluate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true)
    expect(await waitForAppReady({ evaluate, ...c })).toBe('ready')
    expect(evaluate).toHaveBeenCalledTimes(3)
    expect(evaluate).toHaveBeenCalledWith(READY_EXPRESSION)
  })

  it('tolera que evaluar falle mientras la página navega', async () => {
    const c = clock()
    const evaluate = vi.fn().mockRejectedValueOnce(new Error('navegando')).mockResolvedValue(true)
    expect(await waitForAppReady({ evaluate, ...c })).toBe('ready')
  })

  it('si la página nunca avisa devuelve timeout (no espera para siempre)', async () => {
    const c = clock()
    const evaluate = vi.fn().mockResolvedValue(false)
    expect(await waitForAppReady({ evaluate, timeoutMs: 1000, intervalMs: 100, ...c })).toBe('timeout')
    expect(evaluate).toHaveBeenCalledTimes(10)
  })

  it('usa los relojes reales por defecto', async () => {
    expect(await waitForAppReady({ evaluate: async () => true })).toBe('ready')
    expect(await waitForAppReady({ evaluate: async () => false, timeoutMs: 20, intervalMs: 5 })).toBe('timeout')
  })
})
