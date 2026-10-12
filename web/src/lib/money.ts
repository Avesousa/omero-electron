/**
 * Formato de importes y números según la región del negocio.
 *
 * Los importes SIEMPRE se muestran con dos decimales y con los separadores de la región del negocio:
 * en Argentina `$ 1.234.567,89`. La región sale de la zona horaria configurada para el negocio (clave
 * `timezone` de la configuración); la moneda, de la clave `currency`. Sin datos: Argentina y pesos.
 *
 * El formato elegido se guarda en el navegador, así desde la primera pantalla se ve igual que la última vez.
 * Mismo archivo en `omero` (admin) y `omero-electron/web` (POS).
 *
 * Sin dependencias de React: lo importan también rutas de API (vía `quantity` → `scale` → `catalog/syncer`),
 * que corren en el servidor. El hook para re-renderizar está en `useMoneyLocale.ts`.
 */

export const DEFAULT_LOCALE = 'es-AR'
export const DEFAULT_CURRENCY = 'ARS'

/** Zona horaria → convención de números de ese país. La primera coincidencia (por prefijo) gana. */
const ZONE_LOCALES: [string, string][] = [
  ['America/Argentina/', 'es-AR'],
  ['America/Buenos_Aires', 'es-AR'],
  ['America/Cordoba', 'es-AR'],
  ['America/Mendoza', 'es-AR'],
  ['America/Montevideo', 'es-UY'],
  ['America/Asuncion', 'es-PY'],
  ['America/Santiago', 'es-CL'],
  ['America/Punta_Arenas', 'es-CL'],
  ['America/La_Paz', 'es-BO'],
  ['America/Lima', 'es-PE'],
  ['America/Bogota', 'es-CO'],
  ['America/Guayaquil', 'es-EC'],
  ['America/Caracas', 'es-VE'],
  ['America/Mexico_City', 'es-MX'],
  ['America/Monterrey', 'es-MX'],
  ['America/Cancun', 'es-MX'],
  ['America/Tijuana', 'es-MX'],
  ['America/Sao_Paulo', 'pt-BR'],
  ['Europe/Madrid', 'es-ES'],
]

/** Convención de números de la región de una zona horaria (`es-AR` si no se reconoce). */
export function localeForTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_LOCALE
  return ZONE_LOCALES.find(([prefix]) => tz === prefix || tz.startsWith(prefix))?.[1] ?? DEFAULT_LOCALE
}

export interface MoneyLocale {
  locale: string
  currency: string
}

const STORAGE_KEY = 'omero_money_locale'

function isValid(locale: string, currency: string): boolean {
  try {
    new Intl.NumberFormat(locale, { style: 'currency', currency })
    return true
  } catch {
    return false
  }
}

function readStored(): MoneyLocale | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MoneyLocale
    return parsed && isValid(parsed.locale, parsed.currency) ? parsed : null
  } catch {
    return null
  }
}

const DEFAULTS: MoneyLocale = { locale: DEFAULT_LOCALE, currency: DEFAULT_CURRENCY }
let current: MoneyLocale = readStored() ?? DEFAULTS
let formatters = build(current)
const listeners = new Set<() => void>()

function build({ locale, currency }: MoneyLocale) {
  return {
    money: new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    amount: new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }
}

/** Formato vigente. */
export function getMoneyLocale(): MoneyLocale {
  return current
}

/** Fija la región y la moneda (lo llama la carga de la configuración del negocio). */
export function setMoneyLocale(locale: string, currency: string = current.currency): void {
  const next: MoneyLocale = isValid(locale, currency)
    ? { locale, currency }
    : isValid(locale, DEFAULT_CURRENCY) ? { locale, currency: DEFAULT_CURRENCY } : DEFAULTS
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* sin almacenamiento: queda en memoria */
  }
  if (next.locale === current.locale && next.currency === current.currency) return
  current = next
  formatters = build(next)
  listeners.forEach(l => l())
}

/** A partir de la configuración del negocio: zona horaria (define la región) y moneda. */
export function setMoneyLocaleFromConfig(timezone: string | null | undefined, currency?: string | null): void {
  setMoneyLocale(localeForTimeZone(timezone), (currency || '').trim().toUpperCase() || current.currency)
}

const nz = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

/** Importe con símbolo y dos decimales: `$ 1.234,50`. */
export function formatMoney(n: number | null | undefined): string {
  return formatters.money.format(nz(n))
}

/** Importe sin símbolo, con dos decimales: `1.234,50`. */
export function formatAmount(n: number | null | undefined): string {
  return formatters.amount.format(nz(n))
}

/** Número con decimales fijos en el formato de la región (`0,350`). */
export function formatDecimal(n: number | null | undefined, decimals: number): string {
  return new Intl.NumberFormat(current.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(nz(n))
}

/** Número con hasta `maxDecimals` decimales, sin ceros de más (`1.234`, `2,5`). */
export function formatNumber(n: number | null | undefined, maxDecimals = 3): string {
  return new Intl.NumberFormat(current.locale, { maximumFractionDigits: maxDecimals }).format(nz(n))
}

/** Avisa cada vez que cambia el formato. Devuelve la función para dejar de escuchar. */
export function subscribeMoneyLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Formato por defecto (Argentina, pesos): el que se usa al renderizar en el servidor. */
export function getDefaultMoneyLocale(): MoneyLocale {
  return DEFAULTS
}
