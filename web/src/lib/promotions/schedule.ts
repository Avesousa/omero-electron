/**
 * Vigencia de una promoción (fechas, días y franja horaria). Pura: la misma regla que `PromotionSchedule` del backend
 * y que el admin (casos compartidos en `lib/__fixtures__/promo-cases.json`).
 *
 * - `startsAt` inclusivo, `endsAt` exclusivo (instantes absolutos).
 * - `days` 1 = lunes ... 7 = domingo, en la zona del negocio; null / [] / los 7 = todos.
 * - Franja `[timeFrom, timeTo)` "HH:mm" en la hora del negocio, sin cruzar la medianoche; solo rige si vienen las dos.
 * - Sin ninguno de estos campos la promo está siempre activa (promos viejas).
 *
 * La caja NO confía en el campo `schedule` que manda el backend (puede venir viejo en un 304): recalcula con estos campos.
 */
export interface PromotionSchedule {
  startsAt?: string | null
  endsAt?: string | null
  days?: number[] | null
  timeFrom?: string | null
  timeTo?: string | null
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Día (1..7) y minutos desde la medianoche de `now` en `timeZone`. */
function localParts(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = formatterFor(timeZone).formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return {
    day: WEEKDAY[get('weekday')] ?? 0,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

function toMillis(iso: string): number {
  return new Date(iso).getTime()
}

export function isPromotionActiveNow(promo: PromotionSchedule, now: Date, timeZone: string): boolean {
  const t = now.getTime()
  if (promo.endsAt && t >= toMillis(promo.endsAt)) return false
  if (promo.startsAt && t < toMillis(promo.startsAt)) return false

  const restrictsDays = !!promo.days && promo.days.length > 0 && new Set(promo.days).size < 7
  const restrictsTime = !!promo.timeFrom && !!promo.timeTo
  if (!restrictsDays && !restrictsTime) return true

  let local: { day: number; minutes: number }
  try {
    local = localParts(now, timeZone)
  } catch {
    return true // zona inválida: no se bloquea la venta por un dato roto
  }
  if (restrictsDays && !promo.days!.includes(local.day)) return false
  if (restrictsTime && (local.minutes < toMinutes(promo.timeFrom!) || local.minutes >= toMinutes(promo.timeTo!))) return false
  return true
}
