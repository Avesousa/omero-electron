# Task Plan: Outbox de ventas y gastos offline (Fase 3)

## Metadata
- **Date:** 2026-09-21
- **Branch:** `feature/pos-offline-outbox` en `omero-backend`, `omero-electron` y `omero` (cada una desde su `develop`)
- **Type:** feature (3 repos)
- **Tests required:** yes (Unit + Integration en los tres repos + smoke E2E)
- **Total tasks:** 28 (4 S · 12 M · 12 L) — backend 8, POS 12, admin 5, transversales 3
- **Parallelizable groups:** 8 olas (ver abajo)

## Executive summary
El trabajo se entrega en tres PRs en orden: **backend → POS → admin**. El backend (V17 aditiva, endpoint `POST /api/sync/batch`, revisión de ventas, blindaje de los consumidores de `item.getProduct()`) se desarrolla primero porque el POS y el admin dependen de su contrato, pero como las tareas del POS y del admin se apoyan en un backend falso con el mismo JSON, **se pueden avanzar en paralelo**. En el POS se construye el outbox SQLite durable (separado de la caché), el sender con backoff 30/90/270/810 s, la intercepción de `POST /api/sales`/`/api/expenses` en desktop, el stock mostrado `backend − pendientes`, los endpoints locales y la UI (pendientes, revisión, `mp_offline`, logout). En el admin, la pantalla "Ventas a revisar" con asignación de producto, el indicador y el switch `mp_offline`. Cierra un smoke E2E con los tres repos y el backend desplegado primero.

## Hallazgo durante el plan
- Es el plan más grande hasta ahora y cruza tres repos: cada tarea lleva su repo entre corchetes. Las ramas de `omero-backend` y `omero` se crean dentro de T001 y T006.
- El **riesgo principal** es el blindaje de ~20 consumidores de `item.getProduct()` (T003): un ítem huérfano rompería el dashboard. Se cubre con una prueba de integración contra cada endpoint (T021).

## Phases and tasks

### Phase 0: Setup

- [ ] **T001** — [backend] Rama en omero-backend y línea base de tests
  - Detail: En omero-backend: `git checkout develop && git pull && git checkout -b feature/pos-offline-outbox`. Correr la suite actual (`./mvnw test`, Testcontainers/Postgres con Docker o Colima) para tener la línea base verde. Anotar cualquier test ya roto para no confundirlo con regresiones.
  - Done when: Rama creada desde develop; `./mvnw test` corre y se registra el resultado base (verde o la lista de tests ya rotos).
  - Dependencies: none
  - Can parallelize with: T004, T005, T006
  - Files affected: (omero-backend) —
  - Complexity: S

- [ ] **T002** — [backend] Migración V17 y campos de entidades
  - Detail: Crear `V17__sales_outbox_review.sql` según la tech-spec: `client_id` en sales/expenses con índices únicos parciales `(tenant_id, client_id)`; en sales `source`, `source_user_id`, `review_status`, `review_reasons`, `review_note`, `reviewed_by`, `reviewed_at` + índice parcial `NEEDS_REVIEW`; en sale_items `product_code`, `product_name` (backfill desde products), `product_id` NULLABLE, FK `ON DELETE SET NULL`, `assigned_by`, `assigned_at`; INSERT de la key `mp_offline` (boolean, default false, auto_provision true). Actualizar entidades `Sale`, `SaleItem` (product opcional), `Expense` y `@PrePersist` (`createdAt` solo si es null; `updatedAt` siempre servidor). No tocar `LocalSchemaMigrator`.
  - Done when: `./mvnw test` sigue verde con la migración aplicada sobre Postgres; una prueba manual/automática confirma el backfill del snapshot y que borrar un producto deja el ítem con `product_id NULL`.
  - Dependencies: T001
  - Files affected: (omero-backend) src/main/resources/db/migration/V17__sales_outbox_review.sql, (omero-backend) model/Sale.java, model/SaleItem.java, model/Expense.java
  - Complexity: M

### Phase 1: Foundation

- [ ] **T003** — [backend] Blindar los consumidores de `item.getProduct()`
  - Detail: En `SaleItem` agregar `displayCode()`, `displayName()` (snapshot si no hay producto) y `categoryOrUnassigned()` que devuelve una categoría/negocio sintéticos "Sin identificar" (constante). Reemplazar el uso directo de `item.getProduct()...` en: `SaleItemResponseDto` (código/nombre, `productId` nullable, flag `hasProduct`), `DashboardService` (~10 sitios: categoría, productKey, nombre), `StatsService` (4), `ReportService` (costo), `PromotionService` (ítems de venta). Costo de ítem huérfano = `unit_cost` (0). Agregar `reviewStatus`/`reviewReasons` a `SaleResponseDto`.
  - Done when: Con una venta con ítem huérfano, `GET /api/sales`, dashboard, stats y reportes responden 200 y el ítem cae en "Sin identificar" (verificado en T021); el código compila y los tests existentes pasan.
  - Dependencies: T002
  - Can parallelize with: T004
  - Files affected: (omero-backend) model/SaleItem.java, dto/SaleItemResponseDto.java, dto/SaleResponseDto.java, service/DashboardService.java, service/StatsService.java, service/ReportService.java, service/PromotionService.java
  - Complexity: L

- [ ] **T004** — [POS] Outbox SQLite: esquema, migraciones y `OutboxStore`
  - Detail: Nuevo `web/src/lib/outbox/outbox-store.ts` + `outbox-migrations.ts`: archivo `<OMERO_DATA_DIR>/<tenantId>.outbox.sqlite` (misma validación UUID/anti path-traversal que la caché), `PRAGMA journal_mode=WAL; synchronous=FULL; busy_timeout=3000; user_version` + migración 1 (`outbox` y `outbox_meta` de la tech-spec). API: `enqueue({type,payload,createdAt})` (genera `clientId` con `crypto.randomUUID()`, confirma con FULL), `nextBatch(limit)` (PENDING por `seq`), `markSent/markReview/markFailed/markAttempt`, `counts()`, `list({status,limit,offset})`, `getPending quantities` (para stock), `purge(now)` (SENT>7d, FAILED descartados>30d), `dismiss(clientId)`, `close()`. Registro por tenant análogo a `store-registry` (degrada a null si no hay módulo/dir). Base corrupta o de esquema más nuevo: **NO se borra** (contiene ventas): se renombra a `.corrupt-<ts>`, se loguea y se crea una nueva.
  - Done when: Con archivos temporales: enqueue/lecturas/transiciones/purga funcionan, `client_id` es único, el orden es por `seq`, y una base corrupta se aparta sin perder el archivo; `tsc` OK.
  - Dependencies: none
  - Can parallelize with: T001, T005, T006
  - Files affected: web/src/lib/outbox/outbox-store.ts, web/src/lib/outbox/outbox-migrations.ts, web/src/lib/outbox/outbox-registry.ts, web/src/lib/outbox/types.ts
  - Complexity: L

- [ ] **T005** — [POS] Caché de `settings` (mp_offline) en la caché del catálogo
  - Detail: Migración 2 de la caché del catálogo: tabla `settings(key,json,synced_at)`. `CatalogStore` suma `getSetting/upsertSetting`; `cache-policy` suma `GET /api/business/config/{key}` (solo `[A-Za-z0-9_]+`) como recurso `setting`; `catalog-proxy` hace read-through y sirve desde caché con 502/503/504 (mismos headers `X-Omero-Cache*`). Actualizar tipos y `snapshot.ts` (`applyCatalogPayload` para `setting`).
  - Done when: Online el valor de `mp_offline` queda cacheado; sin conexión se sirve desde SQLite; una base v1 se migra a v2 sin perder productos/promociones.
  - Dependencies: none
  - Can parallelize with: T001, T004, T006
  - Files affected: web/src/lib/catalog/migrations.ts, web/src/lib/catalog/sqlite-store.ts, web/src/lib/catalog/types.ts, web/src/lib/catalog/cache-policy.ts, web/src/lib/catalog/catalog-proxy.ts, web/src/lib/catalog/snapshot.ts
  - Complexity: M

- [ ] **T006** — [admin] Rama en omero (admin) y tipos/API de revisión
  - Detail: En omero: rama `feature/pos-offline-outbox` desde develop. Tipos en `src/shared/types` (`SaleReview`, `SaleItemReview`, `ReviewReason`) y helpers de `apiFetch` para `GET /api/sales/review`, `GET /api/sales/review/count`, `POST /api/sales/{id}/review`, `POST .../items/{itemId}/assign-product`, `GET/PUT /api/business/config/mp_offline`.
  - Done when: Rama creada; los tipos y helpers compilan (`tsc`).
  - Dependencies: none
  - Can parallelize with: T001, T004, T005
  - Files affected: (omero) src/shared/types/salesReview.ts, src/lib/salesReviewApi.ts
  - Complexity: S

### Phase 2: Core

- [ ] **T007** — [backend] Servicio de sincronización por lotes (`SyncBatchService`)
  - Detail: DTOs `SyncBatchRequest/Item`, `SyncResult`, `SyncReview`. Extraer la lógica de `SaleService.create` a un método compartido y crear el camino batch: `createdAt` de la caja (ventana `now−30d ≤ createdAt ≤ now+5min`, fuera → `NEEDS_REVIEW` con `CREATED_AT_TOO_OLD/IN_FUTURE`), costo vigente al recibir, **stock `max(0, stock−qty)`**, `mpStatus=PENDING` + impuesto MP, `source=POS_OFFLINE`, snapshot por ítem, producto faltante → ítem sin producto + `PRODUCT_NOT_FOUND` + venta `NEEDS_REVIEW`. Gastos con `client_id`. `SyncItemProcessor` con `@Transactional(REQUIRES_NEW)` por ítem; `DataIntegrityViolationException` por `client_id` → re-consulta → `DUPLICATE`; excepción inesperada → `REJECTED/INTERNAL_ERROR`. `POST /api/sales` y `/api/expenses` legados NO cambian.
  - Done when: Verificado por T020: `CREATED`, `DUPLICATE` (sin duplicar ni volver a descontar), lote mixto, fechas, producto faltante, stock piso 0, MP PENDING.
  - Dependencies: T002, T003
  - Can parallelize with: T009
  - Files affected: (omero-backend) dto/sync/*, service/SyncBatchService.java, service/SyncItemProcessor.java, service/SaleService.java, service/ExpenseService.java
  - Complexity: L

- [ ] **T008** — [backend] `SyncController` `POST /api/sync/batch` con validación y límites
  - Detail: Controller autenticado (cualquier rol del tenant): valida `items` ≤ 100, cuerpo ≤ 1 MB, `type` ∈ {SALE, EXPENSE}, `clientId` UUID, `createdAt` ISO, importes; `sourceUserId` se verifica contra el tenant (si no, se ignora). Respuesta 200 con `results[]` por ítem; envelope inválido → 400. Registrar reglas de seguridad si hace falta.
  - Done when: El endpoint responde el contrato de la tech-spec; excesos de tamaño/validación devuelven 400; el tenant sale del JWT.
  - Dependencies: T007
  - Files affected: (omero-backend) controller/SyncController.java, config/SecurityConfig.java (si aplica)
  - Complexity: M

- [ ] **T009** — [backend] Endpoints de revisión para el admin
  - Detail: `SaleReviewService` + `SaleReviewController` (`@PreAuthorize ADMIN`): `GET /api/sales/review?status=`, `GET /api/sales/review/count`, `POST /api/sales/{id}/review {note ≤500}` (idempotente, permitido con huérfanos pendientes), `POST /api/sales/{id}/items/{itemId}/assign-product {productCode}` (solo si `product_id IS NULL`; costo vigente; stock `max(0, stock−qty)`; `assigned_by/at`; snapshot intacto; 404 producto inexistente; 409 ya asignado). DTOs con ítems completos, snapshot, pagos, fechas caja/recepción, motivos y auditoría. Repositorio con queries `LEFT JOIN FETCH`.
  - Done when: Los cuatro endpoints funcionan y respetan tenant y rol (verificado en T021).
  - Dependencies: T002, T003
  - Can parallelize with: T007
  - Files affected: (omero-backend) controller/SaleReviewController.java, service/SaleReviewService.java, dto/review/*, repository/SaleRepository.java
  - Complexity: L

- [ ] **T010** — [POS] `OutboxSender`: lotes, backoff y estados
  - Detail: Nuevo `outbox-sender.ts`: singleton en `globalThis`, uno por tenant. `kick(tenantId)`; lote de hasta 50 `PENDING` por `seq` → `POST {BACKEND_URL}/api/sync/batch` (timeout 30 s, `Authorization` en memoria del `CatalogSyncer`; exige que el token pertenezca al tenant del archivo). Resultados por ítem → `SENT/REVIEW/FAILED` (`INTERNAL_ERROR` sigue `PENDING`). Fallos de transporte (red/timeout/5xx/404/respuesta inválida): `attempts++` y próximo intento a **30 s → 90 s → 270 s → 810 s → 810 s…** (fallos consecutivos por tenant; un lote exitoso reinicia). 401/403 → detiene y olvida token (`backend:"unauthorized"`); 404 → `backend:"unsupported"`. Continúa de inmediato si quedan `PENDING` tras un éxito. Se engancha a la detección de recuperación del syncer y a un nuevo `Authorization` (login). Exponer `getAuthorization(tenantId)` en el syncer y un `state()` (`ok|offline|unsupported|unauthorized`, `nextAttemptAt`). Purga periódica.
  - Done when: Con timers falsos y backend falso: secuencia de backoff exacta, un lote a la vez, transiciones de estado correctas, reanudación con token nuevo (verificado en T022/T023).
  - Dependencies: T004
  - Can parallelize with: T012, T014
  - Files affected: web/src/lib/outbox/outbox-sender.ts, web/src/lib/catalog/syncer.ts
  - Complexity: L

- [ ] **T011** — [POS] Intercepción de `POST /api/sales` y `/api/expenses` (desktop)
  - Detail: `outbox-proxy.ts` + `data-layer.ts`: en desktop, con tenant y outbox disponibles, `POST /api/sales` y `POST /api/expenses` se validan liviano (JSON, importes), se insertan en el outbox (`createdAt` = hora de la caja, sin costo) **confirmando antes de responder** y devuelven `201 {success:true,data:{id:null,clientId,queued:true,createdAt,total,items}}`; luego `sender.kick`. Sin outbox/tenant/módulo → proxy directo (degradación). Web nunca intercepta. Los `productName` de los ítems se conservan en el payload. Actualizar el punto de extensión documentado en `data-layer.ts`.
  - Done when: Desktop: 201 inmediato + fila en el outbox; web y degradación: pass-through; el resto de rutas sin cambios (verificado en T023).
  - Dependencies: T004, T010
  - Can parallelize with: T013
  - Files affected: web/src/lib/outbox/outbox-proxy.ts, web/src/lib/data-layer.ts
  - Complexity: M

- [ ] **T012** — [POS] Stock mostrado = backend − pendientes (`stock-adjust`)
  - Detail: `stock-adjust.ts`: para `GET /api/products` y `/api/products/{code}` (respuesta online **y** servida desde caché) resta por código las cantidades de ítems de venta del outbox aún no reflejadas: `PENDING`, o `SENT/REVIEW` con `sent_at > products.last_sync_at − 2 s`; piso 0; el código `000` no se ajusta; precios intactos. Camino rápido sin parsear JSON si no hay filas activas. Integrar en `catalog-proxy`.
  - Done when: Con ventas pendientes el stock del catálogo baja en esa cantidad (piso 0) y deja de descontarse cuando un snapshot posterior lo incluye (verificado en T022/T023).
  - Dependencies: T004
  - Can parallelize with: T010, T014
  - Files affected: web/src/lib/outbox/stock-adjust.ts, web/src/lib/catalog/catalog-proxy.ts
  - Complexity: M

- [ ] **T013** — [POS] Endpoints locales del outbox
  - Detail: `GET /api/_local/outbox` (`counts`, `backend`, `nextAttemptAt`, `items` paginados sin payload; `?detail=<clientId>` con payload), `POST /api/_local/outbox/import` (cola vieja), `POST /api/_local/outbox/{clientId}/dismiss`; `GET /api/_local/connectivity` suma `outbox:{pending,review,failed}`. Todos exigen `Authorization` para resolver el tenant (web: 204/vacío).
  - Done when: Los endpoints responden con el contrato de la tech-spec y respetan el aislamiento por tenant.
  - Dependencies: T004, T010
  - Can parallelize with: T011
  - Files affected: web/src/app/api/%5Flocal/outbox/route.ts, web/src/app/api/%5Flocal/outbox/import/route.ts, web/src/app/api/%5Flocal/outbox/[clientId]/dismiss/route.ts, web/src/app/api/%5Flocal/connectivity/route.ts
  - Complexity: M

- [ ] **T014** — [POS] Importación de la cola vieja de `localStorage`
  - Detail: `legacy-import.ts`: recibe los ítems de `omero_purchase_queue` del tenant, los inserta en el outbox (idempotente por `legacy_imported` en `outbox_meta` y por id viejo → `clientId` derivado estable; respeta `queuedAt` como `createdAt`) y devuelve los ids importados para que el cliente limpie su cola. Ítems sin `tenantId` no se importan (como hoy).
  - Done when: Importar dos veces la misma cola no duplica; los ítems quedan `PENDING` con su fecha original.
  - Dependencies: T004
  - Can parallelize with: T010, T012
  - Files affected: web/src/lib/outbox/legacy-import.ts
  - Complexity: M

### Phase 3: Integration

- [ ] **T015** — [POS] Cliente POS: `useSales`, `useExpenses`, `useOfflineQueue`
  - Detail: `useSales`: agregar `productName` a los ítems; en **desktop** sin reintentos ni encolado (el Next confirma al instante y devuelve `queued:true`); en **web** un solo intento (error si falla, sin `localStorage`) y flush único de la cola vieja. `useOfflineQueue`: en desktop el contador viene del outbox y al montar importa la cola vieja (`POST /api/_local/outbox/import`) y limpia lo importado. `useExpenses`: confirmar que acepta `queued:true`. Ajustar mensajes de notificación.
  - Done when: Desktop: la venta se confirma al instante y aparece en el contador del outbox; web: sin encolado local y error visible si falla; la cola vieja se importa una sola vez.
  - Dependencies: T011, T014
  - Files affected: web/src/app/pos/hooks/useSales.ts, web/src/app/pos/hooks/useOfflineQueue.ts, web/src/app/pos/hooks/useExpenses.ts, web/src/lib/purchaseQueueStorage.ts
  - Complexity: M

- [ ] **T016** — [POS] UI del POS: pendientes, revisión, MP offline y logout
  - Detail: `useOutboxStatus` (polling de `/api/_local/outbox` + eventos); `ConnectionStatus` usa `outbox.pending` para "N pendientes sin sync" y agrega "N para revisar" que abre un `Modal` con la lista (estado, fecha, resumen, motivo, `dismiss` para FAILED); botón Actualizar sigue solo verificando conexión. `useBusinessConfig("mp_offline")` (cacheado) y en `PaymentModal` el botón MP se deshabilita con mensaje si `!online && !mpOffline`. `AuthContext.logout` avisa si hay pendientes (no los borra). Estilo oscuro y numpad del POS.
  - Done when: Las tres vistas funcionan en desktop; en web el header queda como hoy; el botón MP respeta `mp_offline` (verificado en T024).
  - Dependencies: T013, T015, T005
  - Files affected: web/src/app/pos/hooks/useOutboxStatus.ts, web/src/app/pos/hooks/useBusinessConfig.ts, web/src/app/pos/components/ConnectionStatus.tsx, web/src/app/pos/components/OutboxListModal.tsx, web/src/app/pos/components/modals/PaymentModal.tsx, web/src/shared/contexts/auth.tsx
  - Complexity: L

- [ ] **T017** — [admin] Admin: pantalla "Ventas a revisar"
  - Detail: `admin/sales/review/page.tsx`: lista con pestañas (Requieren revisión / Revisadas) y tarjetas de venta; modal de detalle con todos los ítems (snapshot código/nombre, cantidad, precios, costo, si tienen producto), pagos (efectivo/MP/vuelto), fechas de caja y de recepción, motivos, nota y auditoría. Acciones: **Marcar revisada** (nota) y **Asignar producto** a un ítem sin producto (buscador por código/nombre → `assign-product`, confirmación de efectos costo/stock). Usa `Modal` compartido, `o-cta*`/`badge-*`; estados de carga/error/vacío.
  - Done when: El admin puede listar, ver el detalle, marcar revisada y asignar producto contra el backend (o un mock) sin errores de consola.
  - Dependencies: T006, T009
  - Can parallelize with: T018, T019
  - Files affected: (omero) src/app/admin/sales/review/page.tsx, src/app/admin/sales/review/components/*
  - Complexity: L

- [ ] **T018** — [admin] Admin: indicador, insignia en ventas y vistas a prueba de ítems sin producto
  - Detail: Contador de "N ventas a revisar" (`GET /api/sales/review/count`) en `HomeNavCards`/`navConfig` y enlace a la revisión. En `admin/sales/page.tsx`: insignia en ventas `NEEDS_REVIEW` con enlace y render seguro de ítems sin producto (muestra snapshot). Revisar otras vistas que muestren ítems de venta.
  - Done when: El contador aparece y se actualiza; una venta con ítem sin producto se ve bien en el listado.
  - Dependencies: T006, T009
  - Can parallelize with: T017, T019
  - Files affected: (omero) src/app/components/HomeNavCards.tsx, src/app/components/nav/navConfig.ts, src/app/admin/sales/page.tsx
  - Complexity: M

- [ ] **T019** — [admin] Admin: switch `mp_offline` en MercadoPago
  - Detail: En `admin/mercadopago/page.tsx` agregar un switch "Permitir pagos MercadoPago sin conexión (mp_offline)" con `GET/PUT /api/business/config/mp_offline` (solo ADMIN edita; estado de carga y error), texto explicativo (la venta entra como pendiente de conciliación).
  - Done when: El switch lee y guarda el valor; un usuario no admin no puede modificarlo.
  - Dependencies: T006, T002
  - Can parallelize with: T017, T018
  - Files affected: (omero) src/app/admin/mercadopago/page.tsx
  - Complexity: S

### Phase 4: Quality

- [ ] **T020** — [backend] Tests de integración del batch
  - Detail: JUnit + Testcontainers (`BaseIntegrationTest`): `CREATED` con `client_id`, `createdAt` de la caja y `updatedAt` del servidor; `DUPLICATE` sin duplicar ni re-descontar stock; carrera de dos lotes con el mismo `clientId`; lote mixto (bueno + malo + duplicado); `REJECTED` por validación; `INTERNAL_ERROR`; límites (100 ítems, 1 MB), `type` inválido, `clientId` no UUID; stock piso 0 (y legado sin cambios); costo vigente; MP → `PENDING` + impuesto MP; gasto con `client_id`; ventana de fechas (30 d / +5 min); producto faltante (ítem sin producto, snapshot, sin tocar stock, venta `NEEDS_REVIEW`, resto descuenta); compatibilidad de `POST /api/sales` y `/api/expenses`.
  - Done when: `./mvnw test` pasa incluyendo la clase nueva; el contrato coincide con la tech-spec.
  - Dependencies: T008
  - Can parallelize with: T021
  - Files affected: (omero-backend) src/test/java/com/omero/integration/SyncBatchControllerTest.java
  - Complexity: L

- [ ] **T021** — [backend] Tests: revisión, asignación, migración, blindaje y `mp_offline`
  - Detail: Listar/contar/marcar revisada (idempotente, `ADMIN`, cross-tenant 404); asignar producto (costo vigente, stock piso 0, auditoría, 409/404); migración V17 sobre datos sembrados (backfill del snapshot; borrar un producto ya NO borra el ítem); **prueba de blindaje**: venta con ítem huérfano contra cada endpoint de ventas/dashboard/stats/reportes → 200 y bucket "Sin identificar"; `mp_offline` legible por tenants existentes y editable solo por ADMIN.
  - Done when: `./mvnw test` pasa incluyendo las clases nuevas.
  - Dependencies: T009, T003, T002
  - Can parallelize with: T020
  - Files affected: (omero-backend) src/test/java/com/omero/integration/SaleReviewControllerTest.java, OrphanItemHardeningTest.java, MigrationV17Test.java
  - Complexity: L

- [ ] **T022** — [POS] Tests unit del POS (outbox)
  - Detail: `outbox-store` (esquema, migraciones, orden por `seq`, unicidad, transiciones, purga, durabilidad, base corrupta apartada, path traversal), backoff (30/90/270/810/810…, reinicio), `stock-adjust` (pendiente vs reflejado por `last_sync_at`, piso 0, `000`), `legacy-import` (idempotencia, mapeo de tenant, fecha original), settings cache. Cobertura ≥85 % en `lib/outbox/**`.
  - Done when: `npm --prefix web run check` pasa con los umbrales.
  - Dependencies: T004, T005, T010, T012, T014
  - Can parallelize with: T023
  - Files affected: web/src/lib/outbox/*.test.ts, web/src/lib/catalog/*.test.ts, web/vitest.config.mts
  - Complexity: L

- [ ] **T023** — [POS] Tests de integración del POS: outbox + backend falso + SQLite real
  - Detail: Backend HTTP falso con el mismo JSON del contrato. Casos: intercepción (201 inmediato + fila); envío exitoso; `DUPLICATE`; resultado mixto (`SENT`/`REVIEW`/`FAILED`/`INTERNAL_ERROR` reintenta); red caída y 5xx → backoff; `401` detiene y se reanuda con token nuevo; `404` → `unsupported`; reinicio con pendientes; **tenant A no envía con token de B**; modo web no intercepta ni crea outbox; degradación sin outbox → proxy directo; stock `backend − pendientes`; cola vieja importada una sola vez; endpoints `_local/outbox`. Estable en 3 corridas.
  - Done when: `npx vitest run` de la clase pasa 3 veces seguidas.
  - Dependencies: T011, T012, T013, T014
  - Can parallelize with: T022
  - Files affected: web/src/lib/outbox/outbox.integration.test.ts
  - Complexity: L

- [ ] **T024** — [POS] Tests de UI del POS
  - Detail: Testing Library: `ConnectionStatus` con outbox (pendientes, revisión, ambos, oculto en web, botón solo verifica), `OutboxListModal` (estados y dismiss), `PaymentModal` (MP deshabilitado offline sin `mp_offline`, habilitado con él), aviso al cerrar sesión con pendientes, `useSales` (sin encolado en web, sin reintento en desktop, `productName`), importación de la cola vieja, `useBusinessConfig`.
  - Done when: `npm --prefix web test` pasa.
  - Dependencies: T015, T016
  - Can parallelize with: T025
  - Files affected: web/src/app/pos/**/*.test.ts(x), web/src/shared/contexts/auth.test.tsx
  - Complexity: M

- [ ] **T025** — [admin] Tests del admin
  - Detail: vitest + Testing Library: lista de revisión (estados vacío/carga/error), modal de detalle con ítem huérfano, marcar revisada, asignar producto (éxito, 404, 409), contador en home/nav, insignia en ventas, switch `mp_offline` (lectura/guardado/permiso).
  - Done when: `yarn test` y `tsc --noEmit` pasan en omero.
  - Dependencies: T017, T018, T019
  - Can parallelize with: T024
  - Files affected: (omero) src/app/admin/sales/review/*.test.tsx, src/app/admin/mercadopago/*.test.tsx
  - Complexity: M

- [ ] **T026** — [E2E] Smoke end-to-end local con los 3 repos
  - Detail: Con `omero-start/dev.sh` levantando el backend desde la rama del backend (migración V17 aplicada), el POS desktop (standalone empaquetado con el Node de Electron, como en la fase 2) y el admin, y un gateway intermitente: (1) venta online → queda `SENT`; (2) backend caído → venta queda `PENDING`, stock mostrado baja; vuelve → se sube; (3) respuesta perdida tras guardar → reintento devuelve `DUPLICATE` sin duplicar; (4) producto eliminado → aparece en el admin con snapshot, se asigna producto (costo/stock); (5) fecha fuera de ventana → `NEEDS_REVIEW`; (6) venta MP offline con `mp_offline` on/off; (7) reinicio de Electron con pendientes; (8) logout con pendientes; (9) backend viejo sin `/api/sync/batch` → `unsupported`. Registrar resultados en `manual-checklist.md`.
  - Done when: Los checks pasan y quedan con fecha en manual-checklist.md.
  - Dependencies: T008, T009, T011, T013, T016, T017, T019
  - Files affected: AiBuild/feature/pos-offline-outbox/WIP/manual-checklist.md
  - Complexity: L

### Phase 5: Polish

- [ ] **T027** — [E2E] Documentación de los tres repos
  - Detail: CLAUDE.md/README de omero-backend (V17, endpoint de sincronización, revisión, `mp_offline`, blindaje, deuda de stock legado), omero-electron (outbox, sender, intercepción, stock ajustado, endpoints locales, env), omero (pantalla de revisión, switch). Ajustar la technical-spec con las decisiones tomadas durante el build.
  - Done when: Un desarrollador nuevo entiende el flujo completo desde los CLAUDE.md; la spec refleja lo construido.
  - Dependencies: T016, T017, T019
  - Can parallelize with: T028
  - Files affected: (omero-backend) CLAUDE.md, (omero-electron) CLAUDE.md, README.md, (omero) CLAUDE.md, technical-spec.md
  - Complexity: M

- [ ] **T028** — [E2E] Checklist manual, deuda técnica y preparación de los 3 PRs
  - Detail: Completar manual-checklist.md (verificaciones en instalador Win/mac, reloj desajustado, corte de luz con outbox, varias cajas, otro tenant en la misma máquina). Registrar deuda: piso de stock en el camino legado, tabla de sobreventas, JWT de 1 h (fase 4), historial ya perdido por el CASCADE. Dejar listo el orden de PRs (backend → POS → admin) y el orden de despliegue.
  - Done when: Checklist y deuda documentados; los tres PRs con descripción y test plan.
  - Dependencies: T026
  - Can parallelize with: T027
  - Files affected: AiBuild/feature/pos-offline-outbox/WIP/manual-checklist.md
  - Complexity: S

## Dependency map
```
BACKEND   T001 ─► T002 ─► T003 ─┬─► T007 ─► T008 ─► T020
                         │      └─► T009 ─► T021
                         └────────► T009
POS       T004 ─┬─► T010 ─┬─► T011 ─┬─► T015 ─┐
                │         └─► T013 ─┘         ├─► T016 ─► T024
                ├─► T012                      │
                ├─► T014 ────────────────────┘
                └─► T005 ──────────────────────► T016
ADMIN     T006 ─┬─► T017 ─┐ (T009)
                ├─► T018 ─┼─► T025
                └─► T019 ─┘ (T002)
E2E       T008,T009,T011,T013,T016,T017,T019 ─► T026 ─► T028
DOCS      T016,T017,T019 ─► T027
TESTS POS T004,T005,T010,T012,T014 ─► T022 ; T011,T012,T013,T014 ─► T023
```

## Parallelizable groups
- **Wave 1** (sin dependencias): T001, T004, T005, T006
- **Wave 2**: T002 (tras T001); T010, T012 y T014 (tras T004)
- **Wave 3**: T003 (tras T002); T019 (tras T006 y T002)
- **Wave 4**: T007 y T009 (tras T002/T003); T011 y T013 (tras T004/T010)
- **Wave 5**: T008 (tras T007); T015 (tras T011/T014); T017 y T018 (tras T006/T009)
- **Wave 6**: T016 (tras T013/T015/T005); T020 (tras T008); T021 (tras T009/T003/T002)
- **Wave 7**: T022, T023 (POS), T024, T025
- **Wave 8**: T026, T027, T028

**Conflictos de archivos entre tareas paralelas:** `catalog-proxy.ts` lo tocan T005 y T012; `data-layer.ts` T011; `ConnectionStatus.tsx`/`auth.tsx` T016; `SaleService.java` T007 (extrae lógica compartida) y `SaleItem.java` T002/T003; `vitest.config.mts` T022; `package.json` no cambia. Integrar en el orden de dependencias o asignar al mismo agente.

## Ruta crítica
T001 → T002 → T003 → T007 → T008 → T020 → T026 → T028, y en paralelo T004 → T010 → T011 → T015 → T016 → T026.

## Orden de entrega y despliegue
1. PR de **omero-backend** (T001–T003, T007–T009, T020–T021) → desplegar a Railway **antes** de publicar el POS nuevo.
2. PR de **omero-electron** (T004, T005, T010–T016, T022–T024).
3. PR de **omero** (T006, T017–T019, T025); requiere el backend desplegado.
`master` no se toca en ninguno.

## Risks and mitigations
| Risk | Probability | Mitigation |
|------|------------|------------|
| Un ítem huérfano rompe dashboard/stats/reportes/DTO (NPE) | Alta | T003 con helpers y bucket "Sin identificar" + T021 con prueba por endpoint |
| Migración V17 en producción (backfill + cambio de FK) | Media | Aditiva; se prueba con datos sembrados (T021); backend se despliega primero |
| Contrato desalineado entre backend, POS y admin | Media | Contrato único en la tech-spec; backend falso del POS y mocks del admin con el mismo JSON; T026 lo verifica con los tres reales |
| Doble descuento de stock local (pendiente + snapshot) | Media | Regla `sent_at` vs `last_sync_at` (T012) con tests de la ventana |
| Pérdida de una venta por corte de luz o base dañada | Baja | `synchronous=FULL`, confirmar antes del 201 (T004/T011); una base corrupta **se aparta, no se borra** |
| POS nuevo contra backend sin endpoint | Media | El sender pausa con `unsupported` (T010) y se prueba en T026 |
| Concurrencia del mismo `clientId` en el backend | Media | Índice único parcial + resolución como `DUPLICATE`; test de carrera (T020) |
| Tests de backend requieren Docker/Testcontainers | Baja | T001 fija la línea base; ya hay `ColimaDockerClientProviderStrategy` |
| JWT de 1 h impide subir fuera de sesión | Alta (conocida) | Se reanuda al iniciar sesión; el outbox persiste; fase 4 |
| Tres repos = mucho cambio simultáneo | Media | Tres PRs chicos por capa y en orden; olas de trabajo paralelas |

## Complexity summary
| Task | S/M/L/XL | Reason |
|------|----------|--------|
| T001 | S | [backend] Rama en omero-backend y línea base de tests |
| T002 | M | [backend] Migración V17 y campos de entidades |
| T003 | L | [backend] Blindar los consumidores de `item.getProduct()` |
| T004 | L | [POS] Outbox SQLite: esquema, migraciones y `OutboxStore` |
| T005 | M | [POS] Caché de `settings` (mp_offline) en la caché del catálogo |
| T006 | S | [admin] Rama en omero (admin) y tipos/API de revisión |
| T007 | L | [backend] Servicio de sincronización por lotes (`SyncBatchService`) |
| T008 | M | [backend] `SyncController` `POST /api/sync/batch` con validación y límites |
| T009 | L | [backend] Endpoints de revisión para el admin |
| T010 | L | [POS] `OutboxSender`: lotes, backoff y estados |
| T011 | M | [POS] Intercepción de `POST /api/sales` y `/api/expenses` (desktop) |
| T012 | M | [POS] Stock mostrado = backend − pendientes (`stock-adjust`) |
| T013 | M | [POS] Endpoints locales del outbox |
| T014 | M | [POS] Importación de la cola vieja de `localStorage` |
| T015 | M | [POS] Cliente POS: `useSales`, `useExpenses`, `useOfflineQueue` |
| T016 | L | [POS] UI del POS: pendientes, revisión, MP offline y logout |
| T017 | L | [admin] Admin: pantalla "Ventas a revisar" |
| T018 | M | [admin] Admin: indicador, insignia en ventas y vistas a prueba de ítems sin producto |
| T019 | S | [admin] Admin: switch `mp_offline` en MercadoPago |
| T020 | L | [backend] Tests de integración del batch |
| T021 | L | [backend] Tests: revisión, asignación, migración, blindaje y `mp_offline` |
| T022 | L | [POS] Tests unit del POS (outbox) |
| T023 | L | [POS] Tests de integración del POS: outbox + backend falso + SQLite real |
| T024 | M | [POS] Tests de UI del POS |
| T025 | M | [admin] Tests del admin |
| T026 | L | [E2E] Smoke end-to-end local con los 3 repos |
| T027 | M | [E2E] Documentación de los tres repos |
| T028 | S | [E2E] Checklist manual, deuda técnica y preparación de los 3 PRs |

## Notas de alcance
- **No** incluye: fase 4 (sesión de dispositivo), tabla de sobreventas, anular/editar ventas, migración H2 → Railway, borrar `/pos` de `omero`, cifrado, piso de stock en el camino legado.
- Estimación gruesa: 8 a 12 jornadas de trabajo efectivo (backend ≈ 3–4, POS ≈ 4–5, admin ≈ 2, E2E/docs ≈ 1–2). Mayor riesgo de desvío: T003/T007/T021 (backend), T010/T016/T023 (POS) y T026.
