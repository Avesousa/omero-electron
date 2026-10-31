import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionStatusState } from '../hooks/useConnectionStatus'
import { ConnectionStatus, formatCacheAge } from './ConnectionStatus'

function status(over: Partial<ConnectionStatusState> = {}): ConnectionStatusState {
  return {
    runtime: 'desktop',
    online: true,
    cache: { lastSyncAt: '2026-01-01T10:00:00Z', ageSeconds: 300, products: 25, promotions: 2 },
    checking: false,
    lastCheckedAt: '2026-01-01T10:05:00Z',
    check: vi.fn(async () => {}),
    ...over,
  }
}

describe('formatCacheAge', () => {
  it.each([
    [0, 'hace instantes'],
    [59, 'hace instantes'],
    [60, 'hace 1 min'],
    [300, 'hace 5 min'],
    [3599, 'hace 59 min'],
    [3600, 'hace 1 h'],
    [7300, 'hace 2 h'],
    [86_400, 'hace 1 día'],
    [86_400 * 3, 'hace 3 días'],
  ])('%is → %s', (seconds, text) => {
    expect(formatCacheAge(seconds)).toBe(text)
  })
})

describe('<ConnectionStatus />', () => {
  it('desktop con conexión y sin pendientes: no muestra nada', () => {
    const { container } = render(<ConnectionStatus status={status()} pendingCount={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['web', null] as const)('runtime %s: no muestra nada (el header de web no cambia)', (runtime) => {
    const { container } = render(<ConnectionStatus status={status({ runtime, online: false })} pendingCount={5} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('sin conexión: muestra el aviso con la antigüedad del catálogo y el botón Actualizar', () => {
    render(<ConnectionStatus status={status({ online: false })} pendingCount={0} />)
    expect(screen.getByText(/Sin conexión con el servidor · catálogo hace 5 min/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Actualizar/ })).toBeEnabled()
    expect(screen.queryByText(/pendiente/)).not.toBeInTheDocument()
  })

  it('sin conexión y sin datos locales: lo indica', () => {
    const cache = { lastSyncAt: null, ageSeconds: null, products: 0, promotions: 0 }
    render(<ConnectionStatus status={status({ online: false, cache })} pendingCount={0} />)
    expect(screen.getByText(/sin datos locales/)).toBeInTheDocument()
  })

  it('sin conexión y sin info de caché: solo el aviso, sin texto de catálogo', () => {
    render(<ConnectionStatus status={status({ online: false, cache: null })} pendingCount={0} />)
    expect(screen.getByText('Sin conexión con el servidor')).toBeInTheDocument()
  })

  it('con conexión pero con pendientes: muestra el contador (singular y plural) y el botón', () => {
    const { rerender } = render(<ConnectionStatus status={status()} pendingCount={1} />)
    expect(screen.getByText('1 pendiente sin sync')).toBeInTheDocument()
    expect(screen.queryByText(/Sin conexión/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Actualizar/ })).toBeInTheDocument()
    rerender(<ConnectionStatus status={status()} pendingCount={3} />)
    expect(screen.getByText('3 pendientes sin sync')).toBeInTheDocument()
  })

  it('sin conexión y con pendientes: muestra ambos avisos', () => {
    render(<ConnectionStatus status={status({ online: false })} pendingCount={2} />)
    expect(screen.getByText(/Sin conexión con el servidor/)).toBeInTheDocument()
    expect(screen.getByText('2 pendientes sin sync')).toBeInTheDocument()
  })

  it('el botón SOLO llama a check() (verificar conexión)', () => {
    const s = status({ online: false })
    render(<ConnectionStatus status={s} pendingCount={0} />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/ }))
    expect(s.check).toHaveBeenCalledTimes(1)
  })

  it('mientras verifica: "Verificando…" y el botón queda deshabilitado', () => {
    render(<ConnectionStatus status={status({ online: false, checking: true })} pendingCount={0} />)
    const button = screen.getByRole('button', { name: /Verificando/ })
    expect(button).toBeDisabled()
    expect(screen.queryByText('Actualizar')).not.toBeInTheDocument()
  })

  it('el aviso muestra la hora de la última verificación como tooltip', () => {
    render(<ConnectionStatus status={status({ online: false })} pendingCount={0} />)
    expect(screen.getByText(/Sin conexión/).getAttribute('title')).toMatch(/Última verificación:/)
  })

  it('sin lastCheckedAt no hay tooltip', () => {
    render(<ConnectionStatus status={status({ online: false, lastCheckedAt: null })} pendingCount={0} />)
    expect(screen.getByText(/Sin conexión/).getAttribute('title')).toBeNull()
  })
})

describe('<ConnectionStatus /> con outbox', () => {
  it('con conexión y solo para revisar: muestra "N para revisar" y abre la lista', () => {
    const onOpenList = vi.fn()
    render(<ConnectionStatus status={status()} pendingCount={0} reviewCount={2} onOpenList={onOpenList} />)
    fireEvent.click(screen.getByRole('button', { name: '2 para revisar' }))
    expect(onOpenList).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/pendiente/)).not.toBeInTheDocument()
  })

  it('pendientes y para revisar juntos, ambos abren la lista', () => {
    const onOpenList = vi.fn()
    render(<ConnectionStatus status={status()} pendingCount={3} reviewCount={1} onOpenList={onOpenList} />)
    fireEvent.click(screen.getByRole('button', { name: '3 pendientes sin sync' }))
    fireEvent.click(screen.getByRole('button', { name: '1 para revisar' }))
    expect(onOpenList).toHaveBeenCalledTimes(2)
  })

  it('sin onOpenList los avisos no son clicables', () => {
    render(<ConnectionStatus status={status()} pendingCount={1} reviewCount={1} />)
    expect(screen.getByRole('button', { name: '1 pendiente sin sync' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '1 para revisar' })).toBeDisabled()
  })

  it('sesión vencida con pendientes: explica que hay que iniciar sesión', () => {
    render(<ConnectionStatus status={status()} pendingCount={2} syncBlock="unauthorized" />)
    expect(screen.getByTestId('sync-blocked')).toHaveTextContent('Sesión vencida')
  })

  it('backend sin soporte con pendientes: lo indica; sin pendientes no muestra el bloqueo', () => {
    const { rerender } = render(<ConnectionStatus status={status()} pendingCount={1} syncBlock="unsupported" />)
    expect(screen.getByTestId('sync-blocked')).toHaveTextContent('aún no acepta')
    rerender(<ConnectionStatus status={status({ online: false })} pendingCount={0} syncBlock="unsupported" />)
    expect(screen.queryByTestId('sync-blocked')).not.toBeInTheDocument()
  })

  it('en web no se muestra nada aunque haya outbox', () => {
    const { container } = render(<ConnectionStatus status={status({ runtime: 'web' })} pendingCount={2} reviewCount={2} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('el botón Actualizar sigue solo verificando la conexión', () => {
    const s = status()
    render(<ConnectionStatus status={s} pendingCount={1} reviewCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/ }))
    expect(s.check).toHaveBeenCalledTimes(1)
  })
})
