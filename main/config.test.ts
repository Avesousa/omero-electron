import { describe, expect, it } from 'vitest'
import { resolveBackendUrl } from './config'

describe('resolveBackendUrl', () => {
  it('usa BACKEND_URL del entorno (override) por sobre el default del build', () => {
    expect(
      resolveBackendUrl({ BACKEND_URL: 'https://dev.example.com' }, { defaultBackendUrl: 'https://prod.example.com' }),
    ).toBe('https://dev.example.com')
  })

  it('usa el default del build si no hay variable de entorno', () => {
    expect(resolveBackendUrl({}, { defaultBackendUrl: 'https://prod.example.com' })).toBe('https://prod.example.com')
  })

  it('ignora una BACKEND_URL vacía o solo espacios y cae al build-config', () => {
    expect(resolveBackendUrl({ BACKEND_URL: '   ' }, { defaultBackendUrl: 'https://prod.example.com' })).toBe(
      'https://prod.example.com',
    )
  })

  it('normaliza: sin "/" final y con espacios recortados', () => {
    expect(resolveBackendUrl({ BACKEND_URL: '  https://api.example.com/  ' }, null)).toBe('https://api.example.com')
  })

  it('acepta http con puerto (backend local de desarrollo)', () => {
    expect(resolveBackendUrl({ BACKEND_URL: 'http://localhost:8080' }, null)).toBe('http://localhost:8080')
  })

  it('lanza si no hay ninguna fuente (sin env y sin build-config)', () => {
    expect(() => resolveBackendUrl({}, null)).toThrow(/No hay URL de backend/)
  })

  it('lanza si el build-config no trae defaultBackendUrl', () => {
    expect(() => resolveBackendUrl({}, {})).toThrow(/No hay URL de backend/)
  })

  it('lanza si BACKEND_URL no es una URL', () => {
    expect(() => resolveBackendUrl({ BACKEND_URL: 'no-es-url' }, null)).toThrow(/BACKEND_URL no es una URL válida/)
  })

  it.each(['ftp://x.com', 'file:///etc/passwd', 'javascript:alert(1)'])('lanza con esquema no http(s): %s', (bad) => {
    expect(() => resolveBackendUrl({ BACKEND_URL: bad }, null)).toThrow(/http o https/)
  })

  it('lanza si incluye credenciales', () => {
    expect(() => resolveBackendUrl({ BACKEND_URL: 'https://user:pass@x.com' }, null)).toThrow(/credenciales/)
  })

  it.each(['https://x.com/api', 'https://x.com/?a=1', 'https://x.com/#frag'])(
    'lanza si no es solo el origen: %s',
    (bad) => {
      expect(() => resolveBackendUrl({ BACKEND_URL: bad }, null)).toThrow(/solo el origen/)
    },
  )

  it('el error del build-config indica su fuente', () => {
    expect(() => resolveBackendUrl({}, { defaultBackendUrl: 'ftp://x.com' })).toThrow(/build-config/)
  })
})
