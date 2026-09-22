import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UpdateBanner } from './UpdateBanner'

describe('<UpdateBanner />', () => {
  it('sin update: no muestra nada', () => {
    const { container } = render(<UpdateBanner update={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('con update: muestra la versión y linkea al Release', () => {
    render(<UpdateBanner update={{ version: '1.2.3', url: 'https://github.com/Avesousa/omero-electron/releases/tag/v1.2.3' }} />)
    const link = screen.getByRole('link', { name: /1\.2\.3/ })
    expect(link).toHaveAttribute('href', 'https://github.com/Avesousa/omero-electron/releases/tag/v1.2.3')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('se puede cerrar', () => {
    render(<UpdateBanner update={{ version: '1.2.3', url: 'https://example.com' }} />)
    fireEvent.click(screen.getByRole('button', { name: /ocultar aviso/i }))
    expect(screen.queryByTestId('update-banner')).not.toBeInTheDocument()
  })
})
