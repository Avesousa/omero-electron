import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

function jwt(expOffset: number, sub: string | null = '1'): string {
  const payload = btoa(JSON.stringify({ ...(sub ? { sub } : {}), exp: Math.floor(Date.now() / 1000) + expOffset }))
  return `h.${payload}.s`
}

function req(path: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} })
}

const location = (res: Response) => res.headers.get('location')
const inDays = (d: number) => String(Date.now() + d * 86_400_000)

describe('middleware (POS de escritorio)', () => {
  it('sin sesión redirige a /login con redirectTo', () => {
    expect(location(middleware(req('/admin')))).toBe('http://localhost/login?redirectTo=%2Fadmin')
  })

  it('con JWT vigente deja pasar', () => {
    expect(location(middleware(req('/pos', { omero_session: jwt(600) })))).toBeNull()
  })

  it('JWT vencido SIN sesión de caja redirige a /login', () => {
    expect(location(middleware(req('/pos', { omero_session: jwt(-60) })))).toContain('/login')
  })

  it('JWT vencido con sesión de caja vigente (omero_device_until) deja pasar', () => {
    const res = middleware(req('/pos', { omero_session: jwt(-3600), omero_device_until: inDays(10) }))
    expect(location(res)).toBeNull()
  })

  it('JWT vencido con la sesión de caja ya vencida redirige a /login', () => {
    const res = middleware(req('/pos', { omero_session: jwt(-3600), omero_device_until: String(Date.now() - 1000) }))
    expect(location(res)).toContain('/login')
  })

  it('omero_device_until sin JWT bien formado no alcanza', () => {
    expect(location(middleware(req('/pos', { omero_device_until: inDays(10) })))).toContain('/login')
    expect(location(middleware(req('/pos', { omero_session: 'basura', omero_device_until: inDays(10) })))).toContain('/login')
    expect(location(middleware(req('/pos', { omero_session: jwt(-60, null), omero_device_until: inDays(10) })))).toContain('/login')
  })

  it('omero_device_until inválido (no numérico) no cuenta', () => {
    expect(location(middleware(req('/pos', { omero_session: jwt(-60), omero_device_until: 'abc' })))).toContain('/login')
  })

  it('/login con sesión vigente redirige a /; con la sesión de caja terminada (sin cookies) no', () => {
    expect(location(middleware(req('/login', { omero_session: jwt(600) })))).toBe('http://localhost/')
    expect(location(middleware(req('/login')))).toBeNull()
  })

  it('rutas /api no se filtran', () => {
    expect(location(middleware(req('/api/products')))).toBeNull()
  })
})
