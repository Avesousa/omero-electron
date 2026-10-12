import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DEFAULT_CURRENCY, DEFAULT_LOCALE, formatAmount, formatDecimal, formatMoney, formatNumber, getMoneyLocale,
  localeForTimeZone, setMoneyLocale, setMoneyLocaleFromConfig,
} from './money'
import { useMoneyLocale } from './useMoneyLocale'

/** Intl usa espacio duro entre símbolo y número; para comparar, espacio común. */
const plain = (s: string) => s.replace(/ | /g, ' ')

afterEach(() => {
  setMoneyLocale(DEFAULT_LOCALE, DEFAULT_CURRENCY)
  localStorage.clear()
})

describe('formato argentino (por defecto)', () => {
  it('siempre dos decimales, punto de miles y coma decimal', () => {
    expect(plain(formatMoney(123456789))).toBe('$ 123.456.789,00')
    expect(plain(formatMoney(1234.5))).toBe('$ 1.234,50')
    expect(plain(formatMoney(0.1 + 0.2))).toBe('$ 0,30')
    expect(plain(formatMoney(-50))).toBe('-$ 50,00')
    expect(formatAmount(1234.5)).toBe('1.234,50')
    expect(formatAmount(4200)).toBe('4.200,00')
  })

  it('valores vacíos o inválidos se muestran como cero', () => {
    expect(formatAmount(undefined)).toBe('0,00')
    expect(formatAmount(null)).toBe('0,00')
    expect(formatAmount(Number.NaN)).toBe('0,00')
  })

  it('otros números con la convención de la región', () => {
    expect(formatDecimal(0.35, 3)).toBe('0,350')
    expect(formatNumber(1234.5)).toBe('1.234,5')
    expect(formatNumber(3)).toBe('3')
  })
})

describe('región según la zona horaria del negocio', () => {
  it.each([
    ['America/Argentina/Buenos_Aires', 'es-AR'],
    ['America/Argentina/Cordoba', 'es-AR'],
    ['America/Buenos_Aires', 'es-AR'],
    ['America/Montevideo', 'es-UY'],
    ['America/Santiago', 'es-CL'],
    ['America/Mexico_City', 'es-MX'],
    ['America/Sao_Paulo', 'pt-BR'],
    ['Europe/Madrid', 'es-ES'],
    ['Asia/Tokyo', 'es-AR'],
    ['', 'es-AR'],
    [null, 'es-AR'],
  ])('%s → %s', (tz, locale) => {
    expect(localeForTimeZone(tz)).toBe(locale)
  })

  it('México con pesos mexicanos: coma de miles y punto decimal', () => {
    setMoneyLocaleFromConfig('America/Mexico_City', 'mxn')
    expect(getMoneyLocale()).toEqual({ locale: 'es-MX', currency: 'MXN' })
    expect(plain(formatMoney(1234.5))).toBe('$1,234.50')
    expect(formatAmount(1234.5)).toBe('1,234.50')
  })

  it('sin moneda configurada conserva la actual; una moneda inválida cae a pesos argentinos', () => {
    setMoneyLocaleFromConfig('America/Montevideo', null)
    expect(getMoneyLocale()).toEqual({ locale: 'es-UY', currency: 'ARS' })
    setMoneyLocale('es-AR', 'NO-EXISTE')
    expect(getMoneyLocale()).toEqual({ locale: 'es-AR', currency: 'ARS' })
  })

  it('se recuerda en el navegador', () => {
    setMoneyLocaleFromConfig('America/Santiago', 'CLP')
    expect(JSON.parse(localStorage.getItem('omero_money_locale')!)).toEqual({ locale: 'es-CL', currency: 'CLP' })
  })

  it('el hook re-renderiza al cambiar el formato', () => {
    const { result } = renderHook(() => useMoneyLocale())
    expect(result.current.locale).toBe('es-AR')
    act(() => setMoneyLocaleFromConfig('America/Mexico_City', 'MXN'))
    expect(result.current).toEqual({ locale: 'es-MX', currency: 'MXN' })
  })
})
