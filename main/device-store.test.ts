import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceStore, SecretsPersister, sanitize, type SafeStorageLike } from './device-store'

const T1 = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
const T2 = '11111111-2222-3333-4444-555555555555'
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** "Cifrado" reversible y reconocible: prueba que el archivo NO contiene el texto plano. */
const fakeSafeStorage = (over: Partial<SafeStorageLike> = {}): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').toString('base64').split('').reverse().join(''), 'utf8'),
  decryptString: (b) => Buffer.from(b.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8'),
  ...over,
})

let dir: string
let log: ReturnType<typeof vi.fn>
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-device-'))
  log = vi.fn()
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const store = (over: Partial<SafeStorageLike> = {}, extra: Partial<ConstructorParameters<typeof DeviceStore>[0]> = {}) =>
  new DeviceStore({ dir, safeStorage: fakeSafeStorage(over), newId: () => ID, log, now: () => 1234, ...extra })

describe('deviceId', () => {
  it('se crea una vez, se guarda en texto plano y es estable entre arranques', () => {
    expect(store().deviceId).toBe(ID)
    expect(fs.readFileSync(path.join(dir, 'device-id'), 'utf8')).toBe(ID)
    const other = new DeviceStore({ dir, safeStorage: fakeSafeStorage(), newId: () => 'ffffffff-ffff-ffff-ffff-ffffffffffff' })
    expect(other.deviceId).toBe(ID) // no se regenera
  })

  it('un archivo ilegible o con basura se reemplaza por un UUID nuevo', () => {
    fs.writeFileSync(path.join(dir, 'device-id'), 'no-es-uuid')
    expect(store().deviceId).toBe(ID)
  })

  it('se cachea en memoria', () => {
    const s = store()
    s.deviceId
    fs.rmSync(path.join(dir, 'device-id'))
    expect(s.deviceId).toBe(ID)
  })

  it('crea el directorio si no existe', () => {
    const nested = path.join(dir, 'a', 'b')
    expect(new DeviceStore({ dir: nested, safeStorage: fakeSafeStorage(), newId: () => ID }).deviceId).toBe(ID)
  })
})

describe('persistent', () => {
  it('cifrado disponible → sí', () => expect(store().persistent).toBe(true))
  it('sin cifrado del SO → no', () => expect(store({ isEncryptionAvailable: () => false }).persistent).toBe(false))
  it('Linux basic_text (sin protección real) → no', () => expect(store({ getSelectedStorageBackend: () => 'basic_text' }).persistent).toBe(false))
  it('gnome_libsecret → sí', () => expect(store({ getSelectedStorageBackend: () => 'gnome_libsecret' }).persistent).toBe(true))
  it('si safeStorage lanza → no', () =>
    expect(store({ isEncryptionAvailable: () => { throw new Error('x') } }).persistent).toBe(false))
})

describe('save / load', () => {
  it('round-trip; el archivo NO contiene el secreto en claro', () => {
    const s = store()
    expect(s.save({ [T1]: { secret: 'SECRETO-MUY-LARGO-1', sessionActive: true }, [T2]: { secret: 'otro', sessionActive: false } })).toBe(true)
    const raw = fs.readFileSync(path.join(dir, 'device-session.bin')).toString('utf8')
    expect(raw).not.toContain('SECRETO-MUY-LARGO-1')
    expect(store().load()).toEqual({
      [T1]: { secret: 'SECRETO-MUY-LARGO-1', sessionActive: true },
      [T2]: { secret: 'otro', sessionActive: false },
    })
  })

  it('la escritura es atómica (sin temporales) y de uso privado', () => {
    store().save({ [T1]: { secret: 's', sessionActive: true } })
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([])
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'device-session.bin')).mode & 0o077).toBe(0)
  })

  it('sin cifrado del SO no escribe nada y load devuelve {}', () => {
    const s = store({ isEncryptionAvailable: () => false })
    expect(s.save({ [T1]: { secret: 's', sessionActive: true } })).toBe(false)
    expect(fs.existsSync(path.join(dir, 'device-session.bin'))).toBe(false)
    expect(s.load()).toEqual({})
  })

  it('sin archivo → {}', () => expect(store().load()).toEqual({}))

  it('archivo ilegible → se aparta (no se borra) y arranca sin secretos', () => {
    fs.writeFileSync(path.join(dir, 'device-session.bin'), 'basura que no descifra')
    expect(store().load()).toEqual({})
    expect(fs.existsSync(path.join(dir, 'device-session.bin'))).toBe(false)
    expect(fs.readdirSync(dir).some((f) => f.startsWith('device-session.bin.corrupt-1234'))).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('se apartó'))
  })

  it('si tampoco se puede apartar, lo informa y sigue', () => {
    fs.writeFileSync(path.join(dir, 'device-session.bin'), 'basura')
    const s = store()
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('EPERM') })
    expect(s.load()).toEqual({})
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no se pudo apartar'))
    spy.mockRestore()
  })

  it('un fallo al cifrar/escribir devuelve false y lo loguea', () => {
    const s = store({ encryptString: () => { throw new Error('keychain locked') } })
    expect(s.save({ [T1]: { secret: 's', sessionActive: true } })).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('keychain locked'))
  })

  it('usa Date.now y crypto.randomUUID por defecto', () => {
    const s = new DeviceStore({ dir, safeStorage: fakeSafeStorage() })
    expect(s.deviceId).toMatch(/^[0-9a-f-]{36}$/)
    fs.writeFileSync(path.join(dir, 'device-session.bin'), 'x')
    s.load() // quarantine con now() real y log por defecto (no-op)
    expect(fs.readdirSync(dir).some((f) => /corrupt-\d+/.test(f))).toBe(true)
  })
})

describe('sanitize', () => {
  it('descarta tenants no UUID, secretos vacíos/largos/no string y entradas no objeto', () => {
    expect(
      sanitize({
        [T1.toUpperCase()]: { secret: 'ok' },
        'no-uuid': { secret: 'x' },
        [T2]: { secret: '' },
        '99999999-2222-3333-4444-555555555555': { secret: 'a'.repeat(201) },
        '88888888-2222-3333-4444-555555555555': { secret: 5 },
        '77777777-2222-3333-4444-555555555555': 'texto',
        '66666666-2222-3333-4444-555555555555': null,
      }),
    ).toEqual({ [T1]: { secret: 'ok', sessionActive: true } })
  })

  it.each([null, undefined, 'x', 5, []])('entrada inválida %j → {}', (v) => expect(sanitize(v)).toEqual({}))

  it('sessionActive solo es false si viene explícitamente false', () => {
    expect(sanitize({ [T1]: { secret: 's', sessionActive: false } })[T1].sessionActive).toBe(false)
    expect(sanitize({ [T1]: { secret: 's', sessionActive: 'no' } })[T1].sessionActive).toBe(true)
  })
})

describe('persistencia atómica del secreto rotado', () => {
  it('hace fsync del temporal ANTES del rename (nunca queda un archivo a medias tras un corte)', () => {
    const order: string[] = []
    const fsync = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { order.push('fsync') })
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { order.push('rename') })
    try {
      store().save({ [T1]: { secret: 'nuevo', sessionActive: true } })
    } finally {
      fsync.mockRestore()
      rename.mockRestore()
    }
    expect(order).toEqual(['fsync', 'rename'])
  })

  it('si falla la escritura el archivo anterior queda intacto (con el secreto viejo completo)', () => {
    const s = store()
    s.save({ [T1]: { secret: 'viejo', sessionActive: true } })
    const spy = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('disco lleno') })
    expect(s.save({ [T1]: { secret: 'nuevo', sessionActive: true } })).toBe(false)
    spy.mockRestore()
    expect(s.load()[T1].secret).toBe('viejo')
  })

  it('lastCheckedAt / expiresAt sobreviven al guardado; valores inválidos se descartan', () => {
    const s = store()
    s.save({ [T1]: { secret: 'x', sessionActive: true, lastCheckedAt: 1700000000000, expiresAt: 1701000000000 } })
    expect(s.load()[T1]).toEqual({ secret: 'x', sessionActive: true, lastCheckedAt: 1700000000000, expiresAt: 1701000000000 })
    expect(sanitize({ [T1]: { secret: 'x', lastCheckedAt: 'ayer', expiresAt: -5 } })[T1]).toEqual({ secret: 'x', sessionActive: true })
  })
})

describe('SecretsPersister', () => {
  const msg = (secret: string, ackId?: string) => ({ type: 'omero:device-secrets', secrets: { [T1]: { secret, sessionActive: true } }, ...(ackId ? { ackId } : {}) })

  it('sin ackId: debounce (varios cambios seguidos → una sola escritura con el último)', () => {
    vi.useFakeTimers()
    const save = vi.fn(() => true)
    const p = new SecretsPersister({ save }, 200)
    expect(p.handle(msg('a'))).toBeNull()
    expect(p.handle(msg('b'))).toBeNull()
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ [T1]: { secret: 'b', sessionActive: true } })
    vi.useRealTimers()
  })

  it('con ackId: escribe YA y confirma ok=true (el Next no sigue hasta tener el secreto nuevo en disco)', () => {
    vi.useFakeTimers()
    const save = vi.fn(() => true)
    const p = new SecretsPersister({ save }, 200)
    p.handle(msg('viejo'))
    expect(p.handle(msg('nuevo', 'k1'))).toEqual({ type: 'omero:device-secrets-ack', ackId: 'k1', ok: true })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ [T1]: { secret: 'nuevo', sessionActive: true } })
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(1) // el debounce pendiente quedó cancelado
    vi.useRealTimers()
  })

  it('si no pudo guardar confirma ok=false', () => {
    const p = new SecretsPersister({ save: () => false })
    expect(p.handle(msg('x', 'k2'))).toEqual({ type: 'omero:device-secrets-ack', ackId: 'k2', ok: false })
  })

  it('ignora mensajes ajenos o malformados; ackId inválido se trata como mensaje normal', () => {
    vi.useFakeTimers()
    const save = vi.fn(() => true)
    const p = new SecretsPersister({ save })
    expect(p.handle(null)).toBeNull()
    expect(p.handle('x')).toBeNull()
    expect(p.handle({ type: 'otro' })).toBeNull()
    expect(p.handle(msg('a', 'x'.repeat(101)))).toBeNull()
    vi.advanceTimersByTime(300)
    expect(save).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('flush al cerrar la app guarda lo pendiente; sin nada pendiente no escribe', () => {
    const save = vi.fn(() => true)
    const p = new SecretsPersister({ save })
    expect(p.flush()).toBe(true)
    expect(save).not.toHaveBeenCalled()
    p.handle(msg('z'))
    expect(p.flush()).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
