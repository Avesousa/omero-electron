import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { FlushLock, flushLegacyQueue, importLegacyQueue, migrateLegacyQueue, useOfflineQueue } from '../useOfflineQueue'
import { loadQueue, saveQueue, type QueuedPurchase } from '@/lib/purchaseQueueStorage'
import * as session from '@/lib/sessionManager'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const OTHER = '11111111-2222-3333-4444-555555555555'

const item = (id: string, tenantId: string | null = TENANT): QueuedPurchase => ({
  id,
  ...(tenantId ? { tenantId } : {}),
  queuedAt: '2026-01-01T10:00:00.000Z',
  payload: { items: [{ productId: '001', quantity: 1, unitPrice: 10, total: 10, promotionId: null, promotionName: null }], cashAmount: 10, mpAmount: 0, change: 0 },
})
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 })
const fail = (status = 500) => new Response(JSON.stringify({ success: false, error: 'boom' }), { status })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(session, 'getSessionUser').mockReturnValue({ tenantId: TENANT } as ReturnType<typeof session.getSessionUser>)
  vi.spyOn(session, 'authHeaders').mockReturnValue({})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  FlushLock.release()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('FlushLock', () => {
  it('acquire / release', () => {
    expect(FlushLock.isLocked()).toBe(false)
    FlushLock.acquire()
    expect(FlushLock.isLocked()).toBe(true)
    FlushLock.release()
    expect(FlushLock.isLocked()).toBe(false)
  })
})

describe('flushLegacyQueue (web / sin outbox)', () => {
  it('sube en orden y borra cada una al confirmarse', async () => {
    saveQueue([item('a'), item('b')])
    fetchMock.mockImplementation(async () => ok({ id: 1 })) // una Response nueva por llamada
    expect(await flushLegacyQueue(TENANT)).toBe(2)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/sales', '/api/sales'])
    expect(loadQueue()).toEqual([])
  })

  it('se detiene en el primer error y deja el resto intacto (servidor o red)', async () => {
    saveQueue([item('a'), item('b'), item('c')])
    fetchMock.mockResolvedValueOnce(ok({})).mockResolvedValueOnce(fail())
    expect(await flushLegacyQueue(TENANT)).toBe(1)
    expect(loadQueue().map((i) => i.id)).toEqual(['b', 'c'])

    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect(await flushLegacyQueue(TENANT)).toBe(0)
    expect(loadQueue()).toHaveLength(2)
  })

  it('no toca ítems de otro tenant ni sin tenant', async () => {
    saveQueue([item('x', OTHER), item('y', null)])
    expect(await flushLegacyQueue(TENANT)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loadQueue()).toHaveLength(2)
  })
})

describe('importLegacyQueue (desktop)', () => {
  it('envía solo los del tenant al outbox y borra únicamente lo confirmado', async () => {
    saveQueue([item('a'), item('b'), item('other', OTHER)])
    fetchMock.mockResolvedValueOnce(ok({ available: true, imported: ['a'], rejected: [{ id: 'b', reason: 'x' }] }))
    expect(await importLegacyQueue(TENANT)).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/_local/outbox/import')
    expect(JSON.parse(init.body).items.map((i: QueuedPurchase) => i.id)).toEqual(['a', 'b'])
    expect(loadQueue().map((i) => i.id)).toEqual(['b', 'other']) // el rechazado y el ajeno se conservan
  })

  it('cola vacía: no llama al servidor', async () => {
    expect(await importLegacyQueue(TENANT)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('outbox no disponible → null (hay que subir directo) sin borrar nada', async () => {
    saveQueue([item('a')])
    fetchMock.mockResolvedValueOnce(ok({ available: false, imported: [] }))
    expect(await importLegacyQueue(TENANT)).toBeNull()
    expect(loadQueue()).toHaveLength(1)
  })

  it('error transitorio → 0 y la cola queda para el próximo inicio', async () => {
    saveQueue([item('a')])
    fetchMock.mockRejectedValueOnce(new TypeError('x'))
    expect(await importLegacyQueue(TENANT)).toBe(0)
    fetchMock.mockResolvedValueOnce(fail(500))
    expect(await importLegacyQueue(TENANT)).toBeNull()
    expect(loadQueue()).toHaveLength(1)
  })
})

describe('migrateLegacyQueue', () => {
  it('desktop: importa; si el outbox no está disponible sube directo', async () => {
    saveQueue([item('a')])
    fetchMock
      .mockResolvedValueOnce(ok({ available: false, imported: [] })) // import
      .mockResolvedValueOnce(ok({ id: 1 })) // /api/sales
    await migrateLegacyQueue('desktop', TENANT)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/_local/outbox/import', '/api/sales'])
    expect(loadQueue()).toEqual([])
  })

  it('web: sube directo sin tocar el outbox local', async () => {
    saveQueue([item('a')])
    fetchMock.mockResolvedValueOnce(ok({ id: 1 }))
    await migrateLegacyQueue('web', TENANT)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/sales'])
  })

  it('sin tenant o con el candado tomado no hace nada', async () => {
    saveQueue([item('a')])
    await migrateLegacyQueue('web', undefined)
    FlushLock.acquire()
    await migrateLegacyQueue('web', TENANT)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('nunca lanza y libera el candado aunque algo falle', async () => {
    saveQueue([item('a')])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    fetchMock.mockResolvedValueOnce(ok({ id: 1 }))
    await expect(migrateLegacyQueue('web', TENANT)).resolves.toBeUndefined()
    expect(FlushLock.isLocked()).toBe(false)
  })
})

describe('useOfflineQueue', () => {
  it('espera al runtime, migra UNA vez y refleja lo que queda', async () => {
    saveQueue([item('a'), item('b')])
    fetchMock.mockResolvedValueOnce(ok({ id: 1 })).mockResolvedValueOnce(fail())
    const { result, rerender } = renderHook(({ runtime }) => useOfflineQueue(runtime), {
      initialProps: { runtime: null as 'web' | 'desktop' | null },
    })
    expect(result.current.legacyPending).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()

    rerender({ runtime: 'web' })
    await waitFor(() => expect(result.current.legacyPending).toBe(1))
    rerender({ runtime: 'desktop' }) // no vuelve a migrar
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
