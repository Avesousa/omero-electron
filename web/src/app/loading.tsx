import { LoadingScreen } from '@/app/components/LoadingScreen'

// Estado de carga de cualquier ruta (Next lo usa como Suspense): spinner en vez de pantalla vacía.
export default function Loading() {
  return <LoadingScreen />
}
