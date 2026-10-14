import { ProtectedRoute } from '@/app/components/ProtectedRoute'
import './pos.css'

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>
}
