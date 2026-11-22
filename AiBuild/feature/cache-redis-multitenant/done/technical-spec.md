# Technical Spec: POS — caché con 304 y stock en vivo

## Metadata
- **Date:** 2026-11-22
- **Branch:** feature/cache-redis-multitenant
- **Based on:** functional-spec.md
- **Status:** WIP
- **Depende de:** omero-backend#86 (mergeado: ETag, `GET /api/products/stock?since=`, evento SSE `stock`) **+ un PR chico nuevo en omero-backend** (ver "Dependencia backend").

## Hallazgos que cambian el diseño respecto de la spec funcional
1. **Hay tres capas, no una.** Navegador → Next del POS (servidor local en desktop, Railway en web) → backend. En **web** el Next es un proxy puro (`proxyToBackend`, sin syncer ni SQLite): el navegador maneja `ETag`/`If-None-Match` solo, si dejamos de mandar `cache: 'no-store'`. En **desktop** el que debe manejar el ETag es el Next local (SQLite), no el navegador.
2. **El navegador hoy no refresca el catálogo cada 5 min.** `useProducts` carga al montar y reintenta solo si falla; los 5 min son del syncer de desktop y de los hooks de config/entitlement. Sin cambio, el stock en pantalla queda viejo toda la sesión. Por eso el stock en vivo se hace **en el navegador** (SSE + delta) y la SQLite se pone al día con el syncer.
3. **El evento `stock` es un disparador, no la fuente de verdad.** Las versiones de stock salen de una secuencia global y el evento se emite *después* del commit: dos ventas concurrentes pueden emitir sus eventos en orden inverso. Aplicar el payload y "ignorar versiones ≤ a la guardada" (como pedía la spec funcional) podría perder un cambio. Diseño: al llegar un evento (o `full: true`) se pide `GET /api/products/stock?since=<versión local>` y se aplica **esa respuesta** (estado absoluto, idempotente). La versión local solo avanza con lo que devuelve el delta.
4. **El stream SSE es el de Mercado Pago** y su ticket exige `MERCADOPAGO_VER`/`POS_MERCADOPAGO_VER`: un cajero sin ese permiso no recibiría `stock`. Decisión de Avelino: **cambiar el backend**. Además el stream también transporta `payment`/`status`: si solo se relaja el permiso, esos cajeros verían pagos de MP. Hay que filtrar por canal (ver abajo).
5. **Desktop: el ETag del backend no puede llegar al navegador.** El Next local devuelve el body *ajustado* (stock − pendientes del outbox); si el navegador guardara ese body bajo el ETag crudo del backend y recibiera un 304, mostraría stock viejo. En desktop el ETag lo posee el Next local.

## Architecture and patterns
### Decision: mantener el patrón existente (capa de datos + proxy por política + syncer), extendiéndolo
- **Web:** sin código de servidor nuevo. El navegador hace la revalidación condicional; el proxy ya reenvía `If-None-Match`/`ETag`/`Cache-Control`/`Vary`. Se agrega test que fija ese comportamiento (incluido 304 sin body).
- **Desktop:** `catalog-proxy`, `entitlement-proxy` y `syncer` guardan el ETag por tenant en SQLite y mandan `If-None-Match` propio. El `If-None-Match` del navegador **se descarta** y el `ETag` **se quita** de la respuesta (`Cache-Control: no-store`); se informa `X-Omero-Stock-Version` para el delta.
- **Stock en vivo (navegador):** `startMpEvents` suma el listener `stock` (misma conexión; no hay un segundo stream). Un hook `useStockSync` junta eventos (debounce 250 ms) y llama a `syncStock()` de `useProducts`.
- **Respaldo sin SSE:** mientras `sseConnected` sea false, `syncStock()` cada 30 s; al reabrir el SSE, una vez. Con el cambio de backend todos los cajeros pueden abrir el SSE, así que esto cubre cortes, no permisos.

**Why:** respeta la separación web/desktop y el offline (SQLite sigue siendo solo lectura, sin cambiar el contrato hacia el navegador); evita un cliente SSE en Node.
**Discarded:** ver tabla al final.

## Data model
### SQLite del catálogo (desktop)
**Migración v3** (`migrations.ts`, nunca se edita una publicada):
```sql
CREATE TABLE etags (
  key  TEXT PRIMARY KEY,   -- 'products' | 'promotions' | 'setting:<key>'
  etag TEXT NOT NULL       -- ETag tal como lo devolvió el backend (con comillas)
);
```
**`CatalogStore` — métodos nuevos:**
- `getEtag(key): string | null`, `setEtag(key, etag | null)`.
- `touch(key, now?)`: actualiza `last_sync_at` (`sync_meta`) o `synced_at` (`settings`) sin reescribir datos (lo que hace hoy el hash idéntico). Sin fila previa → no hace nada.
- `applyStockDelta(items: {code, stock}[]): number`: en una transacción, `UPDATE products SET json = json_set(json,'$.stock', ?) WHERE code = ?`; códigos desconocidos se ignoran; devuelve cuántos actualizó.
- `replaceProducts(items, now?, etag?)` / `replacePromotions(...)`: guardan el ETag **en la misma transacción** que los datos (si no hay ETag, lo borran: backend viejo).
- `wipe()` ya borra el archivo: los ETag se van con la base.

**Regla de oro:** nunca se manda `If-None-Match` si no hay snapshot local del recurso (un 304 sin datos locales no se podría servir).

**Entitlement** (`entitlement/store`, archivo en disco): se agrega `etag?: string` al registro guardado.

### Helper de ETag/versión de stock (`lib/catalog/etag.ts`, puro)
- `parseProductsEtag('"12-345"') → { cat: '12', stock: 345 } | null` (cualquier otro formato → `null`: sin delta, comportamiento actual).
- `withStockVersion(etag, v)`: recompone `"<cat>-<v>"` tras aplicar un delta. Así, si solo cambió stock y ya estamos al día, el siguiente `If-None-Match` coincide y el backend responde 304 en vez del catálogo completo. Si cambió el catálogo o llegó otro cambio de stock, no coincide y viene el 200 completo (nunca datos viejos).

## API / Contracts
### Contratos del backend que se consumen (ya existen)
- `GET /api/products|/api/promotions|/api/business/config/{key}|/api/billing/entitlement` → `ETag` fuerte, `Cache-Control: private, no-cache`, `Vary: Authorization`; `If-None-Match` coincidente → `304` sin body.
- `GET /api/products/stock?since=N` → `200 {success, data:{version, items:[{code, stock}]}}`; `410 {code:'STOCK_DELTA_EXPIRED'}`; `400` sin `since`. (`/api/products/*` ya está en la lista del `DeviceScopeFilter`.)
- SSE `event: stock` `data: {"version":N,"items":[…],"full"?:true}`.

### Nueva ruta de política en el Next local (desktop)
`GET /api/products/stock?since=<n>` → `CatalogRoute { kind: 'stockDelta'; since }`. `matchCatalogRoute` hoy descarta cualquier query; se agrega este caso (regex `^\?since=\d{1,18}$`). Comportamiento en `proxyWithCatalog`:
- backend 200 → `applyStockDelta` en SQLite, `setEtag('products', withStockVersion(...))`, y la respuesta se **ajusta** restando lo pendiente del outbox (`adjustStockBody` se extiende a la forma `data.items[]`). Sin `since` en el ajuste (respuesta en vivo): no hay doble descuento con ventas ya enviadas.
- 410 / 400 / 404 → pasan tal cual (el navegador decide: catálogo completo).
- 502/503/504 → pasan (sin conexión no hay delta posible; el navegador conserva su estado, que ya incluye pendientes).

### Cambios en respuestas del Next local (desktop)
- Productos/promos/config/entitlement: se quita `ETag`; `Cache-Control: no-store`.
- 304 del backend servido desde SQLite → `200` con `X-Omero-Cache: fresh` (**no** `hit`: `hit` significa "sin conexión, dato posiblemente viejo" y lo usa `useEntitlement` para no desbloquear). Se actualiza `last_sync_at`/`fetchedAt`.
- `GET /api/products` agrega `X-Omero-Stock-Version: <n>` (de `parseProductsEtag` del ETag guardado).

### Cliente (navegador)
- `apiFetch` devuelve además `headers` en el resultado exitoso (campo opcional, aditivo).
- `stockVersionOf(headers)`: `X-Omero-Stock-Version` (desktop) o, si no, `parseProductsEtag(ETag)` (web); sin ninguno → sin delta (se sigue como hoy).
- `useProducts`: `stockVersion` (ref), `syncStock()`:
  1. sin versión → `refreshProducts()` (limitado a 1 vez cada 5 min);
  2. `GET /api/products/stock?since=v` → aplica `items` al estado y a `localStorage`, y `stockVersion = version` solo si es mayor; códigos que no están se ignoran; `version < stockVersion` (Redis reiniciado) → catálogo completo;
  3. `410` o cualquier error que no sea de red → catálogo completo (con el mismo límite); error de red → no hace nada (reintenta el respaldo de 30 s / próximo evento).
  - Reentrancia: una sola ejecución a la vez; si llega otro evento mientras corre, se repite una vez al terminar.
  - Reconciliación: catálogo completo sin condicional cada 30 min (red de seguridad ante un cambio de stock perdido; ver Riesgos).
- `useEntitlement.fetchEntitlement`: se saca `cache: 'no-store'` (el navegador revalida con ETag solo). `useBusinessFlag`/`useScaleConfig`/`usePromotions` ya usan `apiFetch` sin `no-store`.
- `mpEvents.ts`: `onStock(data)` opcional; `useMercadoPagoEvents({ onStock })`. `page.tsx` conecta `onStock` a `syncStock` vía ref (el hook de eventos se llama antes que `useProducts`).

### Syncer (desktop, cada 5 min / recuperación)
Por tenant y ciclo:
1. **Delta primero**, si hay versión de stock guardada (de `parseProductsEtag` del ETag de `products`): `GET /api/products/stock?since=v`. 200 → `applyStockDelta` + recomponer ETag. 410/400/404/otros → borrar el ETag de `products` (fuerza catálogo completo). Falla de red: se ignora (la ruta de productos decide `failed`).
2. Cada ruta (`products`, `promotions`, `setting`s; **no** medios de pago ni clientes) manda `If-None-Match` si hay ETag y snapshot. `304` → `touch` y cuenta como éxito; `200` → como hoy + guarda ETag; sin header `ETag` → borra el guardado.
3. Los `optional`, 403/401 y el manejo de recuperación no cambian.

## Dependencia backend (PR nuevo, chico, en omero-backend)
Decisión de Avelino: permitir el ticket SSE a cajeros sin permiso de MP.
- `POST /api/mercadopago/events/ticket`: `@PreAuthorize` suma `PERM_PRODUCTOS_VER` (el que ya exige `GET /api/products`). El ticket guarda si el usuario tiene permiso de MP (`mp = true/false`).
- El emisor se registra con su conjunto de canales; `broadcast(tenant, event, payload)` entrega `payment`/`status` solo a emisores `mp` y `stock` a todos. Tests: usuario sin permiso de MP recibe `stock` y **no** recibe `payment`.
- `/api/mercadopago/events*` ya está permitido para el token de caja (`DeviceScopeFilter`). Sin esto, la feature funciona igual para quien tiene permiso de MP y el resto cae en el respaldo de 30 s.
- Se abre como PR aparte (backend → develop); este spec no lo implementa, pero el plan lo lista como tarea bloqueante opcional.

### Lista blanca de la caja
`allowlist.contract.test.ts` extrae las rutas `/api/...` que llama el POS y exige que estén en `DeviceScopeFilter`. `GET /api/products/stock` queda cubierta por la regla `GET /api/products/*`; el test debe seguir verde sin tocar el backend (se verifica en el build).

## Dependencies
Ninguna nueva. `json_set` viene en la SQLite de `better-sqlite3` (JSON1 incluido). Sin cambios de versiones.

## Performance
- 304 de catálogo/promos/config/entitlement: sin body ni reescritura de SQLite.
- Delta de stock: pocas filas; `UPDATE` por código en una transacción (hay índice en `products(code)`).
- Debounce de 250 ms en eventos para agrupar ráfagas de ventas; una sola sincronización en vuelo.
- Respaldo cada 30 s solo sin SSE; catálogo completo fallback limitado a 1 por 5 min por caja.
- Límite del backend: 20 emisores SSE por negocio (`MAX_EMITTERS_PER_TENANT`); si hay más de 20 conexiones (cajas + pestañas del admin) las más viejas se cierran y reconectan con backoff. Hoy solo conectan quienes tienen MP; con el cambio conectan todas. Anotado como riesgo a vigilar en beta.

## Security
- Desktop: el `If-None-Match` sale **solo** de valores guardados por nosotros en la base del tenant (nunca del navegador) y se descarta el del navegador. ETags por tenant (una SQLite por tenant).
- Web: `Vary: Authorization` hace que el caché del navegador separe usuarios; los ETag son solo contadores.
- Delta de stock: se valida forma (`items[].code` string, `stock` número finito, `version` entero) antes de tocar el estado; payload inválido → se ignora y se pide el catálogo completo.
- El `ETag` no se loguea junto con el token; el `Authorization` sigue solo en memoria.
- Canal SSE: sin filtrado por canal, los cajeros sin permiso de MP verían pagos (ver Dependencia backend).

## Testing plan
### Mandatory coverage (umbral 85 % de `web`)
`catalog/etag.ts`, `sqlite-store` (etags, touch, applyStockDelta, migración v3), `syncer` (condicional + delta), `catalog-proxy` (304, stockDelta, ajuste de pendientes), `entitlement-proxy`, `cache-policy`, `mpEvents`, `stockDelta` (merge puro), `useProducts.syncStock`, `useEntitlement`.
### Test types
- **Unit:** `parseProductsEtag`/`withStockVersion` (formatos raros → `null`); merge de delta (código desconocido, versión menor, número inválido); `matchCatalogRoute` con `?since=`; migración v3 sobre base v2 con datos; `startMpEvents` con evento `stock` y reconexión.
- **Integration (SQLite real, `fetch` falso — como `catalog-proxy.integration.test.ts`):**
  - 304 de products → 200 desde SQLite, `X-Omero-Cache: fresh`, `lastSyncAt` actualizado, sin reescribir filas; sin ETag guardado no se manda `If-None-Match`; el `If-None-Match` del navegador no llega al backend y el `ETag` no sale hacia el navegador.
  - Backend viejo (sin `ETag`, delta 404) = comportamiento actual.
  - Delta: se aplica a SQLite, se recompone el ETag, el siguiente ciclo da 304; **no hay doble descuento**: venta pendiente → stock mostrado = backend − pendiente; venta enviada y confirmada por el delta → no se resta dos veces.
  - 410 → se borra el ETag y se baja el catálogo completo; versión menor a la guardada → catálogo completo.
  - Entitlement: 304 → 200 con `fresh` y sin desbloqueo falso (`fromCache` solo con `hit`).
- **Hooks (jsdom, timers falsos):** evento `stock` → una llamada al delta tras el debounce; ráfaga → una sola; respaldo de 30 s sin SSE; 410 → catálogo completo limitado a 1 por 5 min; `fetchEntitlement` ya no usa `no-store`.
- **Web (backend-proxy):** reenvía `If-None-Match`, devuelve `304` sin body y conserva `ETag`/`Vary`.
- **E2E manual en beta (checklist):** dos cajas desktop + una web; A vende → B y la web ven el stock en ≤ 5 s; cortar el SSE de B 10 min → al reconectar usa delta; cajero sin permiso de MP recibe `stock` y no pagos; backend sin soporte (rama vieja) → igual que hoy; modo offline desktop sigue vendiendo.

## Explored and discarded alternatives
| Alternative | Why discarded |
|-------------|--------------|
| Aplicar el payload del evento y avanzar la versión (spec funcional) | Eventos fuera de orden o perdidos dejarían stock viejo sin que el delta lo repare; el delta es estado absoluto |
| Cliente SSE en Node para escribir SQLite al instante | Más piezas (tickets, reconexión, segundo stream por caja); el delta del syncer deja la SQLite a ≤ 5 min, suficiente para offline |
| Dejar pasar el `ETag` del backend al navegador en desktop | El body se ajusta con pendientes del outbox: un 304 del navegador mostraría stock viejo |
| Respaldo por polling para cajeros sin permiso MP (sin tocar backend) | Elegido cambiar el backend (≤ 5 s para todos) |
| Indicador visual "stock actualizado" al llegar un evento | Solo se actualiza el número (decisión por defecto; se puede sumar luego sin cambiar el diseño) |
| Un `ETag` propio del POS (hash del body) | Pierde el 304 sin SQL del backend |

## Riesgos conocidos
- **Orden de commit vs. versión:** si dos ventas confirman en orden inverso, un delta entre medio podría devolver solo la de versión mayor y la de menor quedaría fuera. Ventana mínima; se mitiga con la reconciliación completa cada 30 min (navegador) y, en desktop, el ETag de `products` incluye la versión de stock. Si aparece en beta, el backend puede devolver `since - margen`.
- Backend viejo en beta mezclado con POS nuevo: cubierto por tests (cae a comportamiento actual).

## Technical flow
```
Evento SSE stock ──(debounce 250 ms)──► syncStock() ──► GET /api/products/stock?since=v
   web:     navegador ─► Next (proxy puro) ─► backend
   desktop: navegador ─► Next local ─► backend ─► merge SQLite + ETag " <cat>-<v> "
                                      └► respuesta ajustada (− pendientes outbox) ─► navegador aplica items

Ciclo 5 min (desktop):  delta → If-None-Match por ruta → 304: touch / 200: reemplazar + ETag
410 / error: borrar ETag y bajar catálogo completo
```
