import { tenantFromAuthHeader, userIdFromAuthHeader } from '../catalog/tenant'
import { getOutboxStore } from './outbox-registry'
import { getSender } from './outbox-sender'
import { rememberSession } from './outbox-runtime'
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

export class InvalidRequest extends Error {}

export function matchOutboxRoute(method: string, pathname: string): OutboxType | null {
  if (method.toUpperCase() !== 'POST') return null
  const path = pathname.replace(/\/+$/, '')
  if (path === '/api/sales') return 'SALE'
  if (path === '/api/expenses') return 'EXPENSE'
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

export function parseSale(body: Record<string, unknown>): Parsed {
  if (!Array.isArray(body.items) || body.items.length === 0) throw new InvalidRequest('La venta no tiene ítems')
  const items = body.items.map((raw, i) => {
    if (!isObj(raw)) throw new InvalidRequest(`Ítem ${i + 1} inválido`)
    const productId = typeof raw.productId === 'string' ? raw.productId.trim() : ''
    if (!productId) throw new InvalidRequest(`Ítem ${i + 1}: falta el código de producto`)
    const quantity = raw.quantity
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidRequest(`Ítem ${i + 1}: cantidad inválida`)
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
    }
  })
  const payload = {
    items,
    cashAmount: money(body.cashAmount, 'cashAmount', 0),
    mpAmount: money(body.mpAmount, 'mpAmount', 0),
    change: money(body.change, 'change', 0),
  }
  return { type: 'SALE', payload, echo: { total: items.reduce((s, i) => s + i.total, 0), items } }
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
    parsed = type === 'SALE' ? parseSale(body) : parseExpense(body)
  } catch (err) {
    const message = err instanceof InvalidRequest ? err.message : 'JSON inválido'
    return json(400, { success: false, error: message })
  }

  let row
  try {
    const input: EnqueueInput = {
      type: parsed.type,
      payload: JSON.stringify(parsed.payload),
      sourceUserId: userIdFromAuthHeader(authorization),
    }
    row = store.enqueue(input).row
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

  return json(201, {
    success: true,
    data: { id: null, clientId: row.clientId, queued: true, createdAt: row.createdAt, ...parsed.echo },
  })
}
