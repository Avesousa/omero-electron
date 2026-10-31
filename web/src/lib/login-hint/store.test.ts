// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loginHintAvailable, parseLoginHint, readLoginHint, writeLoginHint } from './store'

const T = '724c4579-ea83-4cef-9f37-bcfbfcc12268'
let dir: string
let env: Record<string, string>
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-login-hint-'))
  env = { OMERO_RUNTIME: 'desktop', OMERO_DATA_DIR: dir }
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('pista de login persistente (desktop)', () => {
  it('sin archivo no hay pista (primer login: siempre email + contraseña)', () => {
    expect(loginHintAvailable(env)).toBe(true)
    expect(readLoginHint(env)).toBeNull()
  })

  it('guarda y lee tenantId + flag, y sobrevive a un "reinicio" (es un archivo)', () => {
    expect(writeLoginHint({ tenantId: T, quickKeyLoginEnabled: true }, env)).toBe(true)
    expect(readLoginHint(env)).toEqual({ tenantId: T, quickKeyLoginEnabled: true })
    expect(fs.readdirSync(dir)).toEqual(['login-hint.json']) // sin .tmp residuales
  })

  it('un login posterior pisa la pista (una caja = un negocio)', () => {
    writeLoginHint({ tenantId: T, quickKeyLoginEnabled: true }, env)
    writeLoginHint({ tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', quickKeyLoginEnabled: false }, env)
    expect(readLoginHint(env)).toEqual({ tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', quickKeyLoginEnabled: false })
  })

  it('archivo corrupto o con tenant inválido = sin pista, sin lanzar', () => {
    fs.writeFileSync(path.join(dir, 'login-hint.json'), '{no es json')
    expect(readLoginHint(env)).toBeNull()
    fs.writeFileSync(path.join(dir, 'login-hint.json'), JSON.stringify({ tenantId: '../etc/passwd', quickKeyLoginEnabled: true }))
    expect(readLoginHint(env)).toBeNull()
  })

  it('en web o sin directorio de datos no aplica', () => {
    expect(loginHintAvailable({ OMERO_RUNTIME: 'web' })).toBe(false)
    expect(readLoginHint({ OMERO_RUNTIME: 'web' })).toBeNull()
    expect(writeLoginHint({ tenantId: T, quickKeyLoginEnabled: true }, { OMERO_RUNTIME: 'web' })).toBe(false)
  })

  it('parseLoginHint: el flag solo es true si viene exactamente true; normaliza el UUID', () => {
    expect(parseLoginHint({ tenantId: T.toUpperCase(), quickKeyLoginEnabled: 'true' })).toEqual({ tenantId: T, quickKeyLoginEnabled: false })
    expect(parseLoginHint(null)).toBeNull()
    expect(parseLoginHint([])).toBeNull()
  })
})
