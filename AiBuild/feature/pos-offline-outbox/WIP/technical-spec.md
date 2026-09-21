# Technical Spec: Outbox de ventas y gastos offline (Fase 3)

## Metadata
- **Fecha:** 2026-09-21
- **Ramas:** `feature/pos-offline-outbox` en `omero-backend`, `omero-electron` y `omero` (cada una desde su `develop`, PR contra `develop`)
- **Basado en:** functional-spec.md
- **Estado:** WIP

## Resumen técnico
Tres entregas en orden, todas aditivas y compatibles hacia atrás:

1. **`omero-backend`** — migraciones (idempotencia `client_id`, revisión de ventas, snapshot en ítems, `product_id` opcional y `ON DELETE SET NULL`, clave `mp_offline`), endpoint por lotes `POST /api/sync/batch`, endpoints de revisión para el admin, blindaje de los consumidores que asumen `item.product != null`.
2. **`omero-electron`** (POS) — **outbox SQLite** durable en el Next local, intercepta `POST /api/sales` y `POST /api/expenses` en desktop, *sender* asíncrono con backoff, stock mostrado = backend − pendientes, caché de `mp_offline`, `ConnectionStatus` + lista de pendientes/revisión, migración de la cola vieja de `localStorage`.
3. **`omero`** (admin) — pantalla "Ventas a revisar" (ver detalle, marcar revisada, asignar producto) y switch `mp_offline`.

El POS **no cambia su contrato hacia el Next** (sigue haciendo `POST /api/sales`/`/api/expenses`); la intercepción ocurre en la capa de datos de la fase 2. En modo web nada se intercepta.

## Decisiones acordadas y cerradas en esta spec
| Tema | Decisión | Por qué |
|---|---|---|
| Partición | 1 spec, 3 PRs: backend → POS → admin | El backend es aditivo y se despliega antes; el POS nuevo depende del endpoint por lotes |
| Ítem con producto faltante | `sale_items.product_id` **opcional** + snapshot `product_code`/`product_name`; la venta se guarda **marcada como error/validación** con todos los datos disponibles y sin el id faltante | Pedido del usuario: registrar todo sin el id que falta, y que un admin decida |
| Borrado de producto | FK `sale_items.product_id` pasa de `ON DELETE CASCADE` a **`ON DELETE SET NULL`** y se rellena el snapshot de lo existente | Hoy borrar un producto **borra sus ítems de venta** (se pierde historia) |
| Asignar producto (admin) | Costo **vigente** del producto + descuenta stock (**piso 0**) + auditoría (quién/cuándo) | Decisión del usuario |
| Stock mostrado en el POS | `stock del backend − vendido pendiente` (piso 0) | Decisión del usuario |
| Contrato de sincronización | **Un solo endpoint** `POST /api/sync/batch` para ventas y gastos, con resultados por ítem | Conserva el orden relativo y una sola ida y vuelta |
| Backend sin el endpoint | El sender **pausa con aviso** (no cae al camino individual) | El camino individual no es idempotente: arriesgaría duplicar ventas |
| Outbox | Archivo SQLite **separado** de la caché (`<tenant>.outbox.sqlite`), `synchronous=FULL`, **no se borra al cerrar sesión** | Una venta confirmada no se puede perder |
| `mp_offline` | Clave de `business_config` (boolean, default `false`); switch en la página de MercadoPago del admin | No existe hoy una pantalla de configuración; MP es el lugar natural |

## Arquitectura y patrones

### Backend
- **Procesamiento por ítem en su propia transacción** (`SyncItemProcessor` con `@Transactional(REQUIRES_NEW)` invocado desde un servicio no transaccional): un ítem malo no aborta el lote y `DataIntegrityViolationException` por `client_id` duplicado se resuelve como `DUPLICATE`.
- **Reuso de `SaleService`:** se extrae la construcción/persistencia de la venta a un método compartido; `POST /api/sales` (legado) y el batch usan la misma lógica de total/efectivo/MP/impuesto MP, con dos diferencias en el camino batch: `createdAt` respetado y **stock con piso 0**.
- **Hibernate `@TenantId`:** el tenant sale del JWT; los índices únicos son `(tenant_id, client_id)`.

### POS (Next local)
```
POS ── POST /api/sales | /api/expenses ──► handleApiRequest
                                             │ runtime=web ─────────────────► proxy directo (sin cola)
                                             │ runtime=desktop
                                             ▼
                              outbox-proxy: tenant + outbox disponible?
                                 no ─► proxy directo (degradación)
                                 sí ─► INSERT en outbox (clientId, createdAt de la caja) ─► 201 inmediato al POS
                                             │
                                  OutboxSender.kick(tenant)  (async)
                                             │ POST /api/sync/batch (hasta 50 ítems, más viejo → más nuevo)
                                             ▼
                                 resultados por ítem → SENT | REVIEW | FAILED | (sigue PENDING si el fallo es de red/5xx)
```
- `web/src/lib/outbox/`: `outbox-store.ts` (SQLite), `outbox-proxy.ts` (intercepción), `outbox-sender.ts` (envío + backoff), `stock-adjust.ts` (stock − pendientes), `legacy-import.ts` (cola vieja).
- El sender reutiliza el `Authorization` en memoria del `CatalogSyncer` (fase 2) y su detección de recuperación de conexión.

### Admin
- Nueva ruta `admin/sales/review` (lista + modal de detalle) con el estilo de la conciliación de MP; contador en el menú/inicio; switch `mp_offline` en `admin/mercadopago`.

## Modelo de datos

### Backend — Flyway `V17__sales_outbox_review.sql` (aditiva)
```sql
-- Idempotencia
ALTER TABLE sales    ADD COLUMN client_id UUID;
ALTER TABLE expenses ADD COLUMN client_id UUID;
CREATE UNIQUE INDEX uq_sales_tenant_client    ON sales(tenant_id, client_id)    WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX uq_expenses_tenant_client ON expenses(tenant_id, client_id) WHERE client_id IS NOT NULL;

-- Trazabilidad y revisión de ventas
ALTER TABLE sales ADD COLUMN source            VARCHAR(20)  NOT NULL DEFAULT 'POS';     -- POS | POS_OFFLINE
ALTER TABLE sales ADD COLUMN source_user_id    UUID;                                    -- cajero que la creó (informativo)
ALTER TABLE sales ADD COLUMN review_status     VARCHAR(20)  NOT NULL DEFAULT 'NONE';    -- NONE | NEEDS_REVIEW | REVIEWED
ALTER TABLE sales ADD COLUMN review_reasons    TEXT;                                    -- JSON array de códigos
ALTER TABLE sales ADD COLUMN review_note       VARCHAR(500);
ALTER TABLE sales ADD COLUMN reviewed_by       UUID;
ALTER TABLE sales ADD COLUMN reviewed_at       TIMESTAMPTZ;
CREATE INDEX idx_sales_review ON sales(tenant_id, review_status) WHERE review_status = 'NEEDS_REVIEW';

-- Ítems: snapshot + producto opcional + auditoría de asignación
ALTER TABLE sale_items ADD COLUMN product_code VARCHAR(50);
ALTER TABLE sale_items ADD COLUMN product_name VARCHAR(255);
UPDATE sale_items si SET product_code = p.code, product_name = p.name FROM products p WHERE si.product_id = p.id;   -- snapshot retroactivo
ALTER TABLE sale_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE sale_items DROP CONSTRAINT fk_sale_item_product;
ALTER TABLE sale_items ADD CONSTRAINT fk_sale_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE sale_items ADD COLUMN assigned_by UUID;
ALTER TABLE sale_items ADD COLUMN assigned_at TIMESTAMPTZ;

-- Clave de negocio
INSERT INTO business_config_key (key, type, default_value, auto_provision) VALUES ('mp_offline', 'boolean', 'false', true);
```
- El `created_at` de `Sale`/`Expense` deja de sobrescribirse en `@PrePersist` cuando ya viene informado (`if (createdAt == null) createdAt = now`); `updatedAt` siempre = servidor.
- `getOne` de `BusinessConfigService` ya devuelve el default si el tenant no tiene fila: `mp_offline` funciona para tenants existentes sin migrar datos.
- **Nota:** `LocalSchemaMigrator` (perfil H2 legacy) no se toca: el desktop ya no usa el backend Java local.

### Ítem huérfano (semántica)
- `product == null` ⇒ el ítem conserva `product_code`, `product_name`, cantidad, precio unitario y total; `unit_cost = 0`; **no toca stock**.
- Motivos de revisión (`review_reasons`, array): `PRODUCT_NOT_FOUND`, `CREATED_AT_TOO_OLD`, `CREATED_AT_IN_FUTURE`. Un ítem huérfano se identifica por `product_id IS NULL` (no requiere columna extra).

### POS — outbox SQLite (`<OMERO_DATA_DIR>/<tenantId>.outbox.sqlite`)
`PRAGMA journal_mode=WAL; synchronous=FULL; busy_timeout=3000; user_version` + migraciones (mismo patrón de la fase 2).
```sql
CREATE TABLE outbox (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,      -- orden de envío
  client_id       TEXT    NOT NULL UNIQUE,                -- UUID v4
  type            TEXT    NOT NULL CHECK (type IN ('SALE','EXPENSE')),
  payload         TEXT    NOT NULL,                       -- JSON del request (sin costo)
  created_at      TEXT    NOT NULL,                       -- ISO UTC, hora de la caja
  status          TEXT    NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','SENT','REVIEW','FAILED')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  sent_at         TEXT,                                   -- cuándo el backend lo confirmó
  server_id       TEXT,                                   -- id de la venta/gasto creado
  review_json     TEXT,                                   -- reasons/detalle devueltos por el backend
  error           TEXT                                    -- motivo de REJECTED / fallo permanente
);
CREATE INDEX idx_outbox_status ON outbox(status, seq);
CREATE TABLE outbox_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- p. ej. legacy_imported
```
- `PENDING` = por enviar o reintentando; `SENT` = creado/duplicado en el backend (queda hasta 7 días para el ajuste de stock y la auditoría local, luego se purga); `REVIEW` = creado en el backend pero marcado; `FAILED` = rechazado por el backend (dato conservado, sin reintento).

### POS — caché del catálogo (fase 2), migración 2
```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, json TEXT NOT NULL, synced_at TEXT NOT NULL);  -- config de negocio (mp_offline)
```
`cache-policy` suma la ruta `GET /api/business/config/{key}` (solo claves alfanuméricas/`_`) como recurso `setting`.

## API / Contratos

### `POST /api/sync/batch` (nuevo, backend; autenticado; cualquier rol)
Request:
```json
{
  "items": [
    {
      "type": "SALE",
      "clientId": "5b2f0c5e-7c6e-4d6b-9e0a-3a1c2f8b7d11",
      "createdAt": "2026-09-21T14:03:11.402Z",
      "sourceUserId": "c19962d2-abd8-463d-b741-8eb89daf8846",
      "sale": {
        "items": [
          { "productId": "001", "productName": "Coca Cola 2L", "quantity": 2, "unitPrice": 1000, "total": 2000,
            "promotionId": null, "promotionName": null }
        ],
        "cashAmount": 2000, "mpAmount": 0, "change": 0
      }
    },
    { "type": "EXPENSE", "clientId": "…", "createdAt": "…",
      "expense": { "description": "Bolsas", "amount": 500, "type": "GENERAL", "businessId": null, "productId": null } }
  ]
}
```
Response `200` (siempre que el envelope sea válido; el resultado va por ítem):
```json
{ "success": true, "data": { "results": [
  { "clientId": "5b2f…", "status": "CREATED",   "entityId": "1234", "review": null },
  { "clientId": "7c1a…", "status": "CREATED",   "entityId": "1235",
    "review": { "status": "NEEDS_REVIEW", "reasons": ["PRODUCT_NOT_FOUND"], "items": [{ "productCode": "045", "problem": "PRODUCT_NOT_FOUND" }] } },
  { "clientId": "9d3e…", "status": "DUPLICATE", "entityId": "1200", "review": null },
  { "clientId": "aa10…", "status": "REJECTED",  "error": { "code": "VALIDATION", "message": "La venta no tiene ítems" } }
] } }
```
Reglas:
- **Límites:** `items` ≤ 100 y cuerpo ≤ 1 MB (si se excede → `400` con envelope de error; el POS envía lotes de 50). `type` solo `SALE` | `EXPENSE`. `clientId` debe ser UUID.
- **Orden:** los ítems se procesan en el orden recibido (el POS envía del más viejo al más nuevo).
- **`CREATED`:** guardado con `client_id`, `source = POS_OFFLINE`, `createdAt` de la caja (ver ventana) y `updatedAt` del servidor; costo del ítem = costo vigente del producto; **stock = `max(0, stock − qty)`**; `mpStatus = PENDING` si hay monto MP (con conciliación e impuesto MP como hoy).
- **`DUPLICATE`:** mismo `(tenant, clientId)` ya existente → devuelve el `entityId` existente; **no** duplica ni vuelve a descontar stock. Cubre la carrera de dos lotes simultáneos (violación de unicidad → se re-consulta).
- **`REJECTED`:** solo por validación irrecuperable (sin ítems, importes inválidos, `type` desconocido, gasto con monto ≤ 0) o `businessId` que no existe; **nunca** por producto faltante.
- **Ventana de fecha:** `now − 30 d ≤ createdAt ≤ now + 5 min`. Fuera de rango → `CREATED` con `review_reasons` `CREATED_AT_TOO_OLD` / `CREATED_AT_IN_FUTURE` y `review_status = NEEDS_REVIEW`.
- **Producto faltante** (código inexistente): el ítem se guarda con `product_id = NULL`, snapshot (`productCode`, `productName` recibido), `unit_cost = 0`, sin tocar stock; la venta queda `NEEDS_REVIEW` con `PRODUCT_NOT_FOUND`.
- **Errores inesperados de un ítem** (excepción no de validación): resultado `REJECTED` con `code = "INTERNAL_ERROR"` **y el POS lo trata como reintentable** (no lo marca `FAILED`).
- `sourceUserId` es informativo (debe pertenecer al tenant; si no, se ignora).

### Compatibilidad
- `POST /api/sales` y `POST /api/expenses` **no cambian** (se agregan campos opcionales `productName` en los ítems). Web y POS viejos siguen funcionando.
- Un POS nuevo contra un backend sin `/api/sync/batch` recibe `404`: el sender **pausa** (estado `backend_unsupported`, visible en el aviso) y reintenta con el backoff; jamás usa el camino individual.

### Revisión de ventas (backend; `ADMIN`)
| Método y ruta | Descripción |
|---|---|
| `GET /api/sales/review?status=NEEDS_REVIEW\|REVIEWED` | Lista con ítems completos (snapshot, producto si existe), pagos, fechas (`createdAt` caja / `updatedAt` recepción), motivos, nota, quién/cuándo revisó |
| `GET /api/sales/review/count` | `{ needsReview: n }` para el indicador del admin |
| `POST /api/sales/{id}/review` `{ note }` | Marca `REVIEWED` (nota ≤ 500). Permitido con ítems huérfanos pendientes (decisión del admin). Idempotente |
| `POST /api/sales/{id}/items/{itemId}/assign-product` `{ productCode }` | Solo si el ítem tiene `product_id IS NULL`. Asigna el producto, `unit_cost` = costo vigente, **stock = `max(0, stock − qty)`**, `assigned_by/at`; el snapshot original se conserva. `404` si el producto no existe; `409` si el ítem ya tiene producto |
Todas registran `updatedBy/updatedAt` por el auditing existente y validan que la venta pertenezca al tenant (filtro `@TenantId`).

### Config
`GET /api/business/config/mp_offline` (ya existente; lo lee el POS) y `PUT /api/business/config/mp_offline` (`ADMIN`; ya existente) con `value = "true"|"false"`.

### Endpoints locales del POS (Next)
- `POST /api/sales` y `POST /api/expenses` (interceptados en desktop) → `201`:
  ```json
  { "success": true, "data": { "id": null, "clientId": "…", "queued": true, "createdAt": "…", "total": 2000, "items": [ … ] } }
  ```
  (`queued: true`; el POS ya no necesita saber si hubo conexión.)
- `GET /api/_local/outbox` → `{ counts: { pending, review, failed, sent }, backend: "ok"|"unsupported"|"unauthorized"|"offline", nextAttemptAt, items: [ { clientId, type, status, createdAt, attempts, error, review, summary } ] }` (paginado; sin `payload` completo salvo `?detail=<clientId>`).
- `POST /api/_local/outbox/import` `{ items: [ legacy queue items ] }` → importa la cola vieja de `localStorage` (idempotente por marca `legacy_imported` y por `id` viejo → `clientId` derivado).
- `POST /api/_local/outbox/{clientId}/dismiss` → oculta un ítem `FAILED` ya visto (no lo borra; queda auditable localmente 30 días).
- `GET /api/_local/connectivity` (fase 2) suma `outbox: { pending, review, failed }` para el header.

## Sender (POS) — algoritmo
1. **Disparadores:** alta de un ítem (`kick`), recuperación de conexión (sondeo del syncer), reanudación tras un login (nuevo token en memoria), y el timer del backoff.
2. **Un lote a la vez por tenant:** toma hasta 50 ítems `PENDING` por `seq` ascendente y hace `POST /api/sync/batch` con timeout de 30 s y el `Authorization` en memoria.
3. **Resultados por ítem:** `CREATED`/`DUPLICATE` → `SENT` (`server_id`, `sent_at`); `CREATED` con `review` → `REVIEW`; `REJECTED` (≠ `INTERNAL_ERROR`) → `FAILED` con `error`; `INTERNAL_ERROR` → sigue `PENDING`.
4. **Fallos de transporte** (red, timeout, 502/503/504, 5xx, 404 del endpoint, respuesta inválida): los ítems siguen `PENDING`, `attempts++`; se agenda el próximo intento con la secuencia **30 s → 90 s → 270 s → 810 s → 810 s …** según los fallos consecutivos del tenant (un lote exitoso reinicia la secuencia).
5. **401/403:** detiene el envío del tenant, olvida el token y marca `backend: "unauthorized"` (los ítems siguen `PENDING`); se reanuda cuando llegue un `Authorization` nuevo (login).
6. **Si el lote fue exitoso y quedan ítems `PENDING`:** continúa de inmediato con el siguiente lote.
7. **Purga:** `SENT` con más de 7 días y `FAILED` descartados con más de 30 días.
8. **Durabilidad:** el `INSERT` en el outbox se confirma (`synchronous=FULL`) **antes** de responder `201` al POS.

## Stock mostrado (POS)
`adjustStock(list, outbox)` se aplica a las respuestas de `GET /api/products` y `GET /api/products/{code}` (tanto la respuesta online como la servida desde caché):
- Se suman las cantidades de ítems de venta de las filas del outbox que **aún no están reflejadas en el snapshot**: `status = PENDING` o `(status ∈ SENT, REVIEW y sent_at > products.last_sync_at − 2 s)`.
- `stock_mostrado = max(0, stock − pendiente)` por código de producto (el código `000` no se ajusta).
- Camino rápido: si no hay filas activas no se parsea el JSON. Los precios no se tocan.

## Cambios en el POS (cliente)
- **`useSales`:** en desktop deja de reintentar/encolar (el Next confirma al instante); en **web** se elimina el encolado en `localStorage` (un intento; si falla, error) y los ítems viejos de la cola se envían **una última vez** con el flush existente. Los items agregan `productName` (nombre del `CartItem`).
- **`useExpenses`:** sin cambios de contrato; en desktop el Next lo encola.
- **`useOfflineQueue`:** en desktop su contador se reemplaza por el del outbox; se conserva la importación de la cola vieja (`POST /api/_local/outbox/import`) al montar y la limpieza posterior.
- **`ConnectionStatus`:** el chip "N pendientes sin sync" usa `outbox.pending`; nuevo chip/enlace "N para revisar" (`review + failed`) que abre un `Modal` con la lista (estado, fecha, resumen, motivo); botón **Actualizar** sigue solo verificando conexión.
- **MercadoPago offline:** `useBusinessConfig('mp_offline')` (lectura por `/api/business/config/mp_offline`, cacheada). En `PaymentModal`: si `!online && !mpOffline` el botón MP queda deshabilitado con mensaje ("Sin conexión: el pago con MercadoPago está desactivado"); con `mpOffline` se permite.
- **Logout con pendientes:** `AuthContext.logout` consulta el conteo del outbox y muestra el aviso (no lo borra; solo se borra la caché del catálogo, como en fase 2).

## Cambios en el admin (`omero`)
- `admin/sales/review/page.tsx`: lista con contador y filtros (Requieren revisión / Revisadas), tarjeta por venta y **modal de detalle** (todos los ítems con snapshot y si tienen producto, pagos, fechas caja/recepción, motivos, nota, auditoría). Acciones: **Marcar revisada** (nota) y **Asignar producto** (buscador por código/nombre → `assign-product`).
- Indicador de "N ventas a revisar" en `HomeNavCards`/`navConfig` (usa `GET /api/sales/review/count`).
- `admin/mercadopago/page.tsx`: switch "Permitir pagos MercadoPago sin conexión (mp_offline)".
- `admin/sales/page.tsx`: las ventas `NEEDS_REVIEW` muestran una insignia con enlace a la revisión; los ítems sin producto muestran el snapshot (no rompen la vista).

## Blindaje del backend ante `item.product == null`
Sitios que asumen producto no nulo (verificados con `grep`): `SaleItemResponseDto` (código/nombre), `DashboardService` (≈10: categoría y `productKey`/nombre), `StatsService` (4: categoría), `ReportService` (costo), `PromotionService` (`.getProduct()` de ítems de venta).
- Se agrega en `SaleItem` los helpers `displayCode()`, `displayName()` (snapshot) y `categoryOrUnassigned()` que devuelve una **categoría/negocio sintéticos "Sin identificar"** (constante) en lugar de `null`; los consumidores dejan de llamar `item.getProduct()...` directamente.
- Ganancia/costo de un ítem huérfano usa `unit_cost = 0`; se muestra bajo "Sin identificar" en los reportes (las ventas cuentan en los totales).
- **Prueba obligatoria:** un test de integración crea una venta con un ítem huérfano y llama a **cada** endpoint de ventas/dashboard/stats/reportes verificando `200` y que el ítem aparece en el bucket "Sin identificar".

## Dependencias
| Repo | Cambio | Detalle |
|---|---|---|
| omero-backend | Ninguna nueva | Spring Boot/JPA/Flyway existentes; se agregan clases y migración |
| omero-electron | Ninguna nueva | Reutiliza `better-sqlite3` (fase 2); UUID con `crypto.randomUUID()` |
| omero | Ninguna nueva | Componentes de UI existentes |

## Performance
- Lote de 50 ítems: cada uno en su transacción corta (≈ ms); índices únicos parciales por `(tenant_id, client_id)` y parcial `review_status = 'NEEDS_REVIEW'` para el contador.
- `product_code`/`product_name` se copian en la creación (sin joins extra para el detalle).
- Ajuste de stock del POS: `O(pendientes)` y solo si hay pendientes; una consulta agregada por código.
- El outbox usa `synchronous=FULL` (durabilidad); son pocas escrituras por venta, sin impacto perceptible.
- Backoff limita el tráfico ante caídas largas (1 lote cada 13,5 min como mínimo).

## Seguridad
- Tenant siempre del JWT en el backend (`@TenantId`); el `tenantId` local del POS solo elige el archivo (UUID validado, como en fase 2). **Un ítem del outbox de un tenant nunca se envía con la sesión de otro**: el sender exige que el `Authorization` en memoria pertenezca al tenant del archivo.
- Validación estricta del batch: tamaños, `type`, UUID, fechas, importes; `sourceUserId` se verifica contra el tenant. El backend no confía en costos ni stock enviados (no se aceptan).
- Los endpoints de revisión y la asignación de producto son `@PreAuthorize("hasRole('ADMIN')")`; el batch acepta cualquier usuario autenticado del tenant (es lo que ya puede crear ventas).
- El `Authorization` sigue solo en memoria; el outbox guarda datos de negocio (ventas/gastos) sin credenciales; los logs no incluyen el token ni el payload completo.
- Sin cifrado de la base (fuera de alcance, igual que la caché).

## Testing plan (`tests_required = true`; Unit + Integration en los 3 repos)

### Backend (JUnit + Testcontainers, `BaseIntegrationTest`)
- **Batch:** `CREATED` crea venta con `client_id`, `createdAt` de la caja y `updatedAt` del servidor; `DUPLICATE` (mismo `clientId`) no duplica ni vuelve a descontar stock; carrera de dos lotes concurrentes con el mismo `clientId`; lote mixto (bueno + malo + duplicado) procesa el resto; `REJECTED` por validación; `INTERNAL_ERROR` reintentable; límites de tamaño; `type` inválido.
- **Reglas:** stock nunca negativo (piso 0) en el batch y `POST /api/sales` legado **sin cambios**; costo vigente al recibir; MP offline → `mpStatus = PENDING` + impuesto MP; gasto con `client_id`.
- **Fechas:** dentro de ventana se conserva; > 30 días y > 5 min a futuro → `NEEDS_REVIEW` con motivo.
- **Producto faltante:** guarda ítem sin producto con snapshot, no toca stock, venta `NEEDS_REVIEW`; el resto de ítems descuenta stock.
- **Revisión:** listar/contar, marcar revisada (idempotente, permisos `ADMIN`, cross-tenant 404), asignar producto (costo vigente, stock con piso 0, auditoría, `409` si ya tiene producto, `404` si no existe).
- **Migración:** `V17` sobre datos existentes rellena el snapshot; borrar un producto ya **no borra** el ítem (queda con `product_id NULL`); `mp_offline` legible por tenants existentes.
- **Blindaje:** test de ítem huérfano contra todos los endpoints de ventas/dashboard/stats/reportes (200 + bucket "Sin identificar").
- Compatibilidad: `POST /api/sales` y `POST /api/expenses` siguen pasando los tests existentes.

### POS (vitest)
- **Unit:** `outbox-store` (esquema, migraciones, orden por `seq`, unicidad `client_id`, transiciones de estado, purga, durabilidad `synchronous=FULL`), backoff (30/90/270/810/810…, reinicio tras éxito), `stock-adjust` (pendiente vs reflejado por `last_sync_at`, piso 0, código `000`), `legacy-import` (idempotencia y mapeo de tenant), política de cache de `settings`.
- **Integración** (backend falso + SQLite real + `handleApiRequest`): intercepción de `POST /api/sales`/`/api/expenses` (201 inmediato y fila en el outbox); envío exitoso; duplicado; resultado mixto; fallo de red y 5xx → reintento según backoff; `401` detiene y se reanuda con nuevo token; `404` del endpoint → `backend_unsupported`; reinicio con pendientes; tenant A no envía con token de B; modo web no intercepta ni crea outbox; degradación sin outbox → proxy directo; stock mostrado `backend − pendientes`.
- **UI (Testing Library):** `ConnectionStatus` con `outbox`, lista de revisión, botón MP deshabilitado offline sin `mp_offline`, aviso al cerrar sesión con pendientes, `useSales` sin encolado en web, importación de la cola vieja.

### Admin (vitest)
- Lista de revisión, modal de detalle, marcar revisada, asignar producto (éxito/errores), contador, switch `mp_offline`.

### Verificación manual / smoke (en el plan)
Smoke E2E local con `omero-start/dev.sh` (backend `devdata`) + gateway intermitente: venta offline → sube al volver; timeout con éxito → sin duplicado; producto eliminado → aparece en el admin; asignar producto; MP offline; reinicio de Electron con pendientes.

## Explorado y descartado
| Alternativa | Por qué se descarta |
|---|---|
| Placeholder "producto no identificado" por tenant | Hay que aprovisionarlo en cada tenant, ocultarlo de listas y protegerlo; los reportes pierden el nombre original |
| Filtrar ítems huérfanos de dashboards/stats | Los ingresos de esas ventas dejarían de contar |
| Dos endpoints (`/api/sales/batch` y `/api/expenses/batch`) | Se pierde el orden relativo y duplica lógica; uno solo es más simple |
| Fallback al `POST /api/sales` individual si falta el batch | No es idempotente: puede duplicar ventas ante un timeout con éxito |
| Outbox en `localStorage` del navegador | No es durable ante limpiezas, sin transacciones ni consultas; ya es la fuente del problema actual |
| Outbox en el mismo archivo que la caché | El logout borra la caché; el outbox debe sobrevivir |
| Idempotencia por hash del contenido | Dos ventas iguales legítimas se confundirían; el `clientId` es explícito |
| Mantener `ON DELETE CASCADE` | Sigue perdiendo historia de ventas al borrar productos |
| Aplicar el piso de stock también en `POST /api/sales` legado | Cambiaría silenciosamente el comportamiento del modo web; queda como deuda opcional |
| Editar `mp_offline` en una pantalla de configuración nueva | No existe hoy; la página de MercadoPago es el lugar natural |
| Backoff por ítem | Complica; con red caída todos fallan igual; el backoff por tenant es suficiente |

## Riesgos y mitigaciones
| Riesgo | Prob. | Mitigación |
|---|---|---|
| NPE por `item.product == null` en reportes/dashboard/DTO | Alta | Helpers `displayCode/displayName/categoryOrUnassigned` + test de integración contra todos los endpoints |
| Migración `V17` sobre producción (backfill + cambio de FK) | Media | Aditiva y reversible por fases; se prueba con datos sembrados; backfill en una sola sentencia indexada; desplegar backend antes que el POS |
| POS nuevo contra backend viejo | Media | El sender pausa con estado visible (`backend_unsupported`); orden de despliegue documentado |
| Doble descuento de stock local (pendiente + snapshot) | Media | Regla por `sent_at` vs `last_sync_at` + tests de la ventana; margen de 2 s |
| Pérdida de una venta ante corte de luz | Baja | `synchronous=FULL` y confirmación antes de responder 201 |
| JWT de 1 h impide subir pendientes fuera de sesión | Alta (conocida) | Se reanuda al iniciar sesión; el outbox persiste; lo resuelve la fase 4 |
| Reloj desajustado en la caja | Media | Ventana de fechas + marca para revisión (no se rechaza) |
| Ítems `FAILED` acumulados | Baja | Lista en el POS con motivo y `dismiss`; purga a 30 días |
| Borrado en cascada preexistente ya perdió historia antiguo | — | Fuera de alcance recuperar lo perdido; el snapshot retroactivo cubre lo existente |
| Tres repos desincronizados en el contrato | Media | Contrato único en esta spec; tests de contrato en backend y backend falso en POS con el mismo JSON |

## Orden de entrega y despliegue
1. **Backend** (`omero-backend`): migración + batch + revisión + blindaje + tests → PR contra `develop` → **deploy a Railway primero**.
2. **POS** (`omero-electron`): outbox + sender + UI + tests → PR contra `develop`.
3. **Admin** (`omero`): revisión + switch + tests → PR contra `develop`; requiere el backend desplegado.
`master` no se toca en ninguno.

## Deuda y notas fuera de alcance
- El piso de stock en 0 solo aplica al camino batch/asignación; `POST /api/sales` legado (web) puede seguir dejando stock negativo.
- La tabla de sobreventas queda como idea futura.
- La historia de ventas **ya perdida** por el `ON DELETE CASCADE` anterior no se recupera.

---

## Addendum — decisiones tomadas durante el build (2026-09-21)

Lo construido coincide con el contrato de arriba salvo lo siguiente (la implementación manda; esto es lo que hay que saber):

**Backend**
- `SyncItemProcessor` usa `TransactionTemplate` (`REQUIRES_NEW`) y **no** `@Transactional`: con la anotación, el `catch` que traduce la excepción a `REJECTED` quedaba dentro de la transacción y el commit fallaba con `UnexpectedRollbackException`.
- `Sale.createdAt` se respeta si viene seteado (`@PrePersist`); `updatedAt` es siempre del servidor. El impuesto de MP de una venta offline usa la hora de la venta (`ExpenseService.createMercadoPagoTax(saleId, amount, createdAt)`).
- Gasto: `productId` inexistente se ignora (el gasto no tiene campos de revisión); `createdAt` futuro (> +5 min) se acota a "ahora"; `businessId` inexistente → `REJECTED/VALIDATION`.
- `sourceUserId` se valida contra el tenant (`users.findById(...)` con `tenantId` igual al actual); si no, se ignora.
- El contador de revisión (`ReviewCountDto.needsReview`) es `int`: `JacksonConfig` serializa los `Long` como **string** (también `productId` en los DTO de revisión).
- **Agregado no previsto**: las claves `business_config` de tipo `boolean` ahora validan `true`/`false` en `PUT` (`mp_offline = "quizas"` se aceptaba y se leía como apagado).

**POS**
- El outbox tiene además las columnas `source_user_id` y `dismissed_at`; retención: `SENT` 7 d, `REVIEW` y `FAILED` descartados 30 d.
- `GET /api/_local/outbox` en web/sin outbox responde **200 `{available:false, …}`** (no 204) para simplificar el cliente.
- `rememberSession()` (`outbox-runtime.ts`) crea el sender antes de registrar el token. Sin esto, tras reiniciar la caja con pendientes no subían hasta hacer una venta nueva (hallado en el smoke E2E).
- El syncer publica eventos (`online`, `authorization`) y expone `getAuthorization(tenantId)`; el sender se suscribe (`getSender()` / `resetSender()` para tests).
- `413` del backend parte el lote a la mitad sin castigar con backoff; un `404` se trata como fallo de transporte con estado `unsupported` (sigue reintentando: el backend puede desplegarse después).
- `useSales` ya no reintenta ni encola; `useOfflineQueue` quedó solo como migrador de la cola vieja. Se eliminaron `withAsyncRetry`, `isRetryable` y `FlushLock`-para-escritura (sin consumidores).
- El bloqueo del botón MP offline se decide en `page.tsx` (`mpBlocked = desktop && !online && !mp_offline`), que también protege la tecla `1`.

**Admin**
- El detalle de la revisión se deriva de la lista (se recarga tras cada acción); el picker de producto filtra en el cliente sobre `GET /api/products` (excluye el código `000`).

**Verificación**: backend 122 tests; POS 526 tests (`lib/outbox/**` ≥ 90 %); admin 163 tests; smoke E2E local 34/34 (ver `manual-checklist.md`).
