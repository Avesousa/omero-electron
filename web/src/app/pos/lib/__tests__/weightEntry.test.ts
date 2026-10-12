import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LARGE_WEIGHT_KG, loadWeightPrefs, openWeightEntry, resolveWeightEntry, saveWeightPrefs, weightEntryKey,
  weightEntryPrice, weightEntrySubtotal, weightEntryValue, type WeightEntryState,
} from '../weightEntry'
import { mixedProduct, weightProduct } from './fixtures'

const KG = { gramsMode: false, tab: 'KG' as const }

/** Aplica una secuencia de teclas; falla si alguna pide confirmar o cancelar. */
function type(state: WeightEntryState, keys: string): WeightEntryState {
  for (const key of keys.split(' ')) {
    const next = weightEntryKey(state, key)
    if (typeof next === 'string') throw new Error(`tecla inesperada: ${key}`)
    state = next
  }
  return state
}

beforeEach(() => localStorage.clear())

describe('abrir el panel', () => {
  it('producto por peso: pestaña de peso, vacío', () => {
    expect(openWeightEntry(weightProduct(), KG)).toEqual({
      product: weightProduct(), tab: 'KG', gramsMode: false, input: '', largeWeightWarning: false,
    })
  })

  it('un producto solo por peso nunca abre en unidades aunque la preferencia lo diga', () => {
    expect(openWeightEntry(weightProduct(), { gramsMode: true, tab: 'UNIT' })).toMatchObject({ tab: 'KG', gramsMode: true })
  })

  it('producto mixto: abre en la última pestaña usada', () => {
    expect(openWeightEntry(mixedProduct(), { gramsMode: false, tab: 'UNIT' }).tab).toBe('UNIT')
  })

  it('corregir una pesada: siempre en peso, con el peso actual a la vista', () => {
    const state = openWeightEntry(mixedProduct(), { gramsMode: false, tab: 'UNIT' }, { lineId: 'l1', weightKg: 0.4 })
    expect(state).toMatchObject({ tab: 'KG', editLineId: 'l1', currentWeightKg: 0.4 })
  })
})

describe('teclas', () => {
  it('Enter y + confirman, Esc cancela', () => {
    const state = openWeightEntry(weightProduct(), KG)
    expect(weightEntryKey(state, 'Enter')).toBe('confirm')
    expect(weightEntryKey(state, '+')).toBe('confirm')
    expect(weightEntryKey(state, 'Escape')).toBe('cancel')
  })

  it('kilos: hasta 3 decimales y un solo separador', () => {
    const state = type(openWeightEntry(weightProduct(), KG), '0 . 3 5 0 9 .')
    expect(state.input).toBe('0.350')
    expect(weightEntryValue(state)).toEqual({ unit: 'KG', quantity: 0.35 })
  })

  it('el separador solo completa el cero; la coma vale como punto', () => {
    expect(type(openWeightEntry(weightProduct(), KG), '. 5').input).toBe('0.5')
    expect(type(openWeightEntry(weightProduct(), KG), '1 , 2').input).toBe('1.2')
  })

  it('sin ceros a la izquierda y con tope de dígitos', () => {
    expect(type(openWeightEntry(weightProduct(), KG), '0 0 7').input).toBe('7')
    expect(type(openWeightEntry(weightProduct(), KG), '1 2 3 4 5').input).toBe('1234')
  })

  it('* pasa a gramos, limpia lo escrito y no admite decimales', () => {
    const grams = type(openWeightEntry(weightProduct(), KG), '1 . 5 *')
    expect(grams).toMatchObject({ gramsMode: true, input: '' })
    const typed = type(grams, '3 5 0 .')
    expect(typed.input).toBe('350')
    expect(weightEntryValue(typed)).toEqual({ unit: 'KG', quantity: 0.35 })
    expect(type(typed, '*')).toMatchObject({ gramsMode: false, input: '' })
    expect(type(grams, '1 2 3 4 5 6 7').input).toBe('123456')
  })

  it('⌫ borra de a un carácter', () => {
    expect(type(openWeightEntry(weightProduct(), KG), '1 . 2 Backspace Backspace').input).toBe('1')
    expect(type(openWeightEntry(weightProduct(), KG), 'Backspace').input).toBe('')
  })

  it('/ alterna peso ↔ unidades solo en productos mixtos, y limpia lo escrito', () => {
    const units = type(openWeightEntry(mixedProduct(), KG), '1 /')
    expect(units).toMatchObject({ tab: 'UNIT', input: '' })
    expect(type(units, '/').tab).toBe('KG')
    expect(type(openWeightEntry(weightProduct(), KG), '/').tab).toBe('KG')
  })

  it('en unidades: enteros, sin gramos ni decimales', () => {
    const units = type(openWeightEntry(mixedProduct(), { gramsMode: false, tab: 'UNIT' }), '3 . *')
    expect(units).toMatchObject({ input: '3', gramsMode: false })
    expect(weightEntryValue(units)).toEqual({ unit: 'UNIT', quantity: 3 })
    expect(type(units, '0 0 0 0').input).toBe('3000')
  })

  it('corrigiendo una pesada no se puede pasar a unidades', () => {
    const edit = openWeightEntry(mixedProduct(), KG, { lineId: 'l1', weightKg: 0.4 })
    expect(type(edit, '/').tab).toBe('KG')
  })

  it('una tecla que no es del panel no cambia nada', () => {
    const state = type(openWeightEntry(weightProduct(), KG), '1')
    expect(weightEntryKey(state, 'Tab')).toBe(state)
    expect(weightEntryKey(state, 't')).toBe(state)
  })
})

describe('valor e importe', () => {
  it('sin nada cargado no hay valor ni importe', () => {
    const empty = openWeightEntry(weightProduct(), KG)
    expect(weightEntryValue(empty)).toBeNull()
    expect(weightEntrySubtotal(empty)).toBe(0)
    expect(weightEntryValue(type(empty, '0'))).toBeNull()
    expect(weightEntryValue(type(empty, '0 .'))).toBeNull()
  })

  it('importe por kg y por unidad', () => {
    expect(weightEntrySubtotal(type(openWeightEntry(weightProduct(), KG), '0 . 3 5'))).toBe(2800)
    const mixed = openWeightEntry(mixedProduct(), KG)
    expect(weightEntryPrice(mixed)).toBe(4000)
    const units = type(mixed, '/ 3')
    expect(weightEntryPrice(units)).toBe(1200)
    expect(weightEntrySubtotal(units)).toBe(3600)
  })
})

describe('confirmar', () => {
  it('vacío: no se puede agregar', () => {
    expect(resolveWeightEntry(openWeightEntry(weightProduct(), KG), 10)).toEqual({ kind: 'empty' })
  })

  it('peso dentro del stock', () => {
    const state = type(openWeightEntry(weightProduct(), KG), '1 . 2 5')
    expect(resolveWeightEntry(state, 12.5)).toEqual({ kind: 'ok', unit: 'KG', quantity: 1.25 })
  })

  it('justo el stock disponible se puede vender', () => {
    expect(resolveWeightEntry(type(openWeightEntry(weightProduct(), KG), '2'), 2)).toMatchObject({ kind: 'ok' })
  })

  it('más que el stock: avisa cuánto queda', () => {
    const state = type(openWeightEntry(weightProduct(), KG), '3')
    expect(resolveWeightEntry(state, 2.5)).toEqual({ kind: 'no-stock', available: 2.5 })
    expect(resolveWeightEntry(state, -1)).toEqual({ kind: 'no-stock', available: 0 })
  })

  it('unidades de un mixto consumen su peso', () => {
    const state = type(openWeightEntry(mixedProduct(), { gramsMode: false, tab: 'UNIT' }), '4') // 1 kg
    expect(resolveWeightEntry(state, 1)).toEqual({ kind: 'ok', unit: 'UNIT', quantity: 4 })
    expect(resolveWeightEntry(state, 0.9)).toEqual({ kind: 'no-stock', available: 0.9 })
  })

  it(`${LARGE_WEIGHT_KG} kg o más pide una segunda confirmación (antes que el stock)`, () => {
    const state = type(openWeightEntry(weightProduct(), KG), '3 5 0')
    expect(resolveWeightEntry(state, 5)).toEqual({ kind: 'warn-large', weightKg: 350 })
    const warned = { ...state, largeWeightWarning: true }
    expect(resolveWeightEntry(warned, 500)).toEqual({ kind: 'ok', unit: 'KG', quantity: 350 })
    expect(resolveWeightEntry(warned, 5)).toEqual({ kind: 'no-stock', available: 5 })
  })

  it('cambiar lo cargado descarta el aviso de peso grande', () => {
    const warned = { ...type(openWeightEntry(weightProduct(), KG), '3 5 0'), largeWeightWarning: true }
    expect(type(warned, 'Backspace').largeWeightWarning).toBe(false)
    expect(type(warned, '*').largeWeightWarning).toBe(false)
  })

  it('muchas unidades no disparan el aviso de peso grande', () => {
    const state = type(openWeightEntry(mixedProduct(), { gramsMode: false, tab: 'UNIT' }), '2 0 0')
    expect(resolveWeightEntry(state, 1000)).toEqual({ kind: 'ok', unit: 'UNIT', quantity: 200 })
  })
})

describe('preferencias de la caja', () => {
  it('primera vez: kilos y pestaña de peso', () => {
    expect(loadWeightPrefs(mixedProduct())).toEqual({ gramsMode: false, tab: 'KG' })
  })

  it('recuerda kg/g para toda la caja y la pestaña por producto mixto', () => {
    saveWeightPrefs(type(openWeightEntry(weightProduct(), KG), '*'))
    expect(loadWeightPrefs(weightProduct())).toEqual({ gramsMode: true, tab: 'KG' })

    saveWeightPrefs(type(openWeightEntry(mixedProduct(), KG), '/'))
    expect(loadWeightPrefs(mixedProduct())).toEqual({ gramsMode: true, tab: 'UNIT' }) // la pestaña no pisa kg/g
    expect(loadWeightPrefs(mixedProduct({ code: '099' })).tab).toBe('KG')
    expect(loadWeightPrefs(weightProduct()).tab).toBe('KG')
  })

  it('sin localStorage usa los valores por defecto y no rompe', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    expect(loadWeightPrefs(mixedProduct())).toEqual({ gramsMode: false, tab: 'KG' })
    expect(() => saveWeightPrefs(openWeightEntry(mixedProduct(), KG))).not.toThrow()
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
