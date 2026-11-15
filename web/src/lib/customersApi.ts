import { apiFetch, type ApiResult } from '@/lib/apiClient'
import { creditError, isConnectionError, OFFLINE_CUSTOMER_MESSAGE, OFFLINE_DETAIL_MESSAGE } from '@/lib/creditErrors'
import type { CollectResult, Customer, CustomerDetail } from '@/shared/types/credit'

/**
 * API de clientes y crédito que usa el POS de la caja. SOLO las rutas que el JWT de caja (`scope=pos`) puede llamar
 * (ver `lib/device/allowlist.contract.test.ts`): lista, detalle, alta rápida y cobro. El alta completa, la edición, los
 * campos extra y la revisión de cobros son del admin (`omero`) y NO viven acá.
 *
 * Offline (desktop): `GET /api/customers?onlyActive=true` y el detalle salen de la caché SQLite; el cobro va al outbox
 * (`POST /api/credit/collect`, `CREDIT_COLLECTION`). El alta rápida NO tiene soporte offline (necesita el código que
 * asigna el backend): sin conexión devuelve un error claro en español.
 */

function wrap<T>(r: ApiResult<T>, fallback: string): ApiResult<T> {
  return r.success ? r : { ...r, error: creditError(r as { error?: string; code?: string }, fallback) }
}

/**
 * Lista de clientes. `onlyActive=true` es la ÚNICA variante que cachea el servidor local (`catalog/cache-policy`):
 * cualquier otra se pide siempre al backend.
 */
export async function fetchCustomers(onlyActive = true): Promise<ApiResult<Customer[]>> {
  return wrap(await apiFetch<Customer[]>(`/api/customers?onlyActive=${onlyActive}`), 'No se pudieron cargar los clientes.')
}

/** Detalle con las líneas pendientes. Offline solo existe si el cliente se consultó antes con conexión. */
export async function fetchCustomerDetail(id: string): Promise<ApiResult<CustomerDetail>> {
  const r = await apiFetch<CustomerDetail>(`/api/customers/${id}/detail`)
  if (!r.success && isConnectionError(r.error)) return { ...r, error: OFFLINE_DETAIL_MESSAGE }
  return wrap(r, 'No se pudo cargar el cliente.')
}

/**
 * Alta rápida del POS: todo opcional; sin nombre queda «Cliente <código>», sin código toma el siguiente.
 * Sin soporte offline (el código lo asigna el backend): sin conexión devuelve un error en español.
 */
export async function quickCreateCustomer(input: { name?: string; code?: number } = {}): Promise<ApiResult<Customer>> {
  let r: ApiResult<Customer>
  try {
    r = await apiFetch<Customer>('/api/customers/quick', { method: 'POST', body: JSON.stringify(input) })
  } catch {
    return { success: false, error: OFFLINE_CUSTOMER_MESSAGE }
  }
  if (!r.success && isConnectionError(r.error)) return { ...r, error: OFFLINE_CUSTOMER_MESSAGE }
  return wrap(r, 'No se pudo crear el cliente.')
}

export interface CollectInput {
  customerId: string
  /** uuid idempotente: reintentar con el mismo no duplica el cobro. */
  clientId?: string
  payments: Array<{ paymentMethodId: string; amount: number }>
  expectedDebt?: number
}

/** Cobro de deuda. En desktop queda siempre en el outbox de la caja (también online) y se sube en segundo plano. */
export async function collectCredit(input: CollectInput): Promise<ApiResult<CollectResult>> {
  return wrap(await apiFetch<CollectResult>('/api/credit/collect', { method: 'POST', body: JSON.stringify(input) }), 'No se pudo registrar el cobro.')
}
