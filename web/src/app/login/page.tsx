import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoginForm } from './components/LoginForm'

export const metadata: Metadata = {
  title: 'Iniciar sesión — Omero POS',
  description: 'Accedé al sistema de punto de venta Omero con tus credenciales.',
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
