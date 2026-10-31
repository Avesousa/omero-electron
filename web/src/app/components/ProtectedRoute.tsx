'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/shared'
import { clearSession } from '@/lib/sessionManager'
import { LoadingScreen } from './LoadingScreen'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, syncSession } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      // La sesión pudo renovarse fuera del provider (renovación silenciosa de la caja desde /login): se relee antes de rendirse.
      if (syncSession()) return
      // Si quedó una cookie "válida" para el middleware pero no se pudo restaurar la sesión (cookie de usuario ausente o
      // corrupta), el middleware nos devolvería de /login a /pos en bucle y la pantalla quedaría vacía para siempre.
      clearSession()
      router.replace('/login')
    }
  }, [isAuthenticated, isLoading, router, syncSession])

  // Sin sesión se muestra el spinner (no una pantalla vacía) mientras se redirige al login.
  if (isLoading || !isAuthenticated) return <LoadingScreen label={isLoading ? 'Verificando sesión…' : 'Redirigiendo…'} />

  return <>{children}</>
}
