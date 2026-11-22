# Checklist manual — POS: caché con 304 y stock en vivo

Entorno: beta (backend con omero-backend#86 + PR del ticket SSE por canales) y dos cajas desktop + una web.

## Stock en vivo
- [ ] Caja A (desktop) vende 1 unidad de un producto → caja B (desktop) y la web ven el stock nuevo en ≤ 5 s sin recargar.
- [ ] Mismo producto con venta pendiente en el outbox de B (cortar la red de B, vender, reconectar) → B muestra backend − pendiente y, tras sincronizar, no se descuenta dos veces.
- [ ] Cortar el SSE de B (bloquear la conexión) 10 min, mientras A vende varias veces → al reconectar B pide el delta (`/api/products/stock?since=`), no el catálogo completo (verlo en los logs del backend).
- [ ] Con el SSE cortado, B igual se actualiza cada ~30 s por el respaldo.
- [ ] Cajero SIN permiso de Mercado Pago pero con permiso de productos: recibe el evento `stock` y **no** recibe `payment`/`status` (requiere el PR del backend desplegado).
- [ ] Un negocio con más de 20 conexiones SSE: las más viejas reconectan sin tormenta de requests.

## 304
- [ ] Ciclo de 5 min sin cambios: el syncer recibe 304 en catálogo, promociones y config (`cache.gets` / logs del backend) y no reescribe la SQLite (`lastSyncAt` avanza).
- [ ] Cambiar un precio en el admin → la caja lo ve en el próximo ciclo (200 completo, ETag nuevo).
- [ ] Solo cambia stock (venta en otra caja) → el siguiente ciclo del syncer hace delta + 304 (no baja el catálogo completo).
- [ ] Web: en la pestaña Network de `/api/products`, `/api/promotions`, `/api/business/config/*` y `/api/billing/entitlement` aparece `304` en revalidaciones sin cambios.
- [ ] Entitlement bloqueado → al reactivar el acceso se desbloquea con la consulta en vivo (también con 304).

## Compatibilidad
- [ ] POS nuevo contra un backend de rama vieja (sin ETag ni `/stock`): se comporta como antes (sin errores en consola ni en logs).
- [ ] Desktop sin conexión: sigue vendiendo con la caché local; al volver la conexión usa el delta o el catálogo completo (410).
- [ ] Reiniciar Redis del backend → `since` mayor que la versión actual → 410 → el POS baja el catálogo completo una vez.
- [ ] Logout borra la base del tenant (los ETag se van con ella); el login siguiente baja todo de nuevo.
