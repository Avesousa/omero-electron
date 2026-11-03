import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionConflictModal } from './SessionConflictModal'

describe('SessionConflictModal', () => {
  it('muestra el aviso en español con la última actividad', () => {
    render(<SessionConflictModal isOpen lastSeenAt="2026-11-02T15:30:00Z" onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByText(/Ya tenés una sesión abierta en otro navegador o equipo \(última actividad: .+\)/)).toBeInTheDocument()
    expect(screen.getByText(/esa sesión se cerrará y tendrá que ingresar de nuevo/)).toBeInTheDocument()
  })

  it('sin lastSeenAt omite el paréntesis', () => {
    render(<SessionConflictModal isOpen onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.queryByText(/última actividad/)).toBeNull()
  })

  it('Cancelar y "Cerrar la otra y continuar" llaman a sus callbacks', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<SessionConflictModal isOpen onCancel={onCancel} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar la otra y continuar' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('no renderiza nada cerrado', () => {
    render(<SessionConflictModal isOpen={false} onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.queryByText('Cerrar la otra y continuar')).toBeNull()
  })
})
