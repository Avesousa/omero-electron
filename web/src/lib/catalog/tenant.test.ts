// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { tenantFromAuthHeader, tokenExpiry } from './tenant'

const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'

function jwt(payload: unknown, raw = false): string {
  const b64 = (v: unknown) => Buffer.from(raw ? String(v) : JSON.stringify(v)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.firma`
}
const bearer = (payload: unknown) => `Bearer ${jwt(payload)}`

describe('tenantFromAuthHeader', () => {
  it('extrae el tenantId (en minúsculas)', () => {
    expect(tenantFromAuthHeader(bearer({ tenantId: TENANT }))).toBe(TENANT)
    expect(tenantFromAuthHeader(bearer({ tenantId: TENANT.toUpperCase() }))).toBe(TENANT)
  })

  it('acepta "bearer" en cualquier capitalización y espacios alrededor', () => {
    expect(tenantFromAuthHeader(`  bearer ${jwt({ tenantId: TENANT })}  `)).toBe(TENANT)
  })

  it.each([null, undefined, '', 'Bearer', 'Basic abc', 'Bearer a.b', 'Bearer a.b.c.d'])('sin token válido (%j) → null', (header) => {
    expect(tenantFromAuthHeader(header as string | null | undefined)).toBeNull()
  })

  it('sin claim tenantId → null', () => {
    expect(tenantFromAuthHeader(bearer({ sub: 'x' }))).toBeNull()
  })

  it.each(['no-es-uuid', '../../etc/passwd', `${TENANT}/../x`, '', 123, null, { a: 1 }, `${TENANT}\n`])(
    'tenantId inválido (%j) → null (se usa como nombre de archivo)',
    (tenantId) => {
      expect(tenantFromAuthHeader(bearer({ tenantId }))).toBeNull()
    },
  )

  it('payload que no es JSON, es un array o un valor suelto → null', () => {
    expect(tenantFromAuthHeader(`Bearer ${jwt('no json', true)}`)).toBeNull()
    expect(tenantFromAuthHeader(bearer([TENANT]))).toBeNull()
    expect(tenantFromAuthHeader(bearer('texto'))).toBeNull()
    expect(tenantFromAuthHeader(bearer(null))).toBeNull()
  })

  it('no verifica la firma (documentado): una firma arbitraria igual se decodifica', () => {
    expect(tenantFromAuthHeader(`Bearer ${jwt({ tenantId: TENANT }).replace('.firma', '.cualquiera')}`)).toBe(TENANT)
  })
})

describe('tokenExpiry', () => {
  it('devuelve exp en segundos', () => {
    expect(tokenExpiry(bearer({ exp: 1_800_000_000 }))).toBe(1_800_000_000)
  })

  it.each([{}, { exp: '123' }, { exp: null }, { exp: Number.POSITIVE_INFINITY }])('sin exp numérico (%j) → null', (payload) => {
    expect(tokenExpiry(bearer(payload))).toBeNull()
  })

  it('sin header → null', () => {
    expect(tokenExpiry(null)).toBeNull()
    expect(tokenExpiry('Bearer x')).toBeNull()
  })
})
