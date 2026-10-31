'use client'

import { useEffect } from 'react'

// Error inesperado al renderizar una ruta: mensaje en español y reintento, nunca una pantalla vacía.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[omero] error de render:', error)
  }, [error])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'var(--c-bg)', color: 'var(--c-text, #0f172a)', padding: 24, textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Algo salió mal</h1>
      <p style={{ margin: 0, opacity: 0.8 }}>No se pudo mostrar esta pantalla. Probá de nuevo; si sigue igual, reiniciá el programa.</p>
      <button type="button" onClick={reset} style={{ padding: '10px 20px', borderRadius: 8, border: 0, background: '#1E40AF', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
        Reintentar
      </button>
    </div>
  )
}
