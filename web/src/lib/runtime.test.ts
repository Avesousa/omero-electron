// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROXY_TIMEOUT_MS, getBackendUrl, getProxyTimeoutMs, getRuntime } from './runtime'

describe('getRuntime', () => {
  it.each(['web', 'desktop'] as const)('acepta "%s"', (value) => {
    expect(getRuntime({ OMERO_RUNTIME: value })).toBe(value)
  })

  it('recorta espacios', () => {
    expect(getRuntime({ OMERO_RUNTIME: '  desktop ' })).toBe('desktop')
  })

  it('lanza si falta (no se asume un modo)', () => {
    expect(() => getRuntime({})).toThrow(/OMERO_RUNTIME no está definida/)
  })

  it('lanza si es solo espacios', () => {
    expect(() => getRuntime({ OMERO_RUNTIME: '   ' })).toThrow(/no está definida/)
  })

  it.each(['WEB', 'server', 'electron'])('lanza con valor inválido: "%s"', (value) => {
    expect(() => getRuntime({ OMERO_RUNTIME: value })).toThrow(/inválida/)
  })

  it('lee process.env por defecto', () => {
    const previous = process.env.OMERO_RUNTIME
    process.env.OMERO_RUNTIME = 'web'
    try {
      expect(getRuntime()).toBe('web')
    } finally {
      if (previous === undefined) delete process.env.OMERO_RUNTIME
      else process.env.OMERO_RUNTIME = previous
    }
  })
})

describe('getBackendUrl', () => {
  it('devuelve el origen normalizado', () => {
    expect(getBackendUrl({ BACKEND_URL: 'https://api.example.com' })).toBe('https://api.example.com')
  })

  it('quita la "/" final y recorta espacios', () => {
    expect(getBackendUrl({ BACKEND_URL: '  https://api.example.com/ ' })).toBe('https://api.example.com')
  })

  it('acepta http con puerto', () => {
    expect(getBackendUrl({ BACKEND_URL: 'http://localhost:8080' })).toBe('http://localhost:8080')
  })

  it('lanza si falta', () => {
    expect(() => getBackendUrl({})).toThrow(/BACKEND_URL no está definida/)
  })

  it('lanza si no es una URL', () => {
    expect(() => getBackendUrl({ BACKEND_URL: 'backend' })).toThrow(/no es una URL válida/)
  })

  it.each(['ftp://x.com', 'file:///etc/passwd', 'javascript:alert(1)'])('lanza con esquema no http(s): %s', (bad) => {
    expect(() => getBackendUrl({ BACKEND_URL: bad })).toThrow(/http o https/)
  })

  it('lanza si trae credenciales', () => {
    expect(() => getBackendUrl({ BACKEND_URL: 'https://u:p@x.com' })).toThrow(/credenciales/)
  })

  it.each(['https://x.com/api', 'https://x.com/?q=1', 'https://x.com/#a'])('lanza si no es solo el origen: %s', (bad) => {
    expect(() => getBackendUrl({ BACKEND_URL: bad })).toThrow(/solo el origen/)
  })
})

describe('getProxyTimeoutMs', () => {
  it('usa el default si no está definida', () => {
    expect(getProxyTimeoutMs({})).toBe(DEFAULT_PROXY_TIMEOUT_MS)
  })

  it('acepta un entero positivo', () => {
    expect(getProxyTimeoutMs({ PROXY_TIMEOUT_MS: '5000' })).toBe(5000)
  })

  it.each(['abc', '0', '-5', '1.5', ''])('cae al default con valor inválido: "%s"', (bad) => {
    expect(getProxyTimeoutMs({ PROXY_TIMEOUT_MS: bad })).toBe(DEFAULT_PROXY_TIMEOUT_MS)
  })
})

describe('import-time', () => {
  it('importar el módulo no lee ni valida variables (next build sin env)', async () => {
    await expect(import('./runtime')).resolves.toBeDefined()
  })
})
