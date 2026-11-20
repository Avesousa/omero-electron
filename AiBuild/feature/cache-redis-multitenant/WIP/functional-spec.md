# Functional Spec: POS — caché con 304 y stock en vivo

## Metadata
- **Type:** feature
- **Branch:** feature/cache-redis-multitenant
- **Ticket:** N/A
- **Tests required:** sí
- **Date:** 2026-11-20
- **Status:** WIP
- **Depende de:** omero-backend `feature/cache-redis-multitenant` (spec principal: ETag, versiones, `/api/products/stock?since=`, evento SSE `stock`)

## Summary
El POS (`omero-electron/web`, modo web en Railway y modo desktop) hoy descarga el catálogo completo, las promociones y la config cada 5 minutos por terminal. Con este cambio manda la versión que ya tiene (`If-None-Match`) y, si nada cambió, recibe `304` sin cuerpo. Además el stock deja de depender del ciclo de 5 min: se actualiza en segundos con el evento SSE `stock` del backend y, si el SSE se corta, con un delta liviano.

## Project context
- Next.js 16, `web/src/lib/catalog/syncer.ts` (sincroniza products, promotions, config, medios de pago, clientes, balanza cada 5 min; modo recuperación cada 30 s), `catalog-proxy.ts` (responde desde la caché local y descuenta lo vendido pendiente del outbox con `stock-adjust`).
- Hooks con refresco propio: `useBusinessConfig` / `useScaleConfig` (5 min), `useEntitlement` (5 min, 30 s si está bloqueado).
- SSE ya existente por negocio con ticket (`useMercadoPagoEvents`).
- En modo web, el syncer corre en el servidor Node (sin caché HTTP del navegador): el `ETag` se guarda a mano.

## Detailed description
1. **ETag por ruta en la caché local:** al recibir `200`, guardar el `ETag` junto con el dato. En el siguiente ciclo mandar `If-None-Match`. Con `304`, conservar el dato y marcar la sincronización como exitosa (actualizar la hora de "última sincronización").
2. **Rutas alcanzadas:** `/api/products`, `/api/promotions`, `/api/business/config/{key}` (syncer y hooks), `/api/billing/entitlement`. Medios de pago y clientes quedan igual hasta que el backend los cachee.
3. **Stock en vivo:**
   - Suscribirse al evento SSE `stock` (`{version, items:[{code, stock}]}`) y aplicar los cambios a la caché local del catálogo, guardando la `version`.
   - Ignorar eventos con versión menor o igual a la que ya se tiene (llegan desordenados o repetidos).
   - Al reconectar el SSE, o si no llegó ningún evento en el ciclo, pedir `GET /api/products/stock?since=<versión>`. Con `410 Gone`, pedir el catálogo completo.
   - Lo vendido en la propia caja sigue descontándose localmente con `stock-adjust`; al llegar el evento con el stock confirmado del backend, la venta ya sincronizada deja de descontarse dos veces (mismo criterio que hoy con la sincronización completa).
4. **Modo desktop sin conexión:** sin cambios. El POS sigue vendiendo con la caché local; al volver la conexión usa el delta o el catálogo completo.

## Main flows
### Flujo 1: Ciclo de sincronización sin cambios
1. El syncer pide `/api/products` con `If-None-Match`.
2. Recibe `304` → no reescribe la caché, registra la sincronización OK.

### Flujo 2: Otra caja vende
1. La caja A confirma una venta.
2. La caja B recibe el evento SSE `stock` y actualiza el stock de esos productos en pantalla en ≤ 5 s.

### Flujo 3: SSE caído
1. El SSE de la caja B se corta 10 minutos.
2. Al reconectar, pide `/api/products/stock?since=<versión>` y aplica solo los cambios.

## Edge cases
- Backend viejo sin `ETag` ni `/stock`: el POS sigue funcionando como hoy (sin `If-None-Match` útil; `404` del delta → catálogo completo).
- `ETag` guardado de un negocio distinto (cambio de sesión): la caché por tenant ya está separada; el `ETag` se guarda por tenant.
- Evento `stock` de un producto que no está en la caché local: se ignora y se espera al catálogo completo.
- Reloj o versión que retrocede (reinicio de Redis): si la versión del backend es menor que la guardada, se descarta la versión local y se pide el catálogo completo.

## Acceptance criteria
- [ ] Dado un catálogo sin cambios, cuando corre el ciclo de 5 min, entonces el POS recibe `304` y no reescribe la caché.
- [ ] Dadas dos cajas conectadas, cuando A vende, entonces B ve el stock nuevo en ≤ 5 s sin recargar.
- [ ] Dado el SSE cortado, cuando se reconecta, entonces el POS pide el delta y no el catálogo completo (salvo `410`).
- [ ] Dado un backend sin soporte de `ETag`, cuando sincroniza, entonces el comportamiento es igual al actual.
- [ ] Los tests existentes de `catalog-proxy`, `syncer` y `cache-policy` siguen verdes, más tests nuevos para `304`, evento `stock` y delta.

## Out of scope
- Cambiar los intervalos de refresco (siguen en 5 min).
- Medios de pago y clientes con `ETag` (hasta que el backend los cachee).

## Constraints
- No romper el modo offline del desktop.
- No duplicar el descuento de stock entre `stock-adjust` y el evento SSE.

## Open questions
- ¿Mostrar un indicador sutil de "stock actualizado" cuando llega un evento de otra caja, o solo actualizar el número?
