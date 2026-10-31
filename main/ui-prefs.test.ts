import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSavedTheme, THEME_BACKGROUND } from './ui-prefs'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-uiprefs-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('readSavedTheme', () => {
  it('sin archivo: claro (por defecto)', () => expect(readSavedTheme(dir)).toBe('light'))
  it('lee dark y light', () => {
    fs.writeFileSync(path.join(dir, 'ui-prefs.json'), JSON.stringify({ theme: 'dark' }))
    expect(readSavedTheme(dir)).toBe('dark')
    fs.writeFileSync(path.join(dir, 'ui-prefs.json'), JSON.stringify({ theme: 'light' }))
    expect(readSavedTheme(dir)).toBe('light')
  })
  it('archivo corrupto, valor raro o no-objeto: claro, sin lanzar', () => {
    for (const content of ['{no json', JSON.stringify({ theme: 'neon' }), 'null', '"dark"']) {
      fs.writeFileSync(path.join(dir, 'ui-prefs.json'), content)
      expect(readSavedTheme(dir)).toBe('light')
    }
  })
  it('expone un fondo por tema', () => expect(Object.keys(THEME_BACKGROUND).sort()).toEqual(['dark', 'light']))
})
