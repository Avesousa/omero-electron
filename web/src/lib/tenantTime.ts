import { useEffect, useSyncExternalStore } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { getAuthToken } from '@/lib/sessionManager'

/**
 * Zona horaria del tenant (clave `timezone` de /api/business/config).
 *
 * El backend guarda todo en UTC; la zona solo define qué es "hoy" y en qué día/hora se muestra
 * cada instante. Todas las fechas de filtros (yyyy-MM-dd) y los horarios mostrados en pantalla
 * deben pasar por acá y no por la zona del navegador.
 */

/** Mismo default que el backend (TenantTimeZone.DEFAULT). */
export const DEFAULT_TENANT_TZ = 'America/Argentina/Buenos_Aires'

const STORAGE_KEY = 'omero_tenant_tz'

let currentTz = DEFAULT_TENANT_TZ
let loadedForToken: string | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('es-AR', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function readCache(token: string | null): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { token: string | null; tz: string }
    return parsed.token === token && isValidZone(parsed.tz) ? parsed.tz : null
  } catch {
    return null
  }
}

/** Zona del tenant ya conocida (sincrónica); el default hasta que se cargue. */
export function getTenantTimeZone(): string {
  return currentTz
}

export function setTenantTimeZone(tz: string, token: string | null = getAuthToken()): void {
  const next = isValidZone(tz) ? tz : DEFAULT_TENANT_TZ
  loadedForToken = token
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, tz: next }))
  } catch {
    /* sessionStorage no disponible: solo memoria */
  }
  if (next !== currentTz) {
    currentTz = next
    listeners.forEach(l => l())
  }
}

async function loadTenantTimeZone(): Promise<void> {
  const token = getAuthToken()
  if (!token) return
  if (loadedForToken === token) return

  const cached = readCache(token)
  if (cached && cached !== currentTz) {
    currentTz = cached
    listeners.forEach(l => l())
  }

  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await apiFetch<{ key: string; value: string }[]>('/api/business/config')
        if (res.success) {
          const tz = res.data.find(e => e.key === 'timezone')?.value
          setTenantTimeZone(tz || DEFAULT_TENANT_TZ, token)
        }
      } catch {
        /* se mantiene la zona actual */
      } finally {
        inflight = null
      }
    })()
  }
  await inflight
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Zona del tenant. Dispara la carga la primera vez y re-renderiza el componente cuando cambia,
 * así que los defaults de filtros deben depender de este valor.
 */
export function useTenantTimeZone(): string {
  const tz = useSyncExternalStore(subscribe, getTenantTimeZone, () => DEFAULT_TENANT_TZ)
  useEffect(() => {
    void loadTenantTimeZone()
  }, [])
  return tz
}

// ── Fechas (yyyy-MM-dd) ───────────────────────────────────────────────────────

/** Fecha (yyyy-MM-dd) del instante `d` vista desde la zona `tz`. */
export function isoDateIn(d: Date | string | number, tz: string = currentTz): string {
  // en-CA formatea como yyyy-MM-dd
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(d))
}

/** "Hoy" (yyyy-MM-dd) en la zona del tenant. */
export function todayISO(tz: string = currentTz): string {
  return isoDateIn(new Date(), tz)
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Suma días a una fecha yyyy-MM-dd (aritmética de calendario, sin zona ni DST). */
export function addDaysISO(iso: string, days: number): string {
  const d = parseISO(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return toISO(d)
}

/** Días entre dos fechas yyyy-MM-dd, ambas incluidas. */
export function inclusiveDaysBetween(startISO: string, endISO: string): number {
  return Math.round((parseISO(endISO).getTime() - parseISO(startISO).getTime()) / 86_400_000) + 1
}

export function firstDayOfMonthISO(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function lastDayOfMonthISO(iso: string): string {
  const d = parseISO(firstDayOfMonthISO(iso))
  d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return toISO(d)
}

// ── Formato de horarios ───────────────────────────────────────────────────────

/** Fecha y hora del instante, en la zona del tenant. */
export function formatDateTimeTz(
  iso: string | number | Date,
  opts: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  },
  tz: string = currentTz,
  locale = 'es-AR',
): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz }).format(new Date(iso))
}

export function formatTimeTz(iso: string | number | Date, tz: string = currentTz, locale = 'es-AR'): string {
  return formatDateTimeTz(iso, { hour: '2-digit', minute: '2-digit' }, tz, locale)
}
