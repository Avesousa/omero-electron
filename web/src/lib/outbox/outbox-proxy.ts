import { tenantFromAuthHeader, userIdFromAuthHeader } from '../catalog/tenant'
import { isAccessBlocked, SALE_BLOCKED_MESSAGE, SUBSCRIPTION_INACTIVE_CODE } from '../entitlement/rule'
import { readEntitlement } from '../entitlement/store'
import { getOutboxStore } from './outbox-registry'
import { getSender } from './outbox-sender'
import { rememberSession } from './outbox-runtime'
import { approximateDebt } from '../customers/customers-adjust'
import type { EnqueueInput, OutboxType } from './types'

/**
 * Escrituras offline del POS desktop (fase 3): `POST /api/sales` y `POST /api/expenses` NO van directo al backend;
 * se guardan primero en el outbox SQLite (durable, `synchronous=FULL`) y el sender las sube en segundo plano.
 *
 *   - La respuesta es `201 { success:true, data:{ id:null, clientId, queued:true, ... } }` y solo se devuelve DESPUÉS de
 *     confirmar la escritura en disco.
 *   - `createdAt` es la hora de la caja (ahora). El COSTO nunca viaja: el payload se arma campo por campo (lista blanca)
 *     y el backend lo resuelve al recibir.
 *   - Devuelve `null` (→ proxy directo, comportamiento anterior) si no aplica o el outbox no está disponible: la
 *     degradación jamás rompe la venta.
 */

export const MAX_BODY_BYTES = 1024 * 1024

export interface Parsed {
  type: OutboxType
  payload: Record<string, unknown>
  /** Respuesta al POS (además de id:null/clientId/queued/createdAt). */
  echo: Record<string, unknown>
}

export class InvalidRequest extends Error {
  /** Código estable (el front lo traduce a español); sin código solo se muestra el mensaje. */
  constructor(message: string, readonly code?: string) {
    super(message)
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function matchOutboxRoute(method: string, pathname: string): OutboxType | null {
  if (method.toUpperCase() !== 'POST') return null
  const path = pathname.replace(/\/+$/, '')
  if (path === '/api/sales') return 'SALE'
  if (path === '/api/expenses') return 'EXPENSE'
  if (path === '/api/credit/collect') return 'CREDIT_COLLECTION'
  return null
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const money = (v: unknown, field: string, fallback?: number): number => {
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback
    throw new InvalidRequest(`${field} es obligatorio`)
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new InvalidRequest(`${field} inválido`)
  return v
}
const optString = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)
/** Un peso en kg con precisión de gramos (0.35, 1.005); 0.3505 no. */
const hasAtMostThreeDecimals = (v: number): boolean => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6

export function parseSale(body: Record<string, unknown>): Parsed {
  if (!Array.isArray(body.items) || body.items.length === 0) throw new InvalidRequest('La venta no tiene ítems')
  const items = body.items.map((raw, i) => {
    if (!isObj(raw)) throw new InvalidRequest(`Ítem ${i + 1} inválido`)
    const productId = typeof raw.productId === 'string' ? raw.productId.trim() : ''
    if (!productId) throw new InvalidRequest(`Ítem ${i + 1}: falta el código de producto`)
    // Unidad de la línea: ausente = por unidad (formato anterior). Por peso, la cantidad son kg con hasta 3 decimales.
    if (raw.saleUnit !== undefined && raw.saleUnit !== null && raw.saleUnit !== 'UNIT' && raw.saleUnit !== 'KG') {
      throw new InvalidRequest(`Ítem ${i + 1}: unidad inválida`)
    }
    const byWeight = raw.saleUnit === 'KG'
    const quantity = raw.quantity
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new InvalidRequest(`Ítem ${i + 1}: cantidad inválida`)
    }
    if (byWeight ? !hasAtMostThreeDecimals(quantity) : !Number.isInteger(quantity)) {
      throw new InvalidRequest(`Ítem ${i + 1}: cantidad inválida`)
    }
    const stockQuantity = raw.stockQuantity
    if (stockQuantity !== undefined && stockQuantity !== null
      && (typeof stockQuantity !== 'number' || !Number.isFinite(stockQuantity) || stockQuantity < 0)) {
      throw new InvalidRequest(`Ítem ${i + 1}: stockQuantity inválido`)
    }
    // Lista blanca: cualquier otro campo (p. ej. un costo) se descarta.
    return {
      productId,
      productName: optString(raw.productName),
      quantity,
      unitPrice: money(raw.unitPrice, `Ítem ${i + 1}: unitPrice`),
      total: money(raw.total, `Ítem ${i + 1}: total`),
      promotionId: optString(raw.promotionId),
      promotionName: optString(raw.promotionName),
      // Solo viajan si el POS los mandó: un payload sin ellos es idéntico al del formato anterior.
      ...(typeof raw.saleUnit === 'string' ? { saleUnit: raw.saleUnit } : {}),
      ...(typeof stockQuantity === 'number' ? { stockQuantity } : {}),
    }
  })
  // Pagos por medio (formato nuevo, importes recibidos): lista blanca por renglón. Ausente = formato viejo (cash/mp).
  // Se guarda tal cual en el outbox y viaja al backend en /api/sync/batch; el backend la prefiere a cash/mp.
  let payments: { paymentMethodId: string; amount: number }[] | undefined
  if (body.payments !== undefined && body.payments !== null) {
    if (!Array.isArray(body.payments)) throw new InvalidRequest('payments inválido')
    payments = body.payments.map((raw, i) => {
      if (!isObj(raw)) throw new InvalidRequest(`Pago ${i + 1} inválido`)
      const paymentMethodId = typeof raw.paymentMethodId === 'string' ? raw.paymentMethodId.trim() : ''
      if (!paymentMethodId) throw new InvalidRequest(`Pago ${i + 1}: falta el medio de pago`)
      return { paymentMethodId, amount: money(raw.amount, `Pago ${i + 1}: amount`) }
    })
  }
  // Venta a crédito: el cliente al que se le fía (los pagos llevan una línea con el medio CREDIT). Ausente = venta común.
  let customerId: string | undefined
  if (body.customerId !== undefined && body.customerId !== null) {
    if (typeof body.customerId !== 'string' || !UUID.test(body.customerId)) {
      throw new InvalidRequest('El cliente es inválido', 'CUSTOMER_NOT_FOUND')
    }
    customerId = body.customerId.toLowerCase()
  }
  const payload = {
    items,
    ...(customerId ? { customerId } : {}),
    cashAmount: money(body.cashAmount, 'cashAmount', 0),
    mpAmount: money(body.mpAmount, 'mpAmount', 0),
    ...(payments && payments.length > 0 ? { payments } : {}),
    change: money(body.change, 'change', 0),
  }
  return { type: 'SALE', payload, echo: { total: items.reduce((s, i) => s + i.total, 0), items, ...(customerId ? { customerId } : {}) } }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Cobro de crédito (`POST /api/credit/collect`). Cuerpo del POS: `{ customerId, payments:[{paymentMethodId, amount}],
 * expectedDebt?, clientId? }`. `clientId` (UUID) es opcional: si el POS lo manda, reintentar el mismo cobro NO crea otro
 * (idempotencia también contra un doble clic). `expectedDebt` = deuda que el cajero vio; si falta se toma la última conocida.
 */
export function parseCreditCollection(
  body: Record<string, unknown>,
  knownDebt: (customerId: string) => number | null,
): Parsed & { clientId?: string } {
  const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : ''
  if (!UUID.test(customerId)) throw new InvalidRequest('Elegí un cliente para cobrar', 'CUSTOMER_NOT_FOUND')
  if (!Array.isArray(body.payments) || body.payments.length === 0) {
    throw new InvalidRequest('Indicá cómo se cobra', 'CREDIT_PAYMENT_REQUIRED')
  }
  const payments = body.payments.map((raw, i) => {
    if (!isObj(raw)) throw new InvalidRequest(`Pago ${i + 1} inválido`, 'PAYMENT_AMOUNT_INVALID')
    const paymentMethodId = typeof raw.paymentMethodId === 'string' ? raw.paymentMethodId.trim() : ''
    if (!paymentMethodId) throw new InvalidRequest(`Pago ${i + 1}: falta el medio de pago`, 'CREDIT_PAYMENT_REQUIRED')
    const amount = raw.amount
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new InvalidRequest(`Pago ${i + 1}: el importe debe ser mayor a 0`, 'PAYMENT_AMOUNT_INVALID')
    }
    return { paymentMethodId, amount: round2(amount) }
  })
  const total = round2(payments.reduce((s, p) => s + p.amount, 0))
  if (total <= 0) throw new InvalidRequest('El importe a cobrar debe ser mayor a 0', 'CREDIT_AMOUNT_INVALID')

  let expectedDebt: number | null = null
  if (body.expectedDebt !== undefined && body.expectedDebt !== null) {
    if (typeof body.expectedDebt !== 'number' || !Number.isFinite(body.expectedDebt) || body.expectedDebt < 0) {
      throw new InvalidRequest('La deuda esperada es inválida', 'CREDIT_AMOUNT_INVALID')
    }
    expectedDebt = round2(body.expectedDebt)
    // El cajero vio esa deuda: cobrar más que eso es un error del POS (el backend offline lo aceptaría y lo marcaría a revisar).
    if (total > expectedDebt + 0.005) throw new InvalidRequest('El importe supera la deuda del cliente', 'CREDIT_AMOUNT_EXCEEDS_DEBT')
  } else {
    expectedDebt = knownDebt(customerId.toLowerCase())
  }

  let clientId: string | undefined
  if (body.clientId !== undefined && body.clientId !== null) {
    if (typeof body.clientId !== 'string' || !UUID.test(body.clientId)) throw new InvalidRequest('clientId inválido')
    clientId = body.clientId.toLowerCase()
  }
  const payload = { customerId: customerId.toLowerCase(), payments, ...(expectedDebt !== null ? { expectedDebt } : {}) }
  return { type: 'CREDIT_COLLECTION', payload, echo: { customerId: payload.customerId, amount: total, payments }, clientId }
}

function parseExpense(body: Record<string, unknown>): Parsed {
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) throw new InvalidRequest('La descripción es obligatoria')
  const amount = money(body.amount, 'amount')
  if (amount <= 0) throw new InvalidRequest('El monto debe ser mayor a 0')
  const productId = typeof body.productId === 'number' && Number.isFinite(body.productId) ? body.productId : null
  const payload = {
    description,
    amount,
    type: optString(body.type),
    businessId: optString(body.businessId),
    productId,
  }
  return { type: 'EXPENSE', payload, echo: { description, amount, type: payload.type, businessId: payload.businessId } }
}

/**
 * Encola la venta/gasto. Devuelve la respuesta 201, un 400/413 si el pedido es inválido, o `null` si hay que
 * usar el proxy directo (sin tenant/token, sin outbox, error de disco).
 */
export async function handleOutboxRequest(request: Request, type: OutboxType): Promise<Response | null> {
  const authorization = request.headers.get('authorization')
  const tenantId = tenantFromAuthHeader(authorization)
  if (!tenantId || !authorization) return null

  // Suscripción vencida: la VENTA se bloquea antes de encolarla (también offline, con el último entitlement conocido).
  // Sin caché todavía → se permite. Los gastos y lo ya encolado siguen su curso: nunca se pierden datos.
  if (type === 'SALE' && isAccessBlocked(readEntitlement(tenantId)?.entitlement, Date.now())) {
    return json(403, { success: false, error: SALE_BLOCKED_MESSAGE, code: SUBSCRIPTION_INACTIVE_CODE })
  }

  const store = getOutboxStore(tenantId)
  if (!store) return null

  let text: string
  try {
    text = await request.clone().text()
  } catch {
    return null
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return json(413, { success: false, error: 'El cuerpo supera 1 MB' })
  }

  let parsed: Parsed
  try {
    const body: unknown = JSON.parse(text)
    if (!isObj(body)) throw new InvalidRequest('El cuerpo debe ser un objeto JSON')
    parsed =
      type === 'SALE'
        ? parseSale(body)
        : type === 'EXPENSE'
          ? parseExpense(body)
          : parseCreditCollection(body, (customerId) => approximateDebt(tenantId, customerId))
  } catch (err) {
    const message = err instanceof InvalidRequest ? err.message : 'JSON inválido'
    return json(400, { success: false, error: message, ...(err instanceof InvalidRequest && err.code ? { code: err.code } : {}) })
  }

  let row
  let inserted = true
  try {
    const input: EnqueueInput = {
      type: parsed.type,
      payload: JSON.stringify(parsed.payload),
      sourceUserId: userIdFromAuthHeader(authorization),
      ...('clientId' in parsed && typeof parsed.clientId === 'string' ? { clientId: parsed.clientId } : {}),
    }
    const result = store.enqueue(input)
    row = result.row
    inserted = result.inserted
  } catch (err) {
    console.warn(`[outbox] no se pudo guardar en el outbox (${(err as Error).message}): proxy directo`)
    return null // el disco falló: mejor intentar directo que perder la venta
  }

  // Deja el token en memoria para el sender y dispara el envío (no bloquea la respuesta).
  rememberSession(tenantId, authorization)
  try {
    getSender().kick(tenantId)
  } catch (err) {
    console.warn(`[outbox] no se pudo iniciar el envío: ${(err as Error).message}`)
  }

  // Cobro de crédito: deuda aproximada del cliente tras este cobro (cache − pendientes; se corrige al sincronizar).
  const extra: Record<string, unknown> = {}
  if (parsed.type === 'CREDIT_COLLECTION') {
    extra.debtAfter = approximateDebt(tenantId, String(parsed.payload.customerId))
    extra.duplicate = !inserted
  }

  return json(201, {
    success: true,
    data: { id: null, clientId: row.clientId, queued: true, createdAt: row.createdAt, ...parsed.echo, ...extra },
  })
}
