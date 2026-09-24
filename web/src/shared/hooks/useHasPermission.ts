'use client'

import { useAuth } from '../contexts/auth'
import type { Permission } from '../permissions'

/**
 * `true` si el cajero logueado en esta caja tiene el permiso pedido. Todavía no gatea ninguna acción del POS
 * (no existe ninguna hoy) — queda disponible para cuando se decida qué acciones empiezan a requerir permiso.
 */
export function useHasPermission(permission: Permission): boolean {
  const { user } = useAuth()
  return user?.permissions?.includes(permission) ?? false
}
