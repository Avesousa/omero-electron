import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mixedProduct, weightProduct } from '../../lib/__tests__/fixtures'
import { openWeightEntry, type WeightEntryState } from '../../lib/weightEntry'
import { WeightEntryModal } from './WeightEntryModal'

const KG = { gramsMode: false, tab: 'KG' as const }
const open = (state: WeightEntryState) => {
  const onKeyPress = vi.fn()
  render(<WeightEntryModal state={state} onKeyPress={onKeyPress} />)
  return onKeyPress
}

describe('WeightEntryModal', () => {
  it('cerrado no dibuja nada', () => {
    const { container } = render(<WeightEntryModal state={null} onKeyPress={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('producto por peso: pide los kilos y no deja agregar sin peso', () => {
    open(openWeightEntry(weightProduct(), KG))
    expect(screen.getByText('Queso cremoso')).toBeInTheDocument()
    expect(screen.getByText('Ingresá el peso en kilos')).toBeInTheDocument()
    expect(screen.getByText(/\$ 8\.000,00 \/kg/)).toBeInTheDocument()
    expect(screen.getByText(/Stock 12,500 kg/)).toBeInTheDocument()
    expect(screen.getByText('$—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agregar/ })).toBeDisabled()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('con peso cargado muestra el importe y habilita agregar', () => {
    const onKeyPress = open({ ...openWeightEntry(weightProduct(), KG), input: '0.35' })
    expect(screen.getByText('0,35')).toBeInTheDocument()
    expect(screen.getByText('$ 2.800,00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }))
    expect(onKeyPress).toHaveBeenCalledWith('Enter')
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }))
    expect(onKeyPress).toHaveBeenCalledWith('Escape')
  })

  it('en gramos muestra la equivalencia en kilos', () => {
    open({ ...openWeightEntry(weightProduct(), { gramsMode: true, tab: 'KG' }), input: '350' })
    expect(screen.getByText('Ingresá el peso en gramos')).toBeInTheDocument()
    expect(screen.getByText('= 0,350 kg')).toBeInTheDocument()
    expect(screen.getByText('$ 2.800,00')).toBeInTheDocument()
  })

  it('producto por unidad y peso: pestañas, y el botón de la otra pestaña manda /', () => {
    const onKeyPress = open(openWeightEntry(mixedProduct(), KG))
    expect(screen.getByText(/\$ 1\.200,00 \/u/)).toBeInTheDocument()
    const byWeight = screen.getByRole('tab', { name: 'Por peso' })
    const byUnit = screen.getByRole('tab', { name: 'Por unidad' })
    expect(byWeight).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(byWeight)
    expect(onKeyPress).not.toHaveBeenCalled()
    fireEvent.click(byUnit)
    expect(onKeyPress).toHaveBeenCalledWith('/')
  })

  it('en unidades pide la cantidad y cobra el precio por unidad', () => {
    open({ ...openWeightEntry(mixedProduct(), { gramsMode: false, tab: 'UNIT' }), input: '3' })
    expect(screen.getByText('Ingresá la cantidad de unidades')).toBeInTheDocument()
    expect(screen.getByText('$ 3.600,00')).toBeInTheDocument()
    expect(screen.queryByText(/cambia entre kg y gramos/)).not.toBeInTheDocument()
  })

  it('aviso de peso grande', () => {
    open({ ...openWeightEntry(weightProduct(), KG), input: '350', largeWeightWarning: true })
    expect(screen.getByRole('alert')).toHaveTextContent('350,000 kg')
  })

  it('corregir una pesada: muestra el peso actual, sin pestañas, y guarda', () => {
    open(openWeightEntry(mixedProduct(), KG, { lineId: 'l1', weightKg: 0.4 }))
    expect(screen.getByText('Corregir peso · Pan de campo')).toBeInTheDocument()
    expect(screen.getByText('Peso actual: 0,400 kg')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeInTheDocument()
  })
})
