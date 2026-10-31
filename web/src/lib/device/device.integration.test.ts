// @vitest-environment node
/**
 * Integración de la sesión de la caja (fase 4) contra un backend HTTP REAL (falso, con el contrato de la tech-spec:
 * login con device, refresh con rotación, sync-token, logout, batch con scope) y SQLite real.
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as refreshRoute } from '../../app/api/%5Flocal/session/refresh/route'
import { DELETE as sessionDelete } from '../../app/api/%5Flocal/session/route'
import { handleApiRequest } from '../data-layer'
import { closeAllCatalogStores } from '../catalog/store-registry'
import { getSyncer } from '../catalog/syncer'
import { closeAllOutboxStores, getOutboxStore } from '../outbox/outbox-registry'
import { getSender, resetSender } from '../outbox/outbox-sender'
import { resetDeviceSession } from './device-session'
import { getDeviceState, resetDeviceState } from './device-state'
import { resetTokenProvider } from './token-provider'
import { resetWiring } from './device-wiring'

const TENANT_A = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const TENANT_B = '11111111-2222-3333-4444-555555555555'
const DEVICE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** JWT "del backend": el POS solo lee tenantId/exp; el backend falso valida scope y vencimiento. */
function jwt(tenantId: string, expInSec: number, scope?: 'pos' | 'sync'): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64({ tenantId, userId: 'u1', sub: 'a@x.com', exp: Math.floor(Date.now() / 1000) + expInSec, ...(scope ? { scope } : {}) })}.sig`
}

// ── backend falso ────────────────────────────────────────────────────────────
type Mode = 'ok' | 'down'
const backend = {
  mode: 'ok' as Mode,
  /** deviceSecret vigente por caja: secret → tenant */
  secrets: new Map<string, string>(),
  revoked: false,
  windowClosed: false,
  logoutSession: false,
  seq: 0,
  calls: [] as string[],
  batches: [] as { auth: string; scope: string | null; ids: string[] }[],
  created: new Set<string>(),
}

function newSecret(tenant: string): string {
  const s = `${DEVICE_ID}.SECRET-${tenant.slice(0, 4)}-${++backend.seq}`
  for (const [k, v] of backend.secrets) if (v === tenant) backend.secrets.delete(k) // rota: el anterior deja de valer
  backend.secrets.set(s, tenant)
  return s
}
const claimsOf = (auth: string | undefined) => {
  try {
    return JSON.parse(Buffer.from((auth ?? '').replace('Bearer ', '').split('.')[1], 'base64url').toString('utf8')) as { tenantId: string; exp: number; scope?: string }
  } catch {
    return null
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://backend')
  const chunks: Buffer[] = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    }
    backend.calls.push(`${req.method} ${url.pathname}`)
    if (backend.mode === 'down') return json(502, { success: false, error: 'down' })

    if (url.pathname === '/api/auth/login') {
      const tenant = body.email.startsWith('b@') ? TENANT_B : TENANT_A
      if (backend.revoked && body.device) return json(403, { success: false, error: 'Esta caja fue revocada', code: 'DEVICE_REVOKED' })
      backend.logoutSession = false
      return json(200, {
        success: true,
        data: {
          accessToken: jwt(tenant, 30), // JWT de login de vida corta: el test lo hace vencer enseguida
          refreshToken: 'web-refresh', user: { id: 'u1', email: body.email, tenantId: tenant, role: 'omero-admin', permissions: ['VENTAS_VER'] },
          ...(body.device ? { deviceSecret: newSecret(tenant) } : {}),
        },
      })
    }
    if (url.pathname.startsWith('/api/auth/device/')) {
      const tenant = backend.secrets.get(body.deviceSecret)
      if (!tenant) return json(401, { success: false, error: 'inválida', code: 'DEVICE_SECRET_INVALID' })
      const op = url.pathname.split('/').pop()
      if (op === 'refresh') {
        if (backend.revoked) return json(403, { success: false, error: 'revocada', code: 'DEVICE_REVOKED' })
        if (backend.logoutSession) return json(401, { success: false, error: 'login', code: 'LOGIN_REQUIRED' })
        return json(200, { success: true, data: { accessToken: jwt(tenant, 3600, 'pos'), expiresIn: 3600, deviceSecret: newSecret(tenant), deviceExpiresAt: 'x', user: { id: 'u1', name: 'Ana', email: 'a@x.com', role: 'omero-admin', tenantId: tenant, permissions: ['VENTAS_VER'] } } })
      }
      if (op === 'sync-token') {
        if (backend.windowClosed) return json(403, { success: false, error: 'cerrada', code: 'SYNC_WINDOW_CLOSED' })
        return json(200, { success: true, data: { accessToken: jwt(tenant, 3600, 'sync'), expiresIn: 3600 } })
      }
      if (op === 'logout') {
        backend.logoutSession = true
        return json(200, { success: true, data: null })
      }
    }
    if (url.pathname === '/api/sync/batch') {
      const c = claimsOf(req.headers.authorization)
      if (!c || c.exp * 1000 < Date.now()) return json(401, { success: false, error: 'vencido' })
      if (c.scope && c.scope !== 'pos' && c.scope !== 'sync') return json(403, { success: false })
      backend.batches.push({ auth: req.headers.authorization!, scope: c.scope ?? null, ids: body.items.map((i: { clientId: string }) => i.clientId) })
      const results = body.items.map((i: { clientId: string }) => {
        backend.created.add(i.clientId)
        return { clientId: i.clientId, status: 'CREATED', entityId: String(backend.created.size) }
      })
      return json(200, { success: true, data: { results } })
    }
    if (url.pathname === '/api/health') return json(200, { status: 'UP' })
    return json(404, { success: false })
  })
})

let dataDir: string
let backendUrl: string
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  backendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})

const persisted: { secrets: Record<string, { secret: string; sessionActive: boolean }> }[] = []
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-device-int-'))
  Object.assign(backend, { mode: 'ok', revoked: false, windowClosed: false, logoutSession: false, seq: 0, calls: [], batches: [], created: new Set() })
  backend.secrets.clear()
  persisted.length = 0
  vi.stubEnv('OMERO_RUNTIME', 'desktop')
  vi.stubEnv('BACKEND_URL', backendUrl)
  vi.stubEnv('OMERO_DATA_DIR', dataDir)
  vi.stubEnv('OMERO_DEVICE_ID', DEVICE_ID)
  vi.stubEnv('OMERO_DEVICE_NAME', 'MOSTRADOR')
  vi.stubEnv('OMERO_DEVICE_PERSIST', '1')
  vi.stubEnv('OMERO_DEVICE_SECRETS', '{}')
  ;(process as unknown as { parentPort?: unknown }).parentPort = { postMessage: (m: { secrets: (typeof persisted)[0]['secrets'] }) => persisted.push(m) }
  resetDeviceState()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  resetSender()
  resetTokenProvider()
  resetDeviceSession()
  resetDeviceState()
  resetWiring()
  getSyncer().stop()
  getSyncer().setRenewer(null)
  for (const t of [TENANT_A, TENANT_B]) getSyncer().forget(t)
  closeAllOutboxStores()
  closeAllCatalogStores()
  delete (process as unknown as { parentPort?: unknown }).parentPort
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const post = (p: string, body: unknown, auth?: string) =>
  new Request(`http://localhost:3000${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) })
const saleBody = () => ({ items: [{ productId: '001', productName: 'Coca', quantity: 1, unitPrice: 10, total: 10 }], cashAmount: 10, mpAmount: 0, change: 0 })

async function activate(email = 'a@x.com') {
  const res = await handleApiRequest(post('/api/auth/login', { email, password: 'pw' }))
  const data = (await res.json()).data
  return { jwt: data.accessToken as string, tenant: data.user.tenantId as string, raw: JSON.stringify(data) }
}
const sell = async (auth: string, tenant = TENANT_A) => {
  const res = await handleApiRequest(post('/api/sales', saleBody(), `Bearer ${auth}`))
  return (await res.json()).data.clientId as string
}
const row = (id: string, tenant = TENANT_A) => getOutboxStore(tenant)!.getByClientId(id)!
const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando la condición')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('activación', () => {
  it('el login registra la caja: el secreto queda en el Next (y se avisa a Electron) y NUNCA llega al renderer', async () => {
    const { raw } = await activate()
    expect(raw).not.toContain('deviceSecret')
    expect(raw).not.toContain('SECRET-')
    const stored = getDeviceState().get(TENANT_A)!
    expect(stored.secret).toMatch(/SECRET-/)
    expect(persisted.at(-1)!.secrets[TENANT_A].secret).toBe(stored.secret)
  })
})

describe('renovación silenciosa (el JWT de 1 h vence y nadie pide login)', () => {
  it('el outbox renueva con la caja antes de subir: el batch viaja con un JWT pos nuevo', async () => {
    const { jwt: shortLived } = await activate() // exp = 30 s < margen de 2 min → hay que renovar
    const id = await sell(shortLived)
    await until(() => row(id).status === 'SENT')
    expect(backend.calls).toContain('POST /api/auth/device/refresh')
    expect(backend.batches[0].scope).toBe('pos')
    expect(backend.batches[0].auth).not.toContain(shortLived)
  })

  it('el secreto ROTA en cada renovación y el nuevo se persiste; el anterior deja de valer', async () => {
    await activate()
    const first = getDeviceState().get(TENANT_A)!.secret
    const res = await refreshRoute(post('/api/_local/session/refresh', {}))
    expect(res.status).toBe(200)
    const second = getDeviceState().get(TENANT_A)!.secret
    expect(second).not.toBe(first)
    expect(persisted.at(-1)!.secrets[TENANT_A].secret).toBe(second)
    expect(backend.secrets.has(first)).toBe(false)
  })

  it('reinicio: un DeviceState cargado del env cifrado por Electron sigue renovando', async () => {
    await activate()
    await refreshRoute(post('/api/_local/session/refresh', {}))
    const saved = persisted.at(-1)!.secrets
    // "reinicio" del Next: se pierde la memoria, Electron vuelve a pasar los secretos descifrados por env
    resetSender(); resetTokenProvider(); resetDeviceSession(); resetDeviceState(); resetWiring()
    vi.stubEnv('OMERO_DEVICE_SECRETS', JSON.stringify(saved))
    const res = await refreshRoute(post('/api/_local/session/refresh', {}))
    expect(res.status).toBe(200)
  })

  it('el endpoint local devuelve el JWT y el usuario pero jamás el secreto', async () => {
    await activate()
    const res = await refreshRoute(post('/api/_local/session/refresh', {}))
    const text = await res.text()
    expect(JSON.parse(text).data.user.email).toBe('a@x.com')
    expect(text).not.toMatch(/SECRET-|deviceSecret/)
  })
})

describe('caja revocada: no opera pero sube lo pendiente', () => {
  it('refresh → 403 DEVICE_REVOKED y el outbox sube con el token de solo subida (scope sync)', async () => {
    const { jwt: shortLived } = await activate()
    backend.revoked = true
    expect((await refreshRoute(post('/api/_local/session/refresh', {}))).status).toBe(403)

    const id = await sell(shortLived)
    await until(() => row(id).status === 'SENT')
    expect(backend.calls).toContain('POST /api/auth/device/sync-token')
    expect(backend.batches[0].scope).toBe('sync')
  })

  it('el login de una caja revocada se rechaza con su code', async () => {
    backend.revoked = true
    const res = await handleApiRequest(post('/api/auth/login', { email: 'a@x.com', password: 'pw' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('DEVICE_REVOKED')
  })

  it('ventana de subida cerrada → el sender queda "unauthorized" y el outbox NO pierde nada', async () => {
    const { jwt: shortLived } = await activate()
    backend.revoked = true
    backend.windowClosed = true
    const id = await sell(shortLived)
    await until(() => getSender().state(TENANT_A).backend === 'unauthorized')
    expect(row(id).status).toBe('PENDING')
  })
})

describe('logout de la caja', () => {
  it('conserva el secreto: renovar exige login (LOGIN_REQUIRED) pero lo pendiente sigue subiendo (sync)', async () => {
    const { jwt: shortLived } = await activate()
    backend.mode = 'down'
    const id = await sell(shortLived)
    await until(() => getSender().state(TENANT_A).backend === 'offline')
    backend.mode = 'ok'

    expect((await sessionDelete(post('/api/_local/session', {}, `Bearer ${shortLived}`) as never)).status).toBe(204)
    expect(getDeviceState().get(TENANT_A)).toMatchObject({ sessionActive: false })
    const refresh = await refreshRoute(post('/api/_local/session/refresh', {}, `Bearer ${shortLived}`))
    expect(refresh.status).toBe(401)
    expect((await refresh.json()).code).toBe('LOGIN_REQUIRED')

    getSender().handleSyncerEvent({ type: 'online' })
    await until(() => row(id).status === 'SENT')
    expect(backend.batches.at(-1)!.scope).toBe('sync')
  })

  it('un nuevo login reactiva la sesión de la misma caja', async () => {
    await activate()
    await sessionDelete(post('/api/_local/session', {}) as never)
    await activate()
    expect(getDeviceState().get(TENANT_A)?.sessionActive).toBe(true)
    expect((await refreshRoute(post('/api/_local/session/refresh', {}))).status).toBe(200)
  })
})

describe('aislamiento y modos', () => {
  it('dos tenants en la misma máquina: cada uno usa SU secreto y SU outbox', async () => {
    const a = await activate('a@x.com')
    const b = await activate('b@x.com')
    expect(getDeviceState().get(TENANT_A)!.secret).not.toBe(getDeviceState().get(TENANT_B)!.secret)
    const ia = await sell(a.jwt)
    const ib = await sell(b.jwt, TENANT_B)
    await until(() => row(ia).status === 'SENT' && row(ib, TENANT_B).status === 'SENT')
    const claimsFor = (t: string) => backend.batches.filter((x) => claimsOf(x.auth)?.tenantId === t).flatMap((x) => x.ids)
    expect(claimsFor(TENANT_A)).toEqual([ia])
    expect(claimsFor(TENANT_B)).toEqual([ib])
  })

  it('web: el login no se intercepta ni se registra caja', async () => {
    vi.stubEnv('OMERO_RUNTIME', 'web')
    const res = await handleApiRequest(post('/api/auth/login', { email: 'a@x.com', password: 'pw' }))
    expect((await res.json()).data.deviceSecret).toBeUndefined()
    expect(getDeviceState().hasSecrets).toBe(false)
  })

  it('backend viejo (sin sesión de caja): el login funciona y todo sigue como en la fase 3', async () => {
    const original = backend.secrets
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () =>
      new Response(JSON.stringify({ success: true, data: { accessToken: jwt(TENANT_A, 3600), user: { tenantId: TENANT_A } } }), { status: 200 }))
    const res = await handleApiRequest(post('/api/auth/login', { email: 'a@x.com', password: 'pw' }))
    expect((await res.json()).data.accessToken).toBeTruthy()
    expect(getDeviceState().hasSecrets).toBe(false)
    expect(backend.secrets).toBe(original)
  })
})
