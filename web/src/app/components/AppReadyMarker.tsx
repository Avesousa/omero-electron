'use client'

import { useEffect } from 'react'
import { useAuth } from '@/shared'
import { useTheme } from './ThemeProvider'

/** Atributo de <html> que Electron consulta para saber que la pantalla ya se pintó con el tema y la sesión resueltos. */
export const APP_READY_ATTR = 'data-omero-ready'

/**
 * Marca la app como "lista" cuando ya hidrató, restauró la sesión (AuthProvider) y consultó el tema guardado. Electron
 * mantiene su pantalla de carga hasta ver este atributo (con un tope de tiempo: nunca queda esperando para siempre).
 * No renderiza nada. Inofensivo en web.
 */
export function AppReadyMarker() {
  const { isLoading } = useAuth()
  const { settled } = useTheme()
  const ready = !isLoading && settled

  useEffect(() => {
    if (!ready) return
    // Dos frames: deja que el navegador pinte lo que acaba de renderizar antes de revelar la ventana.
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => document.documentElement.setAttribute(APP_READY_ATTR, '1'))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [ready])

  return null
}
