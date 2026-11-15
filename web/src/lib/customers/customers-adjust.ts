import { getCatalogStore } from '../catalog/store-registry'
import { CUSTOMERS_SETTING, PAYMENT_METHODS_SETTING } from '../catalog/snapshot'
import type { CatalogRoute } from '../catalog/types'
import { getOutboxStore } from '../outbox/outbox-registry'

/**
 * Deuda de clientes que ve el POS offline = deuda cacheada del backend, ajustada con lo que el outbox todavía no subió
 * (APROXIMACIÓN hasta sincronizar: el backend imputa con los precios vigentes al sincronizar y puede dar otro número).
 *
 *   - Cobros (`CREDIT_COLLECTION`) pendientes: restan lo cobrado de la deuda (piso 0) y, en el detalle, se imputan FIFO
 *     a las líneas PENDING (de la más vieja a la más nueva), igual que el backend.
 *   - Ventas con `customerId` pendientes: suman lo fiado (pagos con el medio de kind CREDIT).
 *
 * Igual que `stock-adjust`, solo se ajusta la RESPUESTA: la caché guarda siempre el valor crudo del backend, así que el
 * ajuste nunca se acumula ni se aplica dos veces. Con una respuesta en vivo solo cuentan los PENDING; con una servida
 * desde la caché, también lo enviado después del snapshot.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100
const EPS = 0.005

export interface CustomerDelta {
  /** Total cobrado y todavía no reflejado. */
  collected: number
  /** Total fiado en ventas todavía no reflejadas. */
  credit: number
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** ids de los medios de pago de kind CREDIT según la caché de medios (vacío si no se conoce). */
function creditMethodIds(tenantId: string): Set<string> {
  const ids = new Set<string>()
  try {
    const raw = getCatalogStore(tenantId)?.getSetting(PAYMENT_METHODS_SETTING)?.json
    const list: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(list)) for (const m of list) if (isObj(m) && m.kind === 'CREDIT' && typeof m.id === 'string') ids.add(m.id)
  } catch {
    /* sin medios cacheados: no se pueden reconocer las ventas a crédito */
  }
  return ids
}

/** Cobrado y fiado pendientes por cliente (id en minúsculas). */
export function customerDeltas(tenantId: string, options: { since?: string | null } = {}): Map<string, CustomerDelta> {
  const out = new Map<string, CustomerDelta>()
  const outbox = getOutboxStore(tenantId)
  if (!outbox) return out
  const events = outbox.activePayloads(['CREDIT_COLLECTION', 'SALE'], options)
  if (events.length === 0) return out
  const creditIds = creditMethodIds(tenantId)
  const entry = (id: string): CustomerDelta => {
    let d = out.get(id)
    if (!d) out.set(id, (d = { collected: 0, credit: 0 }))
    return d
  }
  for (const { type, payload } of events) {
    const customerId = typeof payload.customerId === 'string' ? payload.customerId.toLowerCase() : ''
    if (!customerId || !Array.isArray(payload.payments)) continue
    if (type === 'CREDIT_COLLECTION') {
      entry(customerId).collected += sum(payload.payments, () => true)
    } else if (type === 'SALE' && creditIds.size > 0) {
      entry(customerId).credit += sum(payload.payments, (id) => creditIds.has(id))
    }
  }
  return out
}

function sum(payments: unknown[], accept: (paymentMethodId: string) => boolean): number {
  let total = 0
  for (const p of payments) {
    if (!isObj(p) || typeof p.amount !== 'number' || !Number.isFinite(p.amount) || typeof p.paymentMethodId !== 'string') continue
    if (accept(p.paymentMethodId)) total += p.amount
  }
  return round2(total)
}

const adjustedDebt = (raw: number, d: CustomerDelta): number => round2(Math.max(0, raw - d.collected) + d.credit)

function adjustCustomer(customer: unknown, deltas: Map<string, CustomerDelta>): boolean {
  if (!isObj(customer) || typeof customer.id !== 'string' || typeof customer.debt !== 'number') return false
  const d = deltas.get(customer.id.toLowerCase())
  if (!d) return false
  const next = adjustedDebt(customer.debt, d)
  if (next === customer.debt) return false
  customer.debt = next
  if (next <= EPS) customer.pendingLines = 0
  return true
}

/** Imputa lo cobrado FIFO a las líneas PENDING (el backend las entrega en el orden en que se cobrarían). */
function adjustLines(lines: unknown[], collected: number): boolean {
  let left = collected
  let changed = false
  for (const line of lines) {
    if (left <= EPS) break
    if (!isObj(line) || line.status !== 'PENDING' || typeof line.debt !== 'number') continue
    const current = line.debt as number
    const take = round2(Math.min(left, current))
    if (take <= 0) continue
    left = round2(left - take)
    const remaining = round2(current - take)
    line.debt = remaining
    if (typeof line.paid === 'number') line.paid = round2(line.paid + take)
    if (remaining <= EPS) line.status = 'PAID'
    changed = true
  }
  return changed
}

/**
 * Devuelve el body de `/api/customers` o `/{id}/detail` con la deuda ajustada (o el mismo texto si no hay nada que
 * ajustar). `since` = fecha del snapshot de donde sale el dato; `undefined` = respuesta en vivo del backend.
 */
export function adjustCustomersBody(
  tenantId: string,
  route: CatalogRoute,
  body: string,
  options: { since?: string | null } = {},
): string {
  if (route.kind !== 'customers' && route.kind !== 'customerDetail') return body
  try {
    const deltas = customerDeltas(tenantId, options)
    if (deltas.size === 0) return body // camino rápido: sin parsear el JSON
    const parsed = JSON.parse(body) as { data?: unknown }
    let changed = false
    if (route.kind === 'customers') {
      if (Array.isArray(parsed?.data)) for (const c of parsed.data) changed = adjustCustomer(c, deltas) || changed
    } else if (isObj(parsed?.data)) {
      const detail = parsed.data
      changed = adjustCustomer(detail.customer, deltas)
      const d = deltas.get(route.id)
      if (d && Array.isArray(detail.lines) && d.collected > 0) changed = adjustLines(detail.lines, d.collected) || changed
    }
    return changed ? JSON.stringify(parsed) : body
  } catch (err) {
    console.warn(`[outbox] no se pudo ajustar la deuda de clientes: ${(err as Error).message}`)
    return body
  }
}

/**
 * Deuda aproximada de un cliente según lo último que se sabe (caché + pendientes del outbox), o null si no hay lista
 * cacheada o el cliente no está en ella. Es la que se usa como `expectedDebt` si el POS no la manda.
 */
export function approximateDebt(tenantId: string, customerId: string): number | null {
  try {
    const raw = getCatalogStore(tenantId)?.getSetting(CUSTOMERS_SETTING)?.json
    if (!raw) return null
    const list: unknown = JSON.parse(raw)
    if (!Array.isArray(list)) return null
    const id = customerId.toLowerCase()
    const customer = list.find((c) => isObj(c) && typeof c.id === 'string' && c.id.toLowerCase() === id)
    if (!isObj(customer) || typeof customer.debt !== 'number') return null
    const d = customerDeltas(tenantId, { since: getCatalogStore(tenantId)?.getSetting(CUSTOMERS_SETTING)?.syncedAt ?? null }).get(id)
    return d ? adjustedDebt(customer.debt, d) : round2(customer.debt)
  } catch {
    return null
  }
}

/** Nombre cacheado del cliente (para mostrarlo en la lista del outbox), o null. */
export function cachedCustomerName(tenantId: string, customerId: string): string | null {
  try {
    const raw = getCatalogStore(tenantId)?.getSetting(CUSTOMERS_SETTING)?.json
    const list: unknown = raw ? JSON.parse(raw) : null
    const id = customerId.toLowerCase()
    const c = Array.isArray(list) ? list.find((x) => isObj(x) && typeof x.id === 'string' && x.id.toLowerCase() === id) : null
    return isObj(c) && typeof c.name === 'string' ? c.name : null
  } catch {
    return null
  }
}
