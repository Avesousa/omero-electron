import { describe, expect, it } from 'vitest'
import fixtures from '../__fixtures__/scale-cases.json'
import {
  DEFAULT_SCALE_CONFIG, ean13CheckDigit, getScaleProfile, isValidEan13, looksLikeScaleBarcode, normalizeTemplate,
  parseScaleBarcode, parseWithTemplate, SCALE_CONFIG_KEYS, SCALE_PROFILES, scaleConfigFromEntries, scaleLineFor,
  splitTemplates, templatePrefix, templateProblem, withCheckDigit,
  type ScaleConfig,
} from './index'

interface FixtureCase {
  name: string
  code: string
  config: ScaleConfig
  expect: null | { kind: 'reading' | 'unsupported'; plu?: number; amount?: number; weightKg?: number; template?: string; reason?: string }
}

/** Los mismos casos en el admin y en el POS: las dos copias de lib/scale tienen que leer igual. */
describe('casos compartidos (scale-cases.json)', () => {
  for (const c of (fixtures as { cases: FixtureCase[] }).cases) {
    it(c.name, () => {
      const result = parseScaleBarcode(c.code, c.config)
      if (c.expect === null) {
        expect(result).toBeNull()
      } else if (c.expect.kind === 'unsupported') {
        expect(result).toEqual({ kind: 'unsupported', reason: c.expect.reason })
      } else {
        const { kind, ...reading } = c.expect
        expect(result).toEqual({ kind, reading })
      }
    })
  }
})

describe('EAN-13', () => {
  it('calcula y valida el dígito verificador', () => {
    expect(ean13CheckDigit('200123004200')).toBe(4)
    expect(withCheckDigit('200123004200')).toBe('2001230042004')
    expect(isValidEan13('2001230042004')).toBe(true)
    expect(isValidEan13('2001230042005')).toBe(false)
    expect(isValidEan13(withCheckDigit('779000100001'))).toBe(true)
    expect(isValidEan13('200123004200')).toBe(false)
    expect(isValidEan13('200123004200X')).toBe(false)
    expect(looksLikeScaleBarcode('2001230042004')).toBe(true)
    expect(looksLikeScaleBarcode('001')).toBe(false)
  })
})

describe('plantillas', () => {
  it('acepta la de fábrica de Systel y variantes con peso', () => {
    expect(templateProblem('20PPPPIIIIII')).toBeNull()
    expect(templateProblem('20PPPPPCCCCC')).toBeNull()
    expect(templateProblem('20SBPPPPIIII')).toBeNull()
    expect(templateProblem(' 20ppppiiiiii ')).toBeNull()
    expect(normalizeTemplate(' 20ppppiiiiii ')).toBe('20PPPPIIIIII')
    expect(templatePrefix('20PPPPIIIIII')).toBe('20')
  })

  it('explica por qué una plantilla no sirve', () => {
    expect(templateProblem('20PPPPIIIII')).toContain('12 caracteres')
    expect(templateProblem('20PPPP-IIIII')).toContain('dígitos y letras')
    expect(templateProblem('PPPPPPIIIIII')).toContain('encabezado')
    expect(templateProblem('20SSSSIIIIII')).toContain('PLU')
    expect(templateProblem('20PPPPSSSSSS')).toContain('importe')
    expect(templateProblem('20PPIIPPIIII')).toContain('juntas')
  })

  it('una plantilla inválida no interpreta nada', () => {
    expect(parseWithTemplate('2001230042004', '20PPPP', { amountDecimals: 2, weightDecimals: 3 })).toBeNull()
  })

  it('separa varias plantillas', () => {
    expect(splitTemplates('20ppppiiiiii, 25PPPPPCCCCC ,')).toEqual(['20PPPPIIIIII', '25PPPPPCCCCC'])
    expect(splitTemplates(null)).toEqual([])
  })
})

describe('perfiles', () => {
  it('Systel es la marca por defecto y trae sus valores de fábrica', () => {
    expect(Object.keys(SCALE_PROFILES)).toEqual(['SYSTEL'])
    expect(getScaleProfile('systel')?.label).toBe('Systel')
    expect(getScaleProfile('KRETZ')).toBeNull()
    expect(getScaleProfile(null)).toBeNull()
    expect(DEFAULT_SCALE_CONFIG).toEqual({
      enabled: false, brand: 'SYSTEL', templates: ['20PPPPIIIIII'], amountDecimals: 2, weightDecimals: 3,
    })
    for (const profile of Object.values(SCALE_PROFILES)) {
      for (const template of profile.defaultTemplates) expect(templateProblem(template)).toBeNull()
    }
  })
})

describe('configuración del negocio', () => {
  it('se arma con las claves scale_*', () => {
    expect(SCALE_CONFIG_KEYS).toEqual(['scale_enabled', 'scale_brand', 'scale_barcode_templates', 'scale_amount_decimals', 'scale_weight_decimals'])
    expect(scaleConfigFromEntries({
      scale_enabled: 'true', scale_brand: 'systel', scale_barcode_templates: '20PPPPPCCCCC', scale_amount_decimals: '0', scale_weight_decimals: '3',
    })).toEqual({ enabled: true, brand: 'SYSTEL', templates: ['20PPPPPCCCCC'], amountDecimals: 0, weightDecimals: 3 })
  })

  it('lo que falta o no se entiende toma el valor de fábrica', () => {
    expect(scaleConfigFromEntries({})).toEqual(DEFAULT_SCALE_CONFIG)
    expect(scaleConfigFromEntries({ scale_enabled: 'si', scale_barcode_templates: 'cualquiera', scale_amount_decimals: 'x', scale_weight_decimals: '9' }))
      .toEqual(DEFAULT_SCALE_CONFIG)
    expect(scaleConfigFromEntries({ scale_enabled: ' TRUE ', scale_brand: 'kretz' }))
      .toEqual({ ...DEFAULT_SCALE_CONFIG, enabled: true, brand: 'KRETZ' })
  })
})

describe('línea a cobrar', () => {
  it('con importe en la etiqueta se cobra ese importe y el peso se calcula', () => {
    expect(scaleLineFor({ plu: 123, amount: 4200, template: 't' }, 12000)).toEqual({ weightKg: 0.35, total: 4200, totalFromLabel: true })
  })

  it('con peso en la etiqueta, peso × precio', () => {
    expect(scaleLineFor({ plu: 123, weightKg: 0.35, template: 't' }, 12000)).toEqual({ weightKg: 0.35, total: 4200, totalFromLabel: false })
  })

  it('con peso e importe se respetan los dos', () => {
    expect(scaleLineFor({ plu: 123, weightKg: 0.352, amount: 4200, template: 't' }, 12000)).toEqual({ weightKg: 0.352, total: 4200, totalFromLabel: true })
  })

  it('sin precio por kg no se puede armar la línea', () => {
    expect(scaleLineFor({ plu: 123, amount: 4200, template: 't' }, 0)).toBeNull()
    expect(scaleLineFor({ plu: 123, amount: 4200, template: 't' }, null)).toBeNull()
    expect(scaleLineFor({ plu: 123, weightKg: 0.35, template: 't' }, null)).toBeNull()
    expect(scaleLineFor({ plu: 123, template: 't' }, 12000)).toBeNull()
    expect(scaleLineFor({ plu: 123, amount: 0, weightKg: 0, template: 't' }, 12000)).toBeNull()
  })

  it('un perfil con parse propio no pasa por las plantillas', () => {
    const custom = { ...SCALE_PROFILES.SYSTEL, parse: () => ({ plu: 9, weightKg: 1, template: 'custom' }) }
    const original = SCALE_PROFILES.SYSTEL
    ;(SCALE_PROFILES as Record<string, unknown>).SYSTEL = custom
    try {
      expect(parseScaleBarcode('2001230042004', { ...DEFAULT_SCALE_CONFIG, enabled: true }))
        .toEqual({ kind: 'reading', reading: { plu: 9, weightKg: 1, template: 'custom' } })
    } finally {
      ;(SCALE_PROFILES as Record<string, unknown>).SYSTEL = original
    }
  })
})
