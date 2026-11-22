// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readEntitlement, resetEntitlementMemory, touchEntitlement, writeEntitlement } from './store'
import type { Entitlement } from './rule'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const ent: Entitlement = {
  status: 'ACTIVE', accessGranted: true, accessUntil: '2026-11-01T00:00:00Z', trialEndsAt: null, graceUntil: null,
  planCode: 'PRO', courtesy: false, enforced: true, canManage: false,
}

let dir: string
let env: Record<string, string>
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-entitlement-'))
  env = { OMERO_RUNTIME: 'desktop', OMERO_DATA_DIR: dir }
  resetEntitlementMemory()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetEntitlementMemory()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('caché persistente del entitlement', () => {
  it('guarda con fetchedAt y sobrevive a un "reinicio" (memoria vacía, lee del disco)', () => {
    const saved = writeEntitlement(TENANT, ent, Date.parse('2026-10-10T12:00:00Z'), env)
    expect(saved).toEqual({ entitlement: ent, fetchedAt: '2026-10-10T12:00:00.000Z' })
    expect(fs.existsSync(path.join(dir, `${TENANT}.entitlement.json`))).toBe(true)

    resetEntitlementMemory()
    expect(readEntitlement(TENANT, env)).toEqual(saved)
  })

  it('no deja archivos temporales', () => {
    writeEntitlement(TENANT, ent, 0, env)
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('sin nada guardado → null', () => {
    expect(readEntitlement(TENANT, env)).toBeNull()
  })

  it('archivo corrupto o con forma inválida → null (y se pisa con la próxima escritura)', () => {
    const file = path.join(dir, `${TENANT}.entitlement.json`)
    fs.writeFileSync(file, '{no es json')
    expect(readEntitlement(TENANT, env)).toBeNull()
    fs.writeFileSync(file, JSON.stringify({ entitlement: { status: 1 }, fetchedAt: 'x' }))
    expect(readEntitlement(TENANT, env)).toBeNull()
    writeEntitlement(TENANT, ent, 0, env)
    resetEntitlementMemory()
    expect(readEntitlement(TENANT, env)?.entitlement).toEqual(ent)
  })

  it('aislamiento entre tenants', () => {
    writeEntitlement(TENANT, ent, 0, env)
    resetEntitlementMemory()
    expect(readEntitlement('11111111-1111-1111-1111-111111111111', env)).toBeNull()
  })

  it('en modo web o sin directorio de datos no persiste ni lee', () => {
    expect(writeEntitlement(TENANT, ent, 0, { OMERO_RUNTIME: 'web', OMERO_DATA_DIR: dir })).toBeNull()
    expect(fs.readdirSync(dir)).toEqual([])
    expect(readEntitlement(TENANT, { OMERO_RUNTIME: 'desktop', NODE_ENV: 'production' })).toBeNull()
  })

  it('si el disco falla igual queda en memoria y no lanza', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const blocker = path.join(dir, 'archivo')
    fs.writeFileSync(blocker, 'x')
    const badEnv = { OMERO_RUNTIME: 'desktop', OMERO_DATA_DIR: path.join(blocker, 'sub') } // mkdir bajo un archivo → ENOTDIR
    expect(() => writeEntitlement(TENANT, ent, 0, badEnv)).not.toThrow()
    expect(readEntitlement(TENANT, badEnv)?.entitlement).toEqual(ent)
  })
})

describe('ETag del entitlement', () => {
  it('guarda el etag, sobrevive a un reinicio y sin etag se borra', () => {
    writeEntitlement(TENANT, ent, 0, env, '"e-1"')
    resetEntitlementMemory()
    expect(readEntitlement(TENANT, env)!.etag).toBe('"e-1"')
    writeEntitlement(TENANT, ent, 0, env)
    resetEntitlementMemory()
    expect(readEntitlement(TENANT, env)!.etag).toBeUndefined()
  })

  it('un archivo viejo (sin etag) se lee bien', () => {
    fs.writeFileSync(path.join(dir, `${TENANT}.entitlement.json`), JSON.stringify({ entitlement: ent, fetchedAt: '2026-10-10T12:00:00.000Z' }))
    expect(readEntitlement(TENANT, env)).toEqual({ entitlement: ent, fetchedAt: '2026-10-10T12:00:00.000Z' })
  })

  it('un etag que no es texto se ignora', () => {
    fs.writeFileSync(path.join(dir, `${TENANT}.entitlement.json`), JSON.stringify({ entitlement: ent, fetchedAt: '2026-10-10T12:00:00.000Z', etag: 5 }))
    expect(readEntitlement(TENANT, env)!.etag).toBeUndefined()
  })

  it('touchEntitlement renueva fetchedAt conservando el etag; sin nada guardado devuelve null', () => {
    expect(touchEntitlement(TENANT, 1, env)).toBeNull()
    writeEntitlement(TENANT, ent, Date.parse('2026-10-10T12:00:00Z'), env, '"e-1"')
    const touched = touchEntitlement(TENANT, Date.parse('2026-10-11T12:00:00Z'), env)!
    expect(touched).toEqual({ entitlement: ent, fetchedAt: '2026-10-11T12:00:00.000Z', etag: '"e-1"' })
    resetEntitlementMemory()
    expect(readEntitlement(TENANT, env)).toEqual(touched)
  })
})
