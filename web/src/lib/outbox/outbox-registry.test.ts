// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAllOutboxStores, closeOutboxStore, getOutboxStore } from './outbox-registry'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const OTHER = '11111111-2222-3333-4444-555555555555'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-outbox-reg-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  closeAllOutboxStores()
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const env = (over: Record<string, string | undefined> = {}) => ({
  OMERO_RUNTIME: 'desktop',
  BACKEND_URL: 'http://b.test',
  OMERO_DATA_DIR: dir,
  ...over,
}) as unknown as NodeJS.ProcessEnv

describe('getOutboxStore', () => {
  it('desktop con OMERO_DATA_DIR: abre una vez por tenant y reutiliza el handle', () => {
    const a = getOutboxStore(TENANT, env())
    expect(a).not.toBeNull()
    expect(getOutboxStore(TENANT, env())).toBe(a)
    expect(getOutboxStore(OTHER, env())).not.toBe(a)
    expect(fs.existsSync(path.join(dir, `${TENANT}.outbox.sqlite`))).toBe(true)
  })

  it('web → null (jamás se carga el módulo nativo)', () => {
    const loader = vi.fn()
    expect(getOutboxStore(TENANT, env({ OMERO_RUNTIME: 'web' }), loader)).toBeNull()
    expect(loader).not.toHaveBeenCalled()
  })

  it('entorno inválido → null', () => {
    expect(getOutboxStore(TENANT, env({ OMERO_RUNTIME: undefined }))).toBeNull()
  })

  it('sin OMERO_DATA_DIR en producción → null y avisa UNA sola vez', () => {
    const e = env({ OMERO_DATA_DIR: undefined, NODE_ENV: 'production' })
    expect(getOutboxStore(TENANT, e)).toBeNull()
    expect(getOutboxStore(TENANT, e)).toBeNull()
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('el módulo nativo no carga → null (degrada) y avisa una vez', () => {
    const loader = () => {
      throw new Error('ABI equivocado')
    }
    expect(getOutboxStore(TENANT, env(), loader as never)).toBeNull()
    expect(getOutboxStore(TENANT, env(), loader as never)).toBeNull()
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(String((console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('ABI equivocado')
  })
})

describe('closeOutboxStore', () => {
  it('cierra solo el handle (el archivo y sus datos sobreviven al logout) y se puede reabrir', () => {
    const store = getOutboxStore(TENANT, env())!
    const row = store.enqueue({ type: 'SALE', payload: '{"items":[]}' }).row
    closeOutboxStore(TENANT)
    expect(fs.existsSync(path.join(dir, `${TENANT}.outbox.sqlite`))).toBe(true)
    const reopened = getOutboxStore(TENANT, env())!
    expect(reopened).not.toBe(store)
    expect(reopened.getByClientId(row.clientId)?.status).toBe('PENDING')
  })

  it('cerrar un tenant sin abrir no falla', () => {
    expect(() => closeOutboxStore(OTHER)).not.toThrow()
  })
})
