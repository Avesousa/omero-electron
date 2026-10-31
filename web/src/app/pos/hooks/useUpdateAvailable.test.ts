import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUpdateAvailable } from './useUpdateAvailable'

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

describe('useUpdateAvailable', () => {
  it('sin window.electronAPI (modo web): devuelve null', () => {
    const { result } = renderHook(() => useUpdateAvailable())
    expect(result.current).toBeNull()
  })

  it('con electronAPI pero sin onUpdateAvailable: devuelve null', () => {
    ;(window as unknown as { electronAPI: object }).electronAPI = { isElectron: true }
    const { result } = renderHook(() => useUpdateAvailable())
    expect(result.current).toBeNull()
  })

  it('reenvía el payload que llega por onUpdateAvailable', () => {
    let deliver: ((info: { version: string; url: string }) => void) | null = null
    const unsubscribe = vi.fn()
    ;(window as unknown as { electronAPI: object }).electronAPI = {
      isElectron: true,
      onUpdateAvailable: (cb: (info: { version: string; url: string }) => void) => {
        deliver = cb
        return unsubscribe
      },
    }

    const { result } = renderHook(() => useUpdateAvailable())
    expect(result.current).toBeNull()

    act(() => {
      deliver?.({ version: '1.2.3', url: 'https://github.com/Avesousa/omero-electron/releases/tag/v1.2.3' })
    })

    expect(result.current).toEqual({ version: '1.2.3', url: 'https://github.com/Avesousa/omero-electron/releases/tag/v1.2.3' })
  })

  it('se desuscribe al desmontar', () => {
    const unsubscribe = vi.fn()
    ;(window as unknown as { electronAPI: object }).electronAPI = {
      isElectron: true,
      onUpdateAvailable: () => unsubscribe,
    }

    const { unmount } = renderHook(() => useUpdateAvailable())
    unmount()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
