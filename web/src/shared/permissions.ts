/**
 * Catálogo de permisos — espejo manual de `com.omero.security.Permission` en `omero-backend`. Copia idéntica
 * de `omero/src/shared/permissions.ts` (mismo backend, mismo catálogo); mismo criterio que
 * `lib/device/allowlist.contract.test.ts` para `DeviceScopeFilter`: se mantiene a mano y un test de contrato
 * (`permissions.contract.test.ts`) falla si se desincroniza.
 *
 * `scope`: "screen" gatea una pantalla completa; "action" gatea un botón/llamada puntual. En esta fase el POS
 * de escritorio todavía no gatea ninguna acción propia — el catálogo queda disponible en el contexto de auth
 * para cuando se decida qué acciones del POS empiezan a requerir permiso.
 * `platformOnly`: reservado para el spec `roles-permisos-cross-tenant` — ningún usuario de un tenant los tiene.
 */

export type PermissionScope = 'screen' | 'action'

export interface PermissionDef {
  code: string
  module: string
  scope: PermissionScope
  platformOnly: boolean
}

export const PERMISSIONS = [
  { code: 'VENTAS_VER', module: 'Ventas', scope: 'screen', platformOnly: false },
  { code: 'VENTAS_CREAR', module: 'Ventas', scope: 'action', platformOnly: false },
  { code: 'VENTAS_REVISION_VER', module: 'Revisión de ventas', scope: 'screen', platformOnly: false },
  { code: 'VENTAS_REVISION_RESOLVER', module: 'Revisión de ventas', scope: 'action', platformOnly: false },
  { code: 'PRODUCTOS_VER', module: 'Productos', scope: 'screen', platformOnly: false },
  { code: 'PRODUCTOS_CREAR', module: 'Productos', scope: 'action', platformOnly: false },
  { code: 'PRODUCTOS_EDITAR', module: 'Productos', scope: 'action', platformOnly: false },
  { code: 'PRODUCTOS_ELIMINAR', module: 'Productos', scope: 'action', platformOnly: false },
  { code: 'PRODUCTOS_HISTORIAL_VER', module: 'Productos', scope: 'action', platformOnly: false },
  { code: 'PRODUCTOS_BULK_UPLOAD', module: 'Productos', scope: 'action', platformOnly: false },
  { code: 'PRODUCTOS_GRUPOS_GESTIONAR', module: 'Productos', scope: 'action', platformOnly: false },
  { code: 'CATEGORIAS_VER', module: 'Categorías', scope: 'screen', platformOnly: false },
  { code: 'CATEGORIAS_GESTIONAR', module: 'Categorías', scope: 'action', platformOnly: false },
  { code: 'NEGOCIOS_VER', module: 'Negocios', scope: 'screen', platformOnly: false },
  { code: 'NEGOCIOS_GESTIONAR', module: 'Negocios', scope: 'action', platformOnly: false },
  { code: 'PROVEEDORES_VER', module: 'Proveedores', scope: 'screen', platformOnly: false },
  { code: 'PROVEEDORES_GESTIONAR', module: 'Proveedores', scope: 'action', platformOnly: false },
  { code: 'COMPRAS_VER', module: 'Compras', scope: 'screen', platformOnly: false },
  { code: 'COMPRAS_CREAR', module: 'Compras', scope: 'action', platformOnly: false },
  { code: 'COMPRAS_BULK_UPLOAD', module: 'Compras', scope: 'action', platformOnly: false },
  { code: 'GASTOS_VER', module: 'Gastos', scope: 'screen', platformOnly: false },
  { code: 'GASTOS_CREAR', module: 'Gastos', scope: 'action', platformOnly: false },
  { code: 'PROMOCIONES_VER', module: 'Promociones', scope: 'screen', platformOnly: false },
  { code: 'PROMOCIONES_GESTIONAR', module: 'Promociones', scope: 'action', platformOnly: false },
  { code: 'PROMOCIONES_STATS_VER', module: 'Promociones', scope: 'action', platformOnly: false },
  { code: 'DASHBOARD_VER', module: 'Dashboard', scope: 'screen', platformOnly: false },
  { code: 'REPORTES_VER', module: 'Dashboard', scope: 'action', platformOnly: false },
  { code: 'MERCADOPAGO_VER', module: 'MercadoPago', scope: 'screen', platformOnly: false },
  { code: 'MERCADOPAGO_CONCILIACION_GESTIONAR', module: 'MercadoPago', scope: 'action', platformOnly: false },
  { code: 'MERCADOPAGO_CONFIGURAR', module: 'MercadoPago', scope: 'action', platformOnly: false },
  { code: 'DISPOSITIVOS_VER', module: 'Dispositivos', scope: 'screen', platformOnly: false },
  { code: 'DISPOSITIVOS_GESTIONAR', module: 'Dispositivos', scope: 'action', platformOnly: false },
  { code: 'CONFIG_NEGOCIO_VER', module: 'Configuración', scope: 'screen', platformOnly: false },
  { code: 'CONFIG_NEGOCIO_EDITAR', module: 'Configuración', scope: 'action', platformOnly: false },
  { code: 'DATOS_TRANSACCIONALES_LIMPIAR', module: 'Mantenimiento', scope: 'action', platformOnly: false },
  { code: 'USUARIOS_VER', module: 'Usuarios', scope: 'screen', platformOnly: false },
  { code: 'USUARIOS_GESTIONAR', module: 'Usuarios', scope: 'action', platformOnly: false },
  { code: 'ROLES_GESTIONAR', module: 'Roles', scope: 'action', platformOnly: false },
  { code: 'SUSCRIPCION_VER', module: 'Suscripción', scope: 'screen', platformOnly: false },
  { code: 'SUSCRIPCION_GESTIONAR', module: 'Suscripción', scope: 'action', platformOnly: false },
  { code: 'NEGOCIOS_CROSS_TENANT_VER', module: 'Plataforma', scope: 'screen', platformOnly: true },
  { code: 'PRODUCTOS_CROSS_TENANT', module: 'Plataforma', scope: 'screen', platformOnly: true },
  { code: 'VENTAS_CROSS_TENANT', module: 'Plataforma', scope: 'screen', platformOnly: true },
] as const satisfies readonly PermissionDef[]

export type Permission = (typeof PERMISSIONS)[number]['code']

export const PERMISSION_CODES: readonly Permission[] = PERMISSIONS.map(p => p.code)
