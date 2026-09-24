/**
 * Contrato con `com.omero.security.Permission` (`omero-backend`): esta lista es una copia a mano del enum del
 * backend. Si alguien agrega/saca/renombra un código acá sin tocar el enum (o viceversa), este test falla.
 * Mismo criterio que `omero-electron/web/src/lib/device/allowlist.contract.test.ts` para `DeviceScopeFilter`:
 * no hay forma de que un test de este repo llame al backend, así que la "fuente de verdad" es esta lista fija,
 * mantenida a mano en los dos lugares a la vez cuando el catálogo cambia.
 */
import { describe, expect, it } from 'vitest'
import { PERMISSION_CODES } from './permissions'

/** Espejo de los valores de `Permission.java` — mantener sincronizado a mano. */
const BACKEND_PERMISSION_CODES = [
  'VENTAS_VER', 'VENTAS_CREAR',
  'VENTAS_REVISION_VER', 'VENTAS_REVISION_RESOLVER',
  'PRODUCTOS_VER', 'PRODUCTOS_CREAR', 'PRODUCTOS_EDITAR', 'PRODUCTOS_ELIMINAR',
  'PRODUCTOS_HISTORIAL_VER', 'PRODUCTOS_BULK_UPLOAD', 'PRODUCTOS_GRUPOS_GESTIONAR',
  'CATEGORIAS_VER', 'CATEGORIAS_GESTIONAR',
  'NEGOCIOS_VER', 'NEGOCIOS_GESTIONAR',
  'PROVEEDORES_VER', 'PROVEEDORES_GESTIONAR',
  'COMPRAS_VER', 'COMPRAS_CREAR', 'COMPRAS_BULK_UPLOAD',
  'GASTOS_VER', 'GASTOS_CREAR',
  'PROMOCIONES_VER', 'PROMOCIONES_GESTIONAR', 'PROMOCIONES_STATS_VER',
  'DASHBOARD_VER', 'REPORTES_VER',
  'MERCADOPAGO_VER', 'MERCADOPAGO_CONCILIACION_GESTIONAR', 'MERCADOPAGO_CONFIGURAR',
  'DISPOSITIVOS_VER', 'DISPOSITIVOS_GESTIONAR',
  'CONFIG_NEGOCIO_VER', 'CONFIG_NEGOCIO_EDITAR',
  'DATOS_TRANSACCIONALES_LIMPIAR',
  'USUARIOS_VER', 'USUARIOS_GESTIONAR',
  'ROLES_GESTIONAR',
  'NEGOCIOS_CROSS_TENANT_VER', 'PRODUCTOS_CROSS_TENANT', 'VENTAS_CROSS_TENANT',
] as const

describe('contrato: permissions.ts refleja exactamente el catálogo del backend', () => {
  it('no le sobra ningún código a permissions.ts que el backend no tenga', () => {
    const extra = PERMISSION_CODES.filter(c => !BACKEND_PERMISSION_CODES.includes(c))
    expect(extra, `Códigos en permissions.ts sin equivalente en Permission.java: ${extra.join(', ')}`).toEqual([])
  })

  it('no le falta a permissions.ts ningún código que el backend sí tenga', () => {
    const missing = BACKEND_PERMISSION_CODES.filter(c => !(PERMISSION_CODES as readonly string[]).includes(c))
    expect(missing, `Códigos de Permission.java sin reflejar en permissions.ts: ${missing.join(', ')}`).toEqual([])
  })

  it('no hay códigos duplicados', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length)
  })
})
