import { tenantFromAuthHeader, userIdFromAuthHeader } from '../catalog/tenant'
import { importLegacyQueue, type LegacyQueuedPurchase } from './legacy-import'
import { getOutboxStore } from './outbox-registry'
import { getSender, type SenderState } from './outbox-sender'
import { rememberSession } from './outbox-runtime'
import type { OutboxStore } from './outbox-store'
import type { OutboxCounts, OutboxRow, OutboxStatus } from './types'

/**
 * Lógica de los endpoints locales `/api/_local/outbox/*` (NO se proxean al backend). Todos resuelven el tenant del
 * JWT y solo ven SU outbox. En web (o sin outbox disponible) responden `available:false` con datos vacíos.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: OutboxStatus[] = ['PENDING', 'SENT', 'REVIEW', 'FAILED']
const DEFAULT_STATUSES: OutboxStatus[] = ['PENDING', 'REVIEW', 'FAILED']
const MAX_LIMIT = 200
const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export const EMPTY_COUNTS: OutboxCounts = { pending: 0, sent: 0, review: 0, failed: 0 }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

interface Ctx {
  tenantId: string
  store: OutboxStore
  authorization: string
}

function resolve(request: Request): Ctx | null {
  const authorization = request.headers.get('authorization')
  const tenantId = tenantFromAuthHeader(authorization)
  if (!tenantId || !authorization) return null
  const store = getOutboxStore(tenantId)
  return store ? { tenantId, store, authorization } : null
}

const unavailable = () => ({
  available: false,
  counts: EMPTY_COUNTS,
  backend: 'ok' as const,
  nextAttemptAt: null,
  items: [],
})

function safeParse(text: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Resumen legible para la lista (sin el payload completo). */
function summarize(row: OutboxRow): Record<string, unknown> {
  const p = safeParse(row.payload) as Record<string, unknown> | null
  if (!p) return {}
  if (row.type === 'SALE') {
    const items = Array.isArray(p.items) ? (p.items as Record<string, unknown>[]) : []
    return {
      total: items.reduce((s, i) => s + (Number(i.total) || 0), 0),
      itemCount: items.length,
      products: items.slice(0, 3).map((i) => String(i.productName ?? i.productId ?? '')),
      cashAmount: p.cashAmount ?? 0,
      mpAmount: p.mpAmount ?? 0,
    }
  }
  return { description: p.description, amount: p.amount }
}

function present(row: OutboxRow, withPayload: boolean): Record<string, unknown> {
  return {
    clientId: row.clientId,
    type: row.type,
    status: row.status,
    createdAt: row.createdAt,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt,
    sentAt: row.sentAt,
    serverId: row.serverId,
    review: safeParse(row.reviewJson),
    error: row.error,
    dismissed: row.dismissedAt !== null,
    summary: summarize(row),
    ...(withPayload ? { payload: safeParse(row.payload) } : {}),
  }
}

export function senderStateOf(tenantId: string): SenderState {
  try {
    return getSender().state(tenantId)
  } catch {
    return { backend: 'ok', nextAttemptAt: null, failures: 0 }
  }
}

/** `{pending,review,failed}` para el aviso del header, o null si no hay outbox. */
export function outboxSummary(request: Request): { pending: number; review: number; failed: number; backend: string; nextAttemptAt: string | null } | null {
  const ctx = resolve(request)
  if (!ctx) return null
  const c = ctx.store.counts()
  const s = senderStateOf(ctx.tenantId)
  return { pending: c.pending, review: c.review, failed: c.failed, backend: s.backend, nextAttemptAt: s.nextAttemptAt }
}

export function listOutbox(request: Request): Response {
  const ctx = resolve(request)
  if (!ctx) return json(200, { success: true, data: unavailable() })

  const url = new URL(request.url)
  const detail = url.searchParams.get('detail')
  if (detail !== null) {
    if (!UUID.test(detail)) return json(400, { success: false, error: 'clientId inválido' })
    const row = ctx.store.getByClientId(detail.toLowerCase())
    return row ? json(200, { success: true, data: present(row, true) }) : json(404, { success: false, error: 'No encontrado' })
  }

  const requested = (url.searchParams.get('status') ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is OutboxStatus => (STATUSES as string[]).includes(s))
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), MAX_LIMIT)
  const offset = Math.max(Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0)

  const rows = ctx.store.list({ statuses: requested.length ? requested : DEFAULT_STATUSES, limit, offset })
  const state = senderStateOf(ctx.tenantId)
  return json(200, {
    success: true,
    data: {
      available: true,
      counts: ctx.store.counts(),
      backend: state.backend,
      nextAttemptAt: state.nextAttemptAt,
      items: rows.map((r) => present(r, false)),
    },
  })
}

export async function importLegacy(request: Request): Promise<Response> {
  const ctx = resolve(request)
  if (!ctx) return json(200, { success: true, data: { available: false, imported: [], rejected: [], ignored: [] } })

  let text: string
  try {
    text = await request.text()
  } catch {
    return json(400, { success: false, error: 'Cuerpo ilegible' })
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) return json(413, { success: false, error: 'Cuerpo demasiado grande' })

  let items: unknown
  try {
    items = (JSON.parse(text) as { items?: unknown })?.items
  } catch {
    return json(400, { success: false, error: 'JSON inválido' })
  }
  if (!Array.isArray(items)) return json(400, { success: false, error: 'Falta la lista items' })

  const result = importLegacyQueue(ctx.store, ctx.tenantId, items as LegacyQueuedPurchase[], userIdFromAuthHeader(ctx.authorization))
  if (result.imported.length > 0) {
    try {
      rememberSession(ctx.tenantId, ctx.authorization)
      getSender().kick(ctx.tenantId)
    } catch {
      /* el envío arranca en el próximo evento */
    }
  }
  return json(200, { success: true, data: { available: true, ...result } })
}

export function dismissItem(request: Request, clientId: string): Response {
  const ctx = resolve(request)
  if (!ctx) return json(404, { success: false, error: 'Outbox no disponible' })
  if (!UUID.test(clientId)) return json(400, { success: false, error: 'clientId inválido' })
  const ok = ctx.store.dismiss(clientId.toLowerCase())
  return ok
    ? json(200, { success: true, data: { clientId: clientId.toLowerCase(), dismissed: true } })
    : json(404, { success: false, error: 'No existe o no es un envío fallido' })
}
