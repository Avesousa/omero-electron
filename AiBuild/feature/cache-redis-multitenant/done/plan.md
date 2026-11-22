# Task Plan: POS — caché con 304 y stock en vivo

## Metadata
- **Date:** 2026-11-22
- **Branch:** feature/cache-redis-multitenant (worktree `.wt/cache-pos`)
- **Type:** feature
- **Tests required:** yes (umbral 85 % en `web`: `npm --prefix web run check`)
- **Total tasks:** 24
- **Parallelizable groups:** ver "Parallelizable groups" (3 carriles independientes tras la base: SQLite/desktop, navegador, backend)

## Executive summary
Se extiende el patrón existente (capa de datos + proxy por política + syncer). En **desktop** el Next local guarda el ETag por tenant en SQLite (migración v3), manda `If-None-Match` propio, sirve 304 desde SQLite y fusiona el delta de stock (ajustado con pendientes del outbox). En **web** el navegador revalida solo al dejar de usar `no-store`. El stock en vivo se hace en el navegador: el evento SSE `stock` es un disparador que lanza `GET /api/products/stock?since=` (debounce, una sola ejecución en vuelo, respaldo cada 30 s sin SSE). Un PR aparte y chico en omero-backend permite el ticket SSE a cajeros sin permiso de MP, filtrando `payment`/`status` por canal. Todo degrada al comportamiento actual con backend viejo.

## Phases and tasks

### Phase 0: Setup
- [ ] **T001** — Línea base de la rama
  - Detail: la rama está 1 commit detrás de `origin/develop`: `git pull --rebase origin develop` en `.wt/cache-pos`; correr `npm --prefix web run check` y registrar cuántos tests pasan antes de tocar nada. Si el módulo nativo no carga con el Node del sistema, usar el mismo workaround que el resto de la suite (ver README).
  - Done when: `check` verde y número base de tests anotado en `notes.md` de la WIP.
  - Dependencies: none
  - Files affected: `AiBuild/feature/cache-redis-multitenant/WIP/notes.md`
  - Complexity: S
- [ ] **T002** — PR backend: ticket SSE para cajeros sin permiso de MP, con canales (repo `omero-backend`, rama nueva desde develop)
  - Detail: `POST /api/mercadopago/events/ticket` suma `PERM_PRODUCTOS_VER` al `@PreAuthorize`; `SseTicketService.issue` guarda `mp` (¿tiene `PERM_MERCADOPAGO_VER` o `PERM_POS_MERCADOPAGO_VER`?); `SseEmitterRegistry` registra el emisor con sus canales y `broadcast` entrega `payment`/`status` solo a emisores `mp` y `stock` a todos. Tests: sin permiso MP recibe `stock` y no `payment`; con permiso recibe todo; sin `PRODUCTOS_VER` → 403. Delegar a subagente sonnet (ver memoria de flujo).
  - Done when: tests del backend verdes y PR abierto contra develop. **No bloquea** el resto: sin él la feature funciona para quien ya tiene permiso de MP y los demás caen en el respaldo de 30 s.
  - Dependencies: none
  - Can parallelize with: todo lo demás
  - Files affected: `controller/MercadoPagoController.java`, `service/SseTicketService.java`, `service/SseEmitterRegistry.java`, tests
  - Complexity: M

### Phase 1: Foundation
- [ ] **T003** — Helper puro de ETag (`web/src/lib/catalog/etag.ts`)
  - Detail: `parseProductsEtag('"12-345"') → {cat:'12', stock:345} | null`; `withStockVersion(etag, v)`; formatos raros (débil `W/`, sin comillas, un solo número, no numérico) → `null`.
  - Done when: `etag.test.ts` cubre formatos válidos e inválidos y pasa.
  - Dependencies: T001
  - Can parallelize with: T004, T006
  - Files affected: `web/src/lib/catalog/etag.ts`, `etag.test.ts`
  - Complexity: S
- [ ] **T004** — Migración SQLite v3 (tabla `etags`) y tipos de `CatalogStore`
  - Detail: agregar migración 3 al final del array (nunca editar las publicadas); en `types.ts` sumar `getEtag`, `setEtag`, `touch`, `applyStockDelta`, y el parámetro opcional `etag` de `replaceProducts`/`replacePromotions`; la ruta `{ kind:'stockDelta'; since:number }` en `CatalogRoute`.
  - Done when: `migrations.test.ts` abre una base v2 con datos y llega a v3 sin perderlos; `tsc --noEmit` pasa (los stores de test fallan hasta T005: se actualizan los mocks).
  - Dependencies: T001
  - Can parallelize with: T003, T006
  - Files affected: `lib/catalog/migrations.ts`, `lib/catalog/types.ts`, `migrations.test.ts`
  - Complexity: S
- [ ] **T005** — `sqlite-store`: ETag, `touch`, `applyStockDelta` y ETag atómico en los reemplazos
  - Detail: `getEtag/setEtag(null=borra)`; `touch(key)` actualiza `sync_meta.last_sync_at` o `settings.synced_at` sin reescribir datos y sin fila previa no hace nada; `applyStockDelta` en una transacción con `UPDATE products SET json=json_set(json,'$.stock',?) WHERE code=?`, ignora códigos desconocidos, devuelve cuántas filas cambió; `replaceProducts/Promotions` guardan o borran el ETag en la misma transacción (con hash idéntico también actualizan el ETag).
  - Done when: `sqlite-store.test.ts` cubre las seis operaciones, incluido rollback (si falla el reemplazo, el ETag anterior queda) y que `wipe` deja sin ETag.
  - Dependencies: T004
  - Files affected: `lib/catalog/sqlite-store.ts`, `sqlite-store.test.ts`, mocks de `CatalogStore` en otros tests
  - Complexity: M
- [ ] **T006** — Ajuste de stock para la forma del delta (`stock-adjust`)
  - Detail: `adjustStockBody` entiende `route.kind === 'stockDelta'` con `data.items[]` (`code`, `stock`), misma resta de pendientes, piso 0, redondeo a milésimas y código `000` sin ajuste. Sin `since` (respuesta en vivo).
  - Done when: tests nuevos en `stock-adjust.test.ts` (items ajustados, sin pendientes devuelve el mismo texto, forma inesperada devuelve el mismo texto).
  - Dependencies: T004
  - Can parallelize with: T003, T005
  - Files affected: `lib/outbox/stock-adjust.ts`, `stock-adjust.test.ts`
  - Complexity: S
- [ ] **T007** — Política: ruta `GET /api/products/stock?since=<n>`
  - Detail: `matchCatalogRoute` devuelve `{kind:'stockDelta', since}` solo con `?since=` de 1–18 dígitos; cualquier otra query o `since` inválido → `null` (pasa por el proxy). Verificar que `/api/products/stock` sin query no se confunda con un código (`PRODUCT_CODE` es numérico).
  - Done when: `cache-policy.test.ts` cubre válidos, `since=abc`, `since=1&x=2`, sin query y `POST`.
  - Dependencies: T004
  - Can parallelize with: T005, T006
  - Files affected: `lib/catalog/cache-policy.ts`, `cache-policy.test.ts`
  - Complexity: S

### Phase 2: Core (desktop)
- [ ] **T008** — `catalog-proxy`: 304 desde SQLite y ETag propio
  - Detail: para `products`, `promotions` y `setting`: descartar el `If-None-Match` del navegador; si hay snapshot y ETag guardado, mandar el propio al backend. 200 → aplicar + `setEtag` (sin header `ETag` → borrar). 304 → `touch` + servir desde SQLite (`serveFromCache` ya ajusta pendientes) con `X-Omero-Cache: fresh` (nunca `hit`), sin `ETag`, `Cache-Control: no-store`. Quitar `ETag` de toda respuesta de estas rutas. Agregar `X-Omero-Stock-Version` en `GET /api/products` (de `parseProductsEtag` del ETag guardado). Nunca mandar condicional sin snapshot.
  - Done when: `catalog-proxy.integration.test.ts` cubre: 304→200 desde SQLite, `lastSyncAt` actualizado sin reescribir filas, sin ETag guardado no hay condicional, header del navegador no llega al backend, `ETag` no sale, backend viejo sin `ETag` = comportamiento de hoy.
  - Dependencies: T003, T005
  - Files affected: `lib/catalog/catalog-proxy.ts`, `catalog-proxy.integration.test.ts`
  - Complexity: L
- [ ] **T009** — `catalog-proxy`: ruta `stockDelta`
  - Detail: backend 200 → validar forma, `applyStockDelta`, `setEtag('products', withStockVersion(...))` (solo si hay ETag de products parseable), respuesta ajustada con pendientes; 410/400/404/otros pasan tal cual; 502/503/504 pasan sin servir de caché. Nunca lanza.
  - Done when: tests de integración: delta se fusiona en SQLite y el ETag se recompone; no hay doble descuento (venta PENDING → stock = backend − pendiente; venta ya enviada y confirmada por el delta → no se resta dos veces); 410 pasa; offline pasa 502.
  - Dependencies: T005, T006, T007, T008
  - Files affected: `lib/catalog/catalog-proxy.ts`, tests
  - Complexity: M
- [ ] **T010** — `syncer`: condicional por ruta y delta primero
  - Detail: por tenant y ciclo: (1) si hay versión de stock (de `parseProductsEtag` del ETag de `products`) pedir el delta; 200 → merge + recomponer ETag; 410/400/404/otros → borrar ETag de `products`; error de red se ignora. (2) rutas `products`, `promotions` y `setting`s mandan `If-None-Match` si hay snapshot y ETag; 304 → `touch` y cuenta como éxito; 200 → como hoy + guardar ETag; sin `ETag` → borrar. Medios de pago y clientes no cambian. 401/403, `optional` y recuperación sin cambios.
  - Done when: `syncer.test.ts` cubre 304, 200 con ETag, backend viejo, delta 200/410/404, el siguiente ciclo da 304 tras un delta, y que un 304 no activa la recuperación.
  - Dependencies: T003, T005
  - Can parallelize with: T008
  - Files affected: `lib/catalog/syncer.ts`, `syncer.test.ts`
  - Complexity: M
- [ ] **T011** — Entitlement desktop: ETag persistido y 304
  - Detail: `entitlement/store` guarda `etag?` en el JSON existente (compatible hacia atrás); `handleEntitlementRequest` manda `If-None-Match` propio y descarta el del navegador; 304 → 200 con el entitlement guardado, `fetchedAt` actualizado y `X-Omero-Cache: fresh`; sin `ETag` en el 200 → borra el guardado; se quita `ETag` hacia el navegador.
  - Done when: tests de `entitlement-proxy` y `store` (archivo viejo sin `etag` se lee bien) pasan.
  - Dependencies: T001
  - Can parallelize with: T008, T010
  - Files affected: `lib/entitlement/store.ts`, `entitlement-proxy.ts`, tests
  - Complexity: M

### Phase 3: Integration (navegador)
- [ ] **T012** — `apiFetch` devuelve headers y utilitarios de stock del cliente
  - Detail: `ApiResult` exitoso suma `headers?: Headers` (aditivo); `lib/stockDelta.ts` puro: `parseStockDelta(raw)` (validación estricta), `mergeStock(products, items)` (ignora códigos desconocidos), `stockVersionOf(headers)` (`X-Omero-Stock-Version` o `parseProductsEtag(ETag)`).
  - Done when: `stockDelta.test.ts` (merge, número inválido, versión ausente) y `apiClient.test.ts` actualizado pasan.
  - Dependencies: T003
  - Can parallelize with: T013
  - Files affected: `lib/apiClient.ts`, `lib/stockDelta.ts`, tests
  - Complexity: S
- [ ] **T013** — `mpEvents`: listener `stock`
  - Detail: `onStock(data)` opcional; mismo parseo defensivo que `payment`; sin cambios en reconexión ni en el manejo de `forbidden`.
  - Done when: `mpEvents.test.ts` cubre evento `stock`, malformado ignorado y que sin `onStock` no rompe.
  - Dependencies: T001
  - Can parallelize with: T012
  - Files affected: `lib/mpEvents.ts`, `lib/mpEvents.test.ts`
  - Complexity: S
- [ ] **T014** — `useProducts.syncStock`
  - Detail: `stockVersion` (ref) tomada de `stockVersionOf(headers)` en cada carga completa; `syncStock()` según la spec: sin versión → catálogo completo (límite 1 por 5 min); `GET /api/products/stock?since=v`; aplica `items` al estado y a `localStorage`; la versión solo avanza si es mayor; `version < stockVersion` o 410/error no de red → catálogo completo (mismo límite); error de red → nada; una ejecución a la vez con repetición única si llegó otro disparo; reconciliación completa sin condicional cada 30 min. Expone `syncStock`.
  - Done when: `useProducts` tests con timers falsos cubren delta aplicado, 410 → completo, límite 1/5 min, reentrancia, código desconocido, versión menor.
  - Dependencies: T012
  - Files affected: `app/pos/hooks/useProducts.ts`, tests
  - Complexity: L
- [ ] **T015** — `useStockSync` + cableado en `page.tsx`
  - Detail: hook que recibe `sseConnected` y `syncStock`: debounce de 250 ms para eventos; respaldo cada 30 s solo con `sseConnected = false`; una sincronización al reabrir el SSE. `useMercadoPagoEvents({ onStock })` expone el callback; `page.tsx` lo conecta por ref (el hook de eventos corre antes que `useProducts`). La recarga posterior a la venta (línea ~605) sigue igual.
  - Done when: tests de hook (ráfaga de eventos → una llamada; sin SSE → cada 30 s; reconexión → una) y que `creditFlow.test.tsx` / `weightFlow.test.tsx` siguen verdes.
  - Dependencies: T013, T014
  - Files affected: `app/pos/hooks/useStockSync.ts` (nuevo), `hooks/useMercadoPagoEvents.ts`, `hooks/index.ts`, `app/pos/page.tsx`, tests
  - Complexity: M
- [ ] **T016** — `useEntitlement` sin `no-store`
  - Detail: sacar `cache: 'no-store'` de `fetchEntitlement` para que el navegador revalide con ETag en modo web. La lógica `fromCache` (solo `X-Omero-Cache: hit`) y el desbloqueo "solo con dato en vivo" no cambian: un 304 o `fresh` cuenta como vivo.
  - Done when: `useEntitlement.test.ts` actualizado (la llamada ya no pasa `no-store`; `fresh` desbloquea; `hit` no).
  - Dependencies: T001
  - Can parallelize with: T012, T013
  - Files affected: `lib/useEntitlement.ts`, `useEntitlement.test.ts`
  - Complexity: S
- [ ] **T017** — Web: el proxy deja pasar el 304 y los headers de caché
  - Detail: solo tests (código ya reenvía `If-None-Match`, `ETag`, `Vary`, `Cache-Control`): 304 con body nulo no revienta `new Response`, `ETag` y `Vary: Authorization` llegan al navegador; en `web` el `data-layer` nunca toca el ETag. Si el test falla, corregir `forwardResponseHeaders`.
  - Done when: `backend-proxy.test.ts` / `backend-proxy.integration.test.ts` con los casos nuevos verdes.
  - Dependencies: T001
  - Can parallelize with: T012, T016
  - Files affected: `lib/backend-proxy*.test.ts`, (`lib/backend-proxy.ts` solo si hace falta)
  - Complexity: S

### Phase 4: Quality
- [ ] **T018** — Test integral desktop: ciclo completo sin cambios y con cambios
  - Detail: SQLite real + backend HTTP falso (como los tests de integración existentes): primer ciclo 200, segundo 304 sin reescritura; cambio de stock → delta → tercer ciclo 304; cambio de catálogo → 200 completo; 410 → catálogo completo; backend sin soporte = igual que antes; aislamiento entre dos tenants.
  - Done when: el archivo `catalog-etag.integration.test.ts` pasa.
  - Dependencies: T008, T009, T010
  - Files affected: `lib/catalog/catalog-etag.integration.test.ts` (nuevo)
  - Complexity: M
- [ ] **T019** — Cobertura y regresión
  - Detail: `npm --prefix web run check`; verificar umbral 85 % en `catalog/**`, `outbox/**` y archivos nuevos; `allowlist.contract.test.ts` verde sin tocar el backend; `npm run check` de la raíz.
  - Done when: ambos `check` verdes, sin bajar la cobertura previa.
  - Dependencies: T011, T015, T016, T017, T018
  - Complexity: S
- [ ] **T020** — Checklist E2E manual en beta
  - Detail: `AiBuild/.../WIP/manual-checklist.md`: dos cajas desktop + una web (A vende → B y web ven el stock en ≤ 5 s); SSE de B cortado 10 min → delta al reconectar; cajero sin permiso de MP recibe `stock` y no pagos (requiere T002 desplegado); backend de rama vieja = igual que hoy; offline desktop sigue vendiendo; ver el 304 en logs del backend (`cache.gets`). Se ejecuta con Avelino.
  - Done when: checklist escrito (la ejecución queda pendiente de Avelino).
  - Dependencies: T019
  - Complexity: S

### Phase 5: Polish
- [ ] **T021** — Logs y observabilidad
  - Detail: `console.warn('[catalog-sync] …')` con el mismo estilo para delta descartado (410), ETag borrado por backend viejo y fallback a catálogo completo; nada con tokens ni ETag junto al `Authorization`. Sin spam: un aviso por tenant y causa cada 10 min.
  - Done when: los avisos aparecen en los tests con `log` inyectado.
  - Dependencies: T010
  - Complexity: S
- [ ] **T022** — Documentar en `CLAUDE.md` del POS
  - Detail: sección corta "Caché con ETag y stock en vivo": quién posee el ETag en cada modo, por qué el evento es un disparador, `X-Omero-Cache: fresh` vs `hit`, migración v3, dependencia del PR backend.
  - Done when: sección agregada y consistente con el código.
  - Dependencies: T019
  - Complexity: S
- [ ] **T023** — Ajustar la spec funcional
  - Detail: actualizar `functional-spec.md` (aplicar el payload → disparador del delta, "sin indicador visual", dependencia del ticket SSE) para que los tres documentos no se contradigan.
  - Done when: spec funcional alineada con la técnica.
  - Dependencies: T019
  - Complexity: S
- [ ] **T024** — Notas de deuda técnica
  - Detail: registrar en `notes.md`: riesgo de orden commit/versión (reconciliación cada 30 min), límite de 20 emisores SSE por negocio, `omero#115` (admin) y la eliminación futura de `/pos` en `omero`.
  - Done when: `notes.md` actualizado.
  - Dependencies: T019
  - Complexity: S

## Dependency map
```
T001 ─┬─ T003 ─┬─ T008 ─┬─ T009 ─┐
      │        │        │        ├─ T018 ─ T019 ─┬─ T020
      ├─ T004 ─┼─ T005 ─┴─ T010 ─┘               ├─ T022
      │        ├─ T006 ─ T009                     ├─ T023
      │        └─ T007 ─ T009                     └─ T024
      ├─ T011 ───────────────────────────────── T019
      ├─ T013 ─┐
      ├─ T003 ─ T012 ─ T014 ─ T015 ─────────── T019
      ├─ T016 ───────────────────────────────── T019
      └─ T017 ───────────────────────────────── T019
T002 (backend, independiente; necesario solo para el E2E de cajeros sin permiso MP)
T010 ─ T021
```

## Parallelizable groups
- **Group A** (tras T001): T003, T004, T011, T013, T016, T017 y T002 (repo backend).
- **Group B** (tras T004): T005, T006, T007 en paralelo; T012 tras T003.
- **Group C** (carril desktop): T008 y T010 en paralelo (ambos tras T003 + T005); luego T009.
- **Group D** (carril navegador): T012 → T014 → T015, independiente del carril desktop.
- **Group E** (cierre): T018 → T019 → T020/T022/T023/T024.

## Risks and mitigations
| Risk | Probability | Mitigation |
|------|------------|------------|
| ETag viejo contra datos distintos en SQLite (stock fusionado) | Media | El ETag se guarda en la misma transacción que los datos y tras el delta se recompone; si no coincide el backend responde 200 completo (nunca datos viejos) |
| Doble descuento stock-adjust vs evento/delta | Media | Delta de desktop se ajusta solo con pendientes (sin `since`); test explícito de venta enviada y confirmada |
| 304 mostrado como "sin conexión" o al revés | Baja | `X-Omero-Cache: fresh` distinto de `hit`; tests en `useEntitlement` |
| Evento fuera de orden pierde un cambio de stock | Baja | El evento solo dispara el delta; versión local avanza con la respuesta del delta; reconciliación completa cada 30 min |
| Tormenta de catálogo completos si el delta falla en muchas cajas | Baja | Límite de 1 catálogo completo cada 5 min por caja |
| Más de 20 conexiones SSE por negocio (todas las cajas conectan) | Baja | Backoff con jitter ya existente; se vigila en beta |
| Backend viejo en beta mezclado con el POS nuevo | Media | Cubierto por tests (sin `ETag` ni delta → como hoy) |
| T002 se retrasa y el cajero sin MP queda sin SSE | Media | Respaldo de 30 s; no bloquea el merge de este PR |

## Complexity summary
| Task | S/M/L/XL | Reason |
|------|----------|--------|
| T008 | L | Toca el camino caliente del POS desktop, headers y offline |
| T014 | L | Estado asíncrono con reentrancia, límites y localStorage |
| T002, T005, T009, T010, T011, T015, T018 | M | Lógica con varios casos de borde, tests de integración |
| Resto | S | Cambios acotados o solo tests/docs |
