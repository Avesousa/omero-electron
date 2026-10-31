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
})
