/**
 * Conexión SSE de Mercado Pago con ticket de un solo uso.
 *
 * Flujo: POST /api/mercadopago/events/ticket (JWT normal) → { ticket } → EventSource(?ticket=...).
 * El ticket es de un solo uso, así que la reconexión automática del EventSource fallaría (401):
 * en `onerror` se cierra la fuente y se reconecta pidiendo un ticket nuevo, con backoff
 * exponencial (1 s → 60 s, con jitter) que se resetea al abrir.
 */

export const MP_BACKOFF_BASE_MS = 1000
export const MP_BACKOFF_MAX_MS = 60_000

export type TicketResult =
  | { ok: true; ticket: string }
  | { ok: false; forbidden?: boolean }

export interface MpEventsOptions {
  backendUrl: string
  fetchTicket: () => Promise<TicketResult>
  onOpen: () => void
  onClose: () => void
  onStatus: (data: unknown) => void
  onPayment: (data: unknown) => void
  /** Inyectables para tests */
  createSource?: (url: string) => EventSource
  random?: () => number
}

/** Delay del intento N (0-based): 1 s, 2 s, 4 s… tope 60 s, con jitter ±20 %. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MP_BACKOFF_MAX_MS, MP_BACKOFF_BASE_MS * 2 ** Math.min(attempt, 10))
  const jittered = base * (0.8 + 0.4 * random())
  return Math.min(MP_BACKOFF_MAX_MS, Math.round(jittered))
}

/** Arranca la conexión y devuelve la función que cierra todo (fuente + timers). */
export function startMpEvents(opts: MpEventsOptions): () => void {
  const create = opts.createSource ?? ((url: string) => new EventSource(url))
  const random = opts.random ?? Math.random
  let stopped = false
  let attempt = 0
  let source: EventSource | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const parse = (raw: string): unknown => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined // evento malformado: se ignora
    }
  }

  const schedule = (forbidden = false) => {
    if (stopped) return
    // Sin permiso: no insistir en loop, ir directo al backoff máximo.
    const delay = forbidden ? MP_BACKOFF_MAX_MS : backoffDelay(attempt, random)
    attempt += 1
    timer = setTimeout(() => {
      timer = null
      void connect()
    }, delay)
  }

  const connect = async () => {
    if (stopped) return
    let result: TicketResult
    try {
      result = await opts.fetchTicket()
    } catch {
      result = { ok: false }
    }
    if (stopped) return
    if (!result.ok) {
      opts.onClose()
      schedule(result.forbidden)
      return
    }

    const es = create(`${opts.backendUrl}/api/mercadopago/events?ticket=${encodeURIComponent(result.ticket)}`)
    source = es

    es.onopen = () => {
      attempt = 0
      opts.onOpen()
    }
    es.onerror = () => {
      // Cerrar para evitar el auto-reconnect con un ticket ya consumido.
      es.close()
      if (source === es) source = null
      opts.onClose()
      schedule()
    }
    es.addEventListener('status', (e: Event) => {
      const data = parse((e as MessageEvent).data)
      if (data !== undefined) opts.onStatus(data)
    })
    es.addEventListener('payment', (e: Event) => {
      const data = parse((e as MessageEvent).data)
      if (data !== undefined) opts.onPayment(data)
    })
  }

  void connect()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
    source?.close()
    source = null
  }
}
