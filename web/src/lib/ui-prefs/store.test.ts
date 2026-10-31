// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseTheme, readUiPrefs, uiPrefsAvailable, writeTheme } from './store'

let dir: string
let env: Record<string, string>
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-ui-prefs-'))
  env = { OMERO_RUNTIME: 'desktop', OMERO_DATA_DIR: dir }
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('preferencias de interfaz persistentes (desktop)', () => {
  it('sin archivo no hay preferencia', () => {
    expect(uiPrefsAvailable(env)).toBe(true)
    expect(readUiPrefs(env)).toEqual({})
  })

  it('guarda y lee el tema; sobrevive a un "reinicio" (es un archivo) y no deja .tmp', () => {
    expect(writeTheme('dark', env)).toBe(true)
    expect(readUiPrefs(env)).toEqual({ theme: 'dark' })
    expect(writeTheme('light', env)).toBe(true)
    expect(readUiPrefs(env)).toEqual({ theme: 'light' })
    expect(fs.readdirSync(dir)).toEqual(['ui-prefs.json'])
  })

  it('archivo corrupto, valor inválido o no-objeto = sin preferencia, sin lanzar', () => {
    for (const content of ['{no json', JSON.stringify({ theme: 'neon' }), 'null', '"dark"']) {
      fs.writeFileSync(path.join(dir, 'ui-prefs.json'), content)
      expect(readUiPrefs(env)).toEqual({})
    }
  })

  it('web o producción sin OMERO_DATA_DIR: no disponible', () => {
    for (const e of [{ OMERO_RUNTIME: 'web', OMERO_DATA_DIR: dir }, { OMERO_RUNTIME: 'desktop', NODE_ENV: 'production' }, {}]) {
      expect(uiPrefsAvailable(e)).toBe(false)
      expect(readUiPrefs(e)).toEqual({})
      expect(writeTheme('dark', e)).toBe(false)
    }
  })

  it('directorio imposible de crear: devuelve false sin lanzar', () => {
    const file = path.join(dir, 'archivo')
    fs.writeFileSync(file, 'x')
    expect(writeTheme('dark', { OMERO_RUNTIME: 'desktop', OMERO_DATA_DIR: path.join(file, 'sub') })).toBe(false)
  })

  it('parseTheme', () => {
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('x')).toBeNull()
    expect(parseTheme(undefined)).toBeNull()
  })
})
