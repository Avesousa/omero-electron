// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogSyncer, getSyncer, RECOVERY_INTERVAL_MS } from './syncer'
import type { CatalogStore } from './types'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const INTERVAL = 5 * 60_000
const T0 = new Date('2026-01-01T10:00:00Z')

function jwt(exp?: number): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'HS256' })}.${b64({ tenantId: TENANT, ...(exp !== undefined ? { exp } : {}) })}.sig`
}
const validAuth = () => jwt(Math.floor(T0.getTime() / 1000) + 3600)

const PRODUCTS = { success: true, data: [{ id: 1, code: '001' }] }
const PROMOS = { success: true, data: [{ id: 'p1' }] }

function makeStore(): CatalogStore & { replaceProducts: ReturnType<typeof vi.fn>; replacePromotions: ReturnType<typeof vi.fn> } {
  return {
    tenantId: TENANT,
    replaceProducts: vi.fn(() => ({ written: true, itemCount: 1, lastSyncAt: '' })),
    replacePromotions: vi.fn(() => ({ written: true, itemCount: 1, lastSyncAt: '' })),
    upsertProduct: vi.fn(),
    getProducts: vi.fn(() => []),
    getPromotions: vi.fn(() => []),
    findProduct: vi.fn(() => null),
    getMeta: vi.fn(() => null),
    close: vi.fn(),
    wipe: vi.fn(),
  } as never
}

/** fetch simulado: /api/health, /api/products y /api/promotions con respuestas configurables. */
function makeFetch(state: { health: number | 'error'; products: number | 'error'; promotions?: number | 'error' }) {
  return vi.fn(async (input: string) => {
    const url = String(input)
    const pick = (v: number | 'error', body: unknown) => {
      if (v === 'error') throw new TypeError('fetch failed')
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: v })
    }
    if (url.endsWith('/api/health')) return pick(state.health, { status: 'UP' })
    if (url.endsWith('/api/products')) return pick(state.products, PRODUCTS)
    if (url.endsWith('/api/promotions')) return pick(state.promotions ?? state.products, PROMOS)
    return new Response('nope', { status: 404 })
  })
}

let store: ReturnType<typeof makeStore>
let log: ReturnType<typeof vi.fn>

function syncer(fetchFn: ReturnType<typeof makeFetch>, getStore: (t: string) => CatalogStore | null = () => store) {
  return new CatalogSyncer({
    fetchFn: fetchFn as unknown as typeof fetch,
    getStore,
    backendUrl: () => 'https://backend.test',
    intervalMs: () => INTERVAL,
    now: () => Date.now(),
    log,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  store = makeStore()
  log = vi.fn()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('sincronización periódica', () => {
  it('no sincroniza antes del intervalo y sincroniza a los 5 min con el token del tenant', async () => {
    const fetchFn = makeFetch({ health: 200, products: 200 })
    const s = syncer(fetchFn)
    const auth = validAuth()
    s.remember(TENANT, auth)

    await vi.advanceTimersByTimeAsync(INTERVAL - 1000)
    expect(fetchFn).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    const urls = fetchFn.mock.calls.map((c) => String(c[0]))
    expect(urls).toEqual(['https://backend.test/api/products', 'https://backend.test/api/promotions'])
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: auth })
    expect(store.replaceProducts).toHaveBeenCalledWith(PRODUCTS.data)
    expect(store.replacePromotions).toHaveBeenCalledWith(PROMOS.data)
    expect(s.online).toBe(true)
    expect(s.inRecovery).toBe(false)
    s.stop()
  })

  it('repite cada intervalo', async () => {
    const fetchFn = makeFetch({ health: 200, products: 200 })
    const s = syncer(fetchFn)
    s.remember(TENANT, validAuth())
    await vi.advanceTimersByTimeAsync(INTERVAL * 2 + 10)
    expect(store.replaceProducts).toHaveBeenCalledTimes(2)
    s.stop()
  })

  it('remember() reemplaza el token: se usa siempre el último', async () => {
    const fetchFn = makeFetch({ health: 200, products: 200 })
    const s = syncer(fetchFn)
    const viejo = validAuth()
    const nuevo = jwt(Math.floor(T0.getTime() / 1000) + 7200)
    s.remember(TENANT, viejo)
    s.remember(TENANT, nuevo)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: nuevo })
    s.stop()
  })

  it('sin store (sin caché) no llama al backend', async () => {
    const fetchFn = makeFetch({ health: 200, products: 200 })
    const s = syncer(fetchFn, () => null)
    s.remember(TENANT, validAuth())
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(fetchFn).not.toHaveBeenCalled()
    s.stop()
  })

  it('no ejecuta dos syncs superpuestos', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetchFn = vi.fn(async () => { await gate; return new Response(JSON.stringify(PRODUCTS)) })
    const s = syncer(fetchFn as never)
    s.remember(TENANT, validAuth())
    const a = s.syncAll()
    const b = s.syncAll() // mientras el primero sigue en curso
    release()
    await Promise.all([a, b])
    expect(fetchFn).toHaveBeenCalledTimes(2) // solo /products y /promotions del primer sync
    s.stop()
  })
})

describe('tokens', () => {
  it('un token vencido se olvida sin llamar al backend', async () => {
    const fetchFn = makeFetch({ health: 200, products: 200 })
    const s = syncer(fetchFn)
    s.remember(TENANT, jwt(Math.floor(T0.getTime() / 1000) + 60)) // vence en 1 min
    await vi.advanceTimersByTimeAsync(INTERVAL) // a los 5 min ya venció
    expect(fetchFn).not.toHaveBeenCalled()
    expect(s.hasTenant(TENANT)).toBe(false)
  })

  it('un JWT sin exp igual se usa hasta recibir 401', async () => {
    const fetchFn = makeFetch({ health: 200, products: 200 })
    const s = syncer(fetchFn)
    s.remember(TENANT, jwt(undefined))
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(fetchFn).toHaveBeenCalled()
    s.stop()
  })

  it.each([401, 403])('un %i del backend olvida el token y detiene los timers', async (code) => {
    const fetchFn = makeFetch({ health: 200, products: code })
    const s = syncer(fetchFn)
    s.remember(TENANT, validAuth())
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(s.hasTenant(TENANT)).toBe(false)
    expect(store.replaceProducts).not.toHaveBeenCalled()
    fetchFn.mockClear()
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(fetchFn).not.toHaveBeenCalled() // sin tenants no hay timer
  })

  it('forget() de un tenant que no existe no falla', () => {
    const s = syncer(makeFetch({ health: 200, products: 200 }))
    expect(() => s.forget('otro')).not.toThrow()
  })

  it('nunca escribe el Authorization en los logs', async () => {
    const fetchFn = makeFetch({ health: 200, products: 'error' })
    const s = syncer(fetchFn)
    const auth = validAuth()
    s.remember(TENANT, auth)
    await vi.advanceTimersByTimeAsync(INTERVAL)
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).not.toContain(auth)
    expect(logged).not.toContain(auth.replace('Bearer ', ''))
    s.stop()
  })
})

describe('modo recuperación', () => {
  it('tras un fallo entra en recuperación; sondea /api/health cada 30 s y sincroniza al volver', async () => {
    const state = { health: 'error' as number | 'error', products: 'error' as number | 'error' }
    const fetchFn = makeFetch(state)
    const s = syncer(fetchFn)
    s.remember(TENANT, validAuth())

    await vi.advanceTimersByTimeAsync(INTERVAL) // el sync falla
    expect(s.online).toBe(false)
    expect(s.inRecovery).toBe(true)

    // sigue caído: sondea pero no sincroniza
    fetchFn.mockClear()
    await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS)
    expect(fetchFn.mock.calls.map((c) => String(c[0]))).toEqual(['https://backend.test/api/health'])
    expect(store.replaceProducts).not.toHaveBeenCalled()

    // vuelve la conexión: el siguiente sondeo detecta y sincroniza de inmediato
    state.health = 200
    state.products = 200
    await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS)
    expect(store.replaceProducts).toHaveBeenCalledTimes(1)
    expect(s.online).toBe(true)
    expect(s.inRecovery).toBe(false)
    s.stop()
  })

  it.each([500, 503])('un %i del backend en el sync también dispara recuperación', async (code) => {
    const s = syncer(makeFetch({ health: 200, products: code }))
    s.remember(TENANT, validAuth())
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(s.inRecovery).toBe(true)
    s.stop()
  })

  it('una respuesta 200 con forma inválida cuenta como fallo y no toca la caché', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ success: true, data: 'no-es-lista' })))
    const s = syncer(fetchFn as never)
    s.remember(TENANT, validAuth())
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(store.replaceProducts).not.toHaveBeenCalled()
    expect(s.inRecovery).toBe(true)
    s.stop()
  })

  it('un error inesperado se loguea y no rompe el timer', async () => {
    const s = syncer(makeFetch({ health: 200, products: 200 }), () => { throw new Error('store roto') })
    s.remember(TENANT, validAuth())
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('store roto'))
    s.stop()
  })
})

describe('estado y ciclo de vida', () => {
  it('setOnline() es pasivo: no dispara sincronizaciones', async () => {
    const fetchFn = makeFetch({ health: 200, products: 200 })
    const s = syncer(fetchFn)
    expect(s.online).toBeNull()
    s.setOnline(false)
    expect(s.online).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('stop() limpia timers: no hay más syncs', async () => {
    const fetchFn = makeFetch({ health: 200, products: 200 })
    const s = syncer(fetchFn)
    s.remember(TENANT, validAuth())
    s.stop()
    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('start() es idempotente', async () => {
    const fetchFn = makeFetch({ health: 200, products: 200 })
    const s = syncer(fetchFn)
    s.remember(TENANT, validAuth())
    s.start()
    s.start()
    await vi.advanceTimersByTimeAsync(INTERVAL + 10)
    expect(store.replaceProducts).toHaveBeenCalledTimes(1)
    s.stop()
  })
})

describe('dependencias por defecto y singleton', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('con las dependencias por defecto (runtime web → sin store) usa el intervalo del entorno y no llama al backend', async () => {
    vi.stubEnv('OMERO_RUNTIME', 'web')
    vi.stubEnv('BACKEND_URL', 'https://b.test')
    vi.stubEnv('CATALOG_SYNC_INTERVAL_MS', '1000')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const s = new CatalogSyncer()
    s.remember(TENANT, validAuth())
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchSpy).not.toHaveBeenCalled() // el store por defecto es null en web
    s.stop()
  })

  it('getSyncer() devuelve siempre la misma instancia', () => {
    expect(getSyncer()).toBe(getSyncer())
  })
})
