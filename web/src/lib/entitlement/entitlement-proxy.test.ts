// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const proxyToBackend = vi.fn()
vi.mock('../backend-proxy', () => ({ proxyToBackend: (r: Request) => proxyToBackend(r) }))

import { handleEntitlementRequest, isEntitlementRoute } from './entitlement-proxy'
import { readEntitlement, resetEntitlementMemory } from './store'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const DATA = {
  status: 'ACTIVE', accessGranted: true, accessUntil: '2026-11-01T00:00:00Z', trialEndsAt: null, graceUntil: null,
  planCode: 'PRO', courtesy: false, enforced: true, canManage: true,
}
const token = () => {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `Bearer ${b64({ alg: 'HS256' })}.${b64({ tenantId: TENANT })}.sig`
}
const req = (auth: string | null = token()) =>
  new Request('http://localhost:3000/api/billing/entitlement', { headers: auth ? { authorization: auth } : {} })
const ok = (body: unknown = { success: true, data: DATA }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '999' } })

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-ent-proxy-'))
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:9')
  vi.stubEnv('OMERO_DATA_DIR', dir)
  proxyToBackend.mockReset()
  resetEntitlementMemory()
})
afterEach(() => {
  vi.unstubAllEnvs()
  resetEntitlementMemory()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('isEntitlementRoute', () => {
  it.each([
    ['GET', '/api/billing/entitlement', true],
    ['get', '/api/billing/entitlement/', true],
    ['POST', '/api/billing/entitlement', false],
    ['GET', '/api/billing', false],
  ])('%s %s → %s', (m, p, expected) => expect(isEntitlementRoute(m, p)).toBe(expected))
})

describe('handleEntitlementRequest', () => {
  it('200: devuelve la respuesta tal cual y persiste el entitlement con fetchedAt', async () => {
    proxyToBackend.mockResolvedValue(ok())
    const res = await handleEntitlementRequest(req())
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(DATA)
    const cached = readEntitlement(TENANT)!
    expect(cached.entitlement).toEqual(DATA)
    expect(Math.abs(Date.parse(cached.fetchedAt) - Date.now())).toBeLessThan(5000)
  })

  it('sin conexión (502/503/504) con caché → 200 desde la caché con X-Omero-Cache y su fetchedAt', async () => {
    proxyToBackend.mockResolvedValueOnce(ok())
    await handleEntitlementRequest(req())
    const fetchedAt = readEntitlement(TENANT)!.fetchedAt

    for (const status of [502, 503, 504]) {
      proxyToBackend.mockResolvedValueOnce(new Response('{"success":false}', { status }))
      const res = await handleEntitlementRequest(req())
      expect(res.status).toBe(200)
      expect(res.headers.get('X-Omero-Cache')).toBe('hit')
      expect(res.headers.get('X-Omero-Cache-At')).toBe(fetchedAt)
      expect((await res.json()).data).toEqual(DATA)
    }
  })

  it('sin conexión y sin caché → pasa el error del proxy', async () => {
    proxyToBackend.mockResolvedValue(new Response('{"success":false}', { status: 502 }))
    expect((await handleEntitlementRequest(req())).status).toBe(502)
  })

  it('401/403/404 son respuestas reales: pasan y NO se sirve la caché', async () => {
    proxyToBackend.mockResolvedValueOnce(ok())
    await handleEntitlementRequest(req())
    for (const status of [401, 403, 404]) {
      proxyToBackend.mockResolvedValueOnce(new Response('{}', { status }))
      expect((await handleEntitlementRequest(req())).status).toBe(status)
    }
  })

  it('un 200 con forma inesperada pasa pero NO pisa la caché buena', async () => {
    proxyToBackend.mockResolvedValueOnce(ok())
    await handleEntitlementRequest(req())
    proxyToBackend.mockResolvedValueOnce(ok({ success: true, data: { raro: true } }))
    expect((await handleEntitlementRequest(req())).status).toBe(200)
    proxyToBackend.mockResolvedValueOnce(new Response('no json', { status: 200 }))
    expect((await handleEntitlementRequest(req())).status).toBe(200)
    expect(readEntitlement(TENANT)!.entitlement).toEqual(DATA)
  })

  it('sin tenant en el token → proxy directo sin caché', async () => {
    proxyToBackend.mockResolvedValue(ok())
    expect((await handleEntitlementRequest(req(null))).status).toBe(200)
    expect(readEntitlement(TENANT)).toBeNull()
  })

  describe('ETag propio y 304', () => {
    const withEtag = (etag: string | null = '"ent-1"') =>
      new Response(JSON.stringify({ success: true, data: DATA }), {
        status: 200,
        headers: { 'content-type': 'application/json', ...(etag ? { etag, 'cache-control': 'private, no-cache' } : {}) },
      })
    const sent = (n: number) => (proxyToBackend.mock.calls[n][0] as Request).headers.get('if-none-match')

    it('200: guarda el ETag, no lo expone y responde no-store', async () => {
      proxyToBackend.mockResolvedValue(withEtag())
      const res = await handleEntitlementRequest(req())
      expect(res.headers.get('etag')).toBeNull()
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('x-omero-cache')).toBeNull()
      expect(readEntitlement(TENANT)!.etag).toBe('"ent-1"')
      expect(sent(0)).toBeNull() // primer pedido: nada guardado, sin condicional
    })

    it('con ETag guardado manda el propio y el 304 se sirve como 200 con X-Omero-Cache: fresh y fetchedAt nuevo', async () => {
      proxyToBackend.mockResolvedValueOnce(withEtag())
      await handleEntitlementRequest(req())
      const before = readEntitlement(TENANT)!.fetchedAt
      await new Promise((r) => setTimeout(r, 5))
      proxyToBackend.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"ent-1"' } }))
      const res = await handleEntitlementRequest(req())
      expect(sent(1)).toBe('"ent-1"')
      expect(res.status).toBe(200)
      expect(res.headers.get('x-omero-cache')).toBe('fresh')
      expect(res.headers.get('etag')).toBeNull()
      expect((await res.json()).data).toEqual(DATA)
      const after = readEntitlement(TENANT)!
      expect(Date.parse(after.fetchedAt)).toBeGreaterThan(Date.parse(before))
      expect(after.etag).toBe('"ent-1"') // el ETag se conserva
    })

    it('el If-None-Match del navegador se descarta (sin ETag propio no se manda nada)', async () => {
      proxyToBackend.mockImplementation(async () => withEtag())
      await handleEntitlementRequest(
        new Request('http://localhost:3000/api/billing/entitlement', { headers: { authorization: token(), 'if-none-match': '"ajeno"' } }),
      )
      expect(sent(0)).toBeNull()
      await handleEntitlementRequest(
        new Request('http://localhost:3000/api/billing/entitlement', { headers: { authorization: token(), 'if-none-match': '"ajeno"' } }),
      )
      expect(sent(1)).toBe('"ent-1"')
    })

    it('200 sin ETag (backend viejo) borra el guardado', async () => {
      proxyToBackend.mockResolvedValueOnce(withEtag())
      await handleEntitlementRequest(req())
      proxyToBackend.mockResolvedValueOnce(withEtag(null))
      await handleEntitlementRequest(req())
      expect(readEntitlement(TENANT)!.etag).toBeUndefined()
      proxyToBackend.mockResolvedValueOnce(withEtag(null))
      await handleEntitlementRequest(req())
      expect(sent(2)).toBeNull()
    })

    it('un 304 sin validador propio pasa como respuesta real', async () => {
      proxyToBackend.mockResolvedValueOnce(withEtag())
      await handleEntitlementRequest(req())
      resetEntitlementMemory()
      fs.rmSync(path.join(dir, `${TENANT}.entitlement.json`))
      // hay validador en memoria vacía → no se manda; simulamos un 304 inesperado sin validador: pasa como respuesta real
      proxyToBackend.mockResolvedValueOnce(new Response(null, { status: 304 }))
      expect((await handleEntitlementRequest(req())).status).toBe(304)
    })

    it('sin conexión sigue siendo hit (nunca fresh) aun con ETag guardado', async () => {
      proxyToBackend.mockResolvedValueOnce(withEtag())
      await handleEntitlementRequest(req())
      proxyToBackend.mockResolvedValueOnce(new Response('{}', { status: 503 }))
      const res = await handleEntitlementRequest(req())
      expect(res.headers.get('x-omero-cache')).toBe('hit')
    })

    it('un 304 cuando el almacén no puede persistir pide el entitlement completo', async () => {
      proxyToBackend.mockResolvedValueOnce(withEtag())
      await handleEntitlementRequest(req())
      vi.stubEnv('OMERO_RUNTIME', 'web') // touch devuelve null (sin disco) pero la memoria aún tiene el ETag
      proxyToBackend.mockResolvedValueOnce(new Response(null, { status: 304 })).mockResolvedValueOnce(withEtag())
      const res = await handleEntitlementRequest(req())
      expect(res.status).toBe(200)
      expect(sent(2)).toBeNull()
    })
  })
})
