import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backoffDelay, startMpEvents, type TicketResult } from './mpEvents'

class FakeSource {
  static all: FakeSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  listeners: Record<string, (e: MessageEvent) => void> = {}
  constructor(public url: string) {
    FakeSource.all.push(this)
  }
  addEventListener(t: string, cb: (e: MessageEvent) => void) {
    this.listeners[t] = cb
  }
  close() {
    this.closed = true
  }
  emit(t: string, data: string) {
    this.listeners[t]?.({ data } as MessageEvent)
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

function setup(tickets: TicketResult[]) {
  const fetchTicket = vi.fn(async () => tickets.shift() ?? ({ ok: false } as TicketResult))
  const cb = { onOpen: vi.fn(), onClose: vi.fn(), onStatus: vi.fn(), onPayment: vi.fn() }
  const stop = startMpEvents({
    backendUrl: 'http://api',
    fetchTicket,
    ...cb,
    createSource: (u) => new FakeSource(u) as unknown as EventSource,
    random: () => 0.5, // jitter neutro
  })
  return { fetchTicket, cb, stop }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSource.all = []
})
afterEach(() => vi.useRealTimers())

describe('backoffDelay', () => {
  it('crece exponencialmente y topa en 60 s', () => {
    const r = () => 0.5
    expect([0, 1, 2, 3].map((n) => backoffDelay(n, r))).toEqual([1000, 2000, 4000, 8000])
    expect(backoffDelay(20, r)).toBe(60000)
    expect(backoffDelay(20, () => 1)).toBe(60000)
  })
})

describe('startMpEvents', () => {
  it('conecta con el ticket en la URL (escapado) y entrega eventos', async () => {
    const { cb } = setup([{ ok: true, ticket: 'a b/c' }])
    await flush()
    expect(FakeSource.all[0].url).toBe('http://api/api/mercadopago/events?ticket=a%20b%2Fc')
    FakeSource.all[0].onopen?.()
    expect(cb.onOpen).toHaveBeenCalled()
    FakeSource.all[0].emit('status', '{"connected":true}')
    FakeSource.all[0].emit('payment', '{"id":1}')
    FakeSource.all[0].emit('payment', 'no-json')
    expect(cb.onStatus).toHaveBeenCalledWith({ connected: true })
    expect(cb.onPayment).toHaveBeenCalledTimes(1)
  })

  it('onerror: cierra la fuente y reconecta con ticket nuevo tras backoff; se resetea al abrir', async () => {
    const { fetchTicket } = setup([
      { ok: true, ticket: 't1' },
      { ok: true, ticket: 't2' },
      { ok: true, ticket: 't3' },
    ])
    await flush()
    FakeSource.all[0].onerror?.()
    expect(FakeSource.all[0].closed).toBe(true)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchTicket).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchTicket).toHaveBeenCalledTimes(2)
    expect(FakeSource.all[1].url).toContain('ticket=t2')

    // segundo fallo: 2 s
    FakeSource.all[1].onerror?.()
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchTicket).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchTicket).toHaveBeenCalledTimes(3)

    // abre → reset: el próximo fallo vuelve a 1 s
    FakeSource.all[2].onopen?.()
    FakeSource.all[2].onerror?.()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchTicket).toHaveBeenCalledTimes(4)
  })

  it('ticket fallido: onClose y reintento con backoff', async () => {
    const { fetchTicket, cb } = setup([{ ok: false }, { ok: true, ticket: 'x' }])
    await flush()
    expect(cb.onClose).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchTicket).toHaveBeenCalledTimes(2)
    expect(FakeSource.all).toHaveLength(1)
  })

  it('sin permiso (403): no reintenta antes del backoff máximo', async () => {
    const { fetchTicket } = setup([{ ok: false, forbidden: true }])
    await flush()
    await vi.advanceTimersByTimeAsync(59_000)
    expect(fetchTicket).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchTicket).toHaveBeenCalledTimes(2)
  })

  it('stop: cierra la fuente y cancela reconexiones pendientes', async () => {
    const { fetchTicket, stop } = setup([{ ok: true, ticket: 't1' }])
    await flush()
    FakeSource.all[0].onerror?.()
    stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchTicket).toHaveBeenCalledTimes(1)

    const s2 = setup([{ ok: true, ticket: 'z' }])
    await flush()
    s2.stop()
    expect(FakeSource.all[1].closed).toBe(true)
  })

  it('stop mientras se pide el ticket: no abre la fuente', async () => {
    let resolve!: (r: TicketResult) => void
    const fetchTicket = vi.fn(() => new Promise<TicketResult>((r) => (resolve = r)))
    const stop = startMpEvents({
      backendUrl: '', fetchTicket, onOpen: vi.fn(), onClose: vi.fn(), onStatus: vi.fn(), onPayment: vi.fn(),
      createSource: (u) => new FakeSource(u) as unknown as EventSource,
    })
    stop()
    resolve({ ok: true, ticket: 't' })
    await flush()
    expect(FakeSource.all).toHaveLength(0)
  })
})
