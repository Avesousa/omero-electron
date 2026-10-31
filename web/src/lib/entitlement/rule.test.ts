import { describe, expect, it } from 'vitest'
import { isAccessBlocked, parseCached, parseEntitlement, type Entitlement } from './rule'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const PAST = '2026-10-09T12:00:00Z'
const FUTURE = '2026-10-11T12:00:00Z'

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  status: 'ACTIVE',
  accessGranted: true,
  accessUntil: null,
  trialEndsAt: null,
  graceUntil: null,
  planCode: 'PRO',
  courtesy: false,
  enforced: true,
  canManage: false,
  ...over,
})

describe('isAccessBlocked (regla de bloqueo de venta)', () => {
  it('sin caché todavía → permite', () => {
    expect(isAccessBlocked(null, NOW)).toBe(false)
    expect(isAccessBlocked(undefined, NOW)).toBe(false)
  })

  it('enforced=false → nunca bloquea, aunque no haya acceso', () => {
    expect(isAccessBlocked(ent({ enforced: false, accessGranted: false, status: 'EXPIRED' }), NOW)).toBe(false)
    expect(isAccessBlocked(ent({ enforced: false, accessUntil: PAST }), NOW)).toBe(false)
  })

  it('ADMIN_APPROVED → nunca bloquea (sin vencimiento)', () => {
    expect(isAccessBlocked(ent({ status: 'ADMIN_APPROVED', accessUntil: null }), NOW)).toBe(false)
    expect(isAccessBlocked(ent({ status: 'ADMIN_APPROVED', accessGranted: false, accessUntil: PAST }), NOW)).toBe(false)
  })

  it('accessGranted=false → bloquea', () => {
    expect(isAccessBlocked(ent({ accessGranted: false, status: 'EXPIRED' }), NOW)).toBe(true)
    expect(isAccessBlocked(ent({ accessGranted: false, accessUntil: FUTURE }), NOW)).toBe(true)
  })

  it('con acceso y sin vencimiento → permite', () => {
    expect(isAccessBlocked(ent(), NOW)).toBe(false)
  })

  it('offline: acceso concedido con accessUntil FUTURO → sigue vendiendo', () => {
    expect(isAccessBlocked(ent({ accessUntil: FUTURE }), NOW)).toBe(false)
    expect(isAccessBlocked(ent({ accessUntil: new Date(NOW).toISOString() }), NOW)).toBe(false) // justo en el límite
  })

  it('offline: acceso concedido pero accessUntil PASADO → bloquea', () => {
    expect(isAccessBlocked(ent({ accessUntil: PAST }), NOW)).toBe(true)
    expect(isAccessBlocked(ent({ status: 'TRIALING', courtesy: true, accessUntil: PAST }), NOW)).toBe(true)
  })

  it('accessUntil ilegible no bloquea por sí solo', () => {
    expect(isAccessBlocked(ent({ accessUntil: 'no-es-fecha' }), NOW)).toBe(false)
  })
})

describe('parseEntitlement / parseCached', () => {
  const raw = { status: 'ACTIVE', accessGranted: true, accessUntil: FUTURE, trialEndsAt: null, graceUntil: '', planCode: 'PRO', courtesy: true, enforced: true, canManage: true }

  it('normaliza el payload del contrato', () => {
    expect(parseEntitlement(raw)).toEqual({ ...raw, graceUntil: null })
  })

  it('campos opcionales ausentes toman su default', () => {
    expect(parseEntitlement({ status: 'ACTIVE', accessGranted: true, enforced: false })).toEqual({
      status: 'ACTIVE', accessGranted: true, accessUntil: null, trialEndsAt: null, graceUntil: null, planCode: null, courtesy: false, enforced: false, canManage: false,
    })
  })

  it.each([null, 'x', [], {}, { status: 'ACTIVE' }, { status: 1, accessGranted: true, enforced: true }, { status: 'A', accessGranted: 'si', enforced: true }])(
    'rechaza formas inválidas: %j',
    (bad) => {
      expect(parseEntitlement(bad)).toBeNull()
    },
  )

  it('parseCached exige fetchedAt válido y entitlement válido', () => {
    expect(parseCached({ entitlement: raw, fetchedAt: PAST })?.fetchedAt).toBe(PAST)
    expect(parseCached({ entitlement: raw, fetchedAt: 'nada' })).toBeNull()
    expect(parseCached({ entitlement: {}, fetchedAt: PAST })).toBeNull()
    expect(parseCached(null)).toBeNull()
  })
})
