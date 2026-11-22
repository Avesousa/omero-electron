# Spec técnico: Apertura y cierre de caja

## Metadata
- **Rama:** `feature/caja-apertura-cierre` en los 3 repos · worktrees `omeroShop/.wt/caja-{backend,admin,pos}`
- **Base:** `origin/develop` (backend `dda69b3`, admin `5d80f37`, POS `1b050a6`)
- **Migración:** **V43** (develop ya tiene V42 `products_stock_version`)
- **Orden de despliegue:** backend → admin → POS
- **Spec funcional:** `functional-spec.md` (mismas reglas R1–R13)

## 1. Decisiones de diseño

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| D1 | `cash_sessions.id` es un **UUID generado en el POS** | id del servidor | La caja se abre offline; el mismo UUID sirve de idempotencia en el outbox (patrón `client_id`). |
| D2 | Dispositivo = `terminal_key` UUID (desktop: `client_device_id` de `devices`; web: UUID guardado en `localStorage` `omero_terminal_id`) + `device_id` FK opcional | Exigir `devices` | El POS web no registra caja (no hay `device` en el login web). |
| D3 | Asiento por cierre **guardado** (`cash_closings`) con snapshot de cifras del sistema; asiento diario **calculado** por consulta agrupada | Tabla de asiento diario materializada | Las vistas por dispositivo/usuario/caja salen de la misma consulta; una corrección solo recalcula su cierre. |
| D4 | Las cifras del sistema (ventas por medio, cobros, salidas previas) se **recalculan en el backend al confirmar** y en cada corrección; el POS manda solo lo que carga el cajero | Confiar en los números del POS | Offline el POS puede no ver todo; el backend es la fuente de verdad. El POS guarda su estimación (`pos_expected_cash`) para auditoría. |
| D5 | Corte por **`cash_session_id` en cada movimiento**, no por timestamp | Corte por rango de fechas | Una caja puede durar días y convivir con otra en otro dispositivo. |
| D6 | Feature flag `cash_control_enabled` (business_config, default `false`) | Siempre activo | Compatibilidad con el cliente actual. |
| D7 | Venta sin caja con el flag activo → **caja automática diaria** por usuario (`kind=AUTO_DAILY`), creada por el backend | Rechazar la venta | El outbox nunca rechaza ventas; POS viejos siguen funcionando. |
| D8 | Backfill histórico al activar el flag: **job idempotente** que crea cajas `LEGACY_DAILY` CERRADAS sin arqueo por (día, usuario) y asigna las ventas/gastos/cobros sin caja | Migración SQL | Depende de cuándo cada tenant active el flag; corre por tenant con `TenantContext.runAs`. Al reactivar, el mismo job completa solo los días sin caja (idempotente por día+usuario). |
| D9 | **Desactivar no borra ni migra nada.** Con el flag en `false`: el backend deja de aplicar D7 (venta sin caja queda sin caja), los endpoints del POS de caja responden 409 `CASH_CONTROL_DISABLED`, los de lectura del admin siguen funcionando | Cerrar automáticamente las cajas abiertas | Los datos son historial; el admin decide cómo cerrar lo que quedó abierto (marcado "Control desactivado" en la respuesta: `controlEnabled=false`). |
| D10 | Ventas y gastos del asiento se agrupan por **grupo de medio de pago** derivado del `kind`: `CASH`→EFECTIVO, `MERCADOPAGO`→TRANSFERENCIA, `CREDIT`→CREDITO, `CUSTOM`→OTROS | Una columna por medio | Columnas fijas y comparables entre días; el detalle por medio se conserva en `cash_closing_breakdown`. Un mapeo configurable por medio queda para después. |

## 2. Modelo de datos (V43)

Todas las tablas nuevas con `tenant_id UUID NOT NULL` + FK + índice y `@TenantId` en la entidad.

### `cash_sessions`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | Generado en el POS (D1) |
| `tenant_id` | UUID | |
| `terminal_key` | UUID NOT NULL | D2 |
| `device_id` | UUID NULL FK `devices` | Solo desktop |
| `terminal_kind` | VARCHAR(10) | `DESKTOP` \| `WEB` |
| `terminal_label` | VARCHAR(80) | Nombre visible (desktop: nombre de la caja; web: editable) |
| `user_id` | UUID NOT NULL FK `users` | |
| `kind` | VARCHAR(15) | `MANUAL` \| `AUTO` (abierta por escaneo) \| `AUTO_DAILY` (D7) \| `LEGACY_DAILY` (D8) |
| `status` | VARCHAR(10) | `OPEN` \| `CLOSING` \| `CLOSED` |
| `opened_at` | TIMESTAMPTZ | Hora del POS |
| `opening_amount` | NUMERIC(14,2) NULL | NULL = "a definir" (cierre previo pendiente) |
| `opening_source` | VARCHAR(10) | `PREVIOUS` \| `MANUAL` |
| `previous_session_id` | UUID NULL FK self | Cadena del fondo |
| `cut_at` | TIMESTAMPTZ NULL | Corte (inicio del cierre) |
| `closed_at` | TIMESTAMPTZ NULL | |
| `accounting_date` | DATE NULL | Fecha del cierre en la zona del tenant |
| `client_updated_at`, `created_at`, `updated_at` | TIMESTAMPTZ | |

Índices: `(tenant_id, terminal_key, user_id, status)`, `(tenant_id, accounting_date)`, **único parcial** `(tenant_id, terminal_key, user_id) WHERE status = 'CLOSING'` (R3: un solo cierre pendiente) y `WHERE status = 'OPEN'` (una sola abierta).

### `cash_closings` (asiento por cierre, 1:1 con la sesión)
`session_id` PK/FK · `counted_cash` · `expected_cash` (backend) · `pos_expected_cash` (estimación del POS) · `difference` · `cashier_note` VARCHAR(500) · `opening_amount` (snapshot) · `sales_total` · `sales_cash` · `sales_transfer` · `sales_credit` · `sales_other` · `expenses_cash` · `expenses_transfer` · `expenses_credit` · `expenses_other` · `credit_collections_cash` · `credit_collections_total` · `purchases_cash` · `withdrawals_total` · `remaining` · `blind_count` BOOLEAN · **revisión:** `review_status` `NONE` \| `PENDING` \| `REVIEWED`, `review_trigger` `SHORTAGE` \| `SURPLUS` NULL, `threshold_applied` NUMERIC NULL (snapshot del umbral usado), `review_note` VARCHAR(500), `reviewed_by`, `reviewed_at` · `closed_by` · `client_id` UUID (idempotencia) · `created_at` · `updated_at`.
- Las columnas por grupo son **denormalizadas** a propósito (D10): el asiento diario sale con un `SUM` simple. Se recalculan junto con el detalle en cada confirmación/corrección.
- `review_status=PENDING` solo si al confirmar `cash_difference_check_enabled=true` y la diferencia supera el umbral del signo correspondiente (umbral NULL = ese signo no se controla). Una corrección del admin **no** reabre la revisión (decisión manual).

### `cash_closing_breakdown`
Detalle por medio de pago: `session_id`, `concept` `SALE` \| `EXPENSE` \| `CREDIT_COLLECTION`, `payment_method_id` (NULL = efectivo en gastos viejos), `pm_group` `CASH` \| `TRANSFER` \| `CREDIT` \| `OTHER`, `name` (snapshot), `amount`. PK `(session_id, concept, coalesce(payment_method_id))` vía índice único.

### `cash_movements`
Lo que se carga en el cierre (y las compras con caja durante la sesión):
`id` UUID · `session_id` · `type` `EXPENSE` \| `PURCHASE` \| `WITHDRAWAL` · `phase` `DURING` \| `CLOSING` · `amount` · `payment_method_id` NULL (NULL = efectivo) · `description` · `expense_id` NULL FK · `withdrawal_kind` `HOME` \| `SET_ASIDE` · `set_aside_rule_id` NULL FK · `suggested_amount` NULL · `created_at`.
- Un gasto al cierre crea también un `Expense` normal (con `cash_session_id` y `payment_method_id`), así los reportes de gastos no cambian.

### `cash_purchase_allocations` (R8)
`id` · `movement_id` FK (`type=PURCHASE`) · `purchase_id` FK · `amount` · `created_at/by`. Monto disponible del movimiento = `amount − Σ allocations`. Alerta en Compras = movimientos con saldo > 0.

### `cash_set_aside_rules` (R9)
`id` UUID · `name` · `scope` `BUSINESS` \| `CATEGORY` · `business_id` / `category_id` (validados por repositorio, tenant-filtered) · `base` `SALE_TOTAL` \| `COST` \| `PERCENT_OF_SALE` · `percent` NUMERIC(7,4) NULL · `show_in_summary` · `active` · `sort_order`.

### `cash_closing_audit` (R13)
`id` · `session_id` · `changed_by` · `changed_at` · `reason` · `before_json` · `after_json`.

### Columnas nuevas en tablas existentes
- `sales.cash_session_id`, `expenses.cash_session_id`, `credit_payments.cash_session_id` — UUID NULL FK + índice `(tenant_id, cash_session_id)`.
- `expenses.payment_method_id` UUID NULL FK `payment_methods` (NULL = efectivo, compatible con lo existente).
- `purchases.money_source` VARCHAR(10) NOT NULL DEFAULT `'OTHER'` (`CASH_REGISTER` \| `OTHER`) + `purchases.cash_session_id` NULL.

### `business_config_key` (seed en V43, `auto_provision=true`)
`cash_control_enabled` boolean `false` · `cash_show_expected` boolean `true` · `cash_difference_check_enabled` boolean `false` · `cash_shortage_threshold` number vacío · `cash_surplus_threshold` number vacío · `cash_open_warning_hours` number `24` · `cash_home_label` string `Casa`.
- Umbral vacío = ese signo no se controla; `0` = cualquier diferencia de ese signo. Regla: `shortage = max(0, −difference)`, revisa si `shortage > shortage_threshold`; ídem sobrante.
(Agregar validación `number` en `BusinessConfigService`: hoy solo valida `boolean`.)

## 3. Backend (`omero-backend`)

### Paquete `cashregister/` (o `service/cash*` siguiendo el layout actual)
- **`CashSessionService`** (NO `@Transactional` de clase; `TransactionTemplate` por operación, como `InternalPurchaseService`):
  - `open(cmd)`: idempotente por `id`; valida que no haya otra `OPEN` para (terminal, usuario) → si existe, la devuelve (la apertura automática de dos pestañas no duplica). Calcula `opening_amount` = `remaining` del último `CLOSED` de (terminal, usuario); si el último está `CLOSING`, queda NULL.
  - `startClosing(id, cutAt)`: `OPEN → CLOSING`; 409 `CASH_CLOSING_PENDING` si ya hay un cierre pendiente para (terminal, usuario).
  - `confirmClosing(id, cmd)`: `CLOSING → CLOSED`; recalcula cifras (`CashMath`), persiste `cash_closings`, `cash_closing_payments`, `cash_movements`, gastos al cierre; fija `accounting_date`; completa el `opening_amount` NULL de la sesión siguiente. Idempotente por `client_id`.
  - `correct(id, cmd)` (admin): recalcula, audita, propaga el restante a la siguiente sesión si cambió.
  - `resolveForSale(...)`: D7.
- **`CashMath`** (puro, sin Spring, con `CashMathTest` y los casos de R5/R6 como fixtures JSON compartidos con el POS: `src/test/resources/cash-cases.json` ↔ `web/src/lib/cash/__fixtures__/cash-cases.json`): esperado, diferencia, restante, identidad del asiento.
- **`CashSetAsideCalculator`**: sugerido por regla con HQL agrupado sobre `sale_items` de la sesión (usa `ITEM_REVENUE`/`LINE_COST_SUM` de `ReportAggregationRepository` para respetar crédito y huérfanos).
- **`CashSummaryService`**: resumen de una sesión (reemplaza `daily-summary` en el POS con el flag activo): ventas por medio, cobros, gastos, compras, sugeridos, esperado (oculto si `cash_show_expected=false` y no tiene `CAJAS_VER`).
- **`CashLedgerService`**: asiento diario agregado (`GROUP BY accounting_date[, terminal_key | user_id | session_id]`), restante solo si la agrupación no es general.
- **`CashBackfillJob`**: D8, idempotente, por tenant al activar el flag (listener del PUT de `cash_control_enabled`) y reintentable desde el admin.

### Endpoints
| Método y ruta | Permiso | Notas |
|---|---|---|
| `POST /api/cash-sessions` | `POS_CAJA_ABRIR` | `{id, terminalKey, terminalKind, terminalLabel, openedAt, openingAmount?, kind}` |
| `GET /api/cash-sessions/current?terminalKey=` | `POS_CAJA_ABRIR` | Abierta + cierre pendiente del usuario en esa terminal |
| `GET /api/cash-sessions/{id}/summary` | `POS_RESUMEN_VER` | Resumen de la caja (TAB) |
| `POST /api/cash-sessions/{id}/closing/start` | `POS_CAJA_CERRAR` | `{cutAt}` |
| `POST /api/cash-sessions/{id}/closing` | `POS_CAJA_CERRAR` | `{clientId, countedCash, posExpectedCash, movements[], differenceReason?}` |
| `GET /api/cash-sessions` | `CAJAS_VER` | Filtros: `terminalKey`, `userId`, `status`, `from`, `to`, `limit/before` |
| `GET /api/cash-sessions/{id}` | `CAJAS_VER` | Detalle + movimientos + auditoría |
| `PUT /api/cash-sessions/{id}/closing` | `CAJAS_CORREGIR` | Corrección (R13); también cierra una `OPEN/CLOSING` desde el admin (incluso con el control desactivado) |
| `GET /api/cash-sessions/review?status=PENDING\|REVIEWED` y `/review/count` | `CAJAS_VER` | Cierres a revisar (R12) |
| `POST /api/cash-sessions/{id}/review` | `CAJAS_REVISAR` | `{note}` obligatoria ≤500; idempotente; 409 `CASH_REVIEW_NOT_PENDING` si no está pendiente |
| `GET /api/cash-ledger?groupBy=GENERAL\|TERMINAL\|USER\|SESSION&from&to` | `CAJAS_VER` | Asiento diario |
| `GET /api/cash-ledger/export?...` | `CAJAS_VER` | CSV |
| `GET/POST/PUT/DELETE /api/cash-set-aside-rules` | ver: `CAJAS_VER`, editar: `CONFIG_NEGOCIO_EDITAR` | El POS lee con `POS_CAJA_CERRAR` |
| `GET /api/cash-movements/unallocated-purchases` | `COMPRAS_VER` | Alerta de Compras |
| `POST /api/purchases` (existente) | `COMPRAS_CREAR` | Suma `moneySource`, `cashSessionId?`, `cashAllocations:[{movementId, amount}]` (409 `CASH_ALLOCATION_EXCEEDS` si supera el disponible) |
| `GET /api/terminals` / `PATCH /api/terminals/{key}` | `CAJAS_VER` / `CAJAS_CORREGIR` | Terminales web + desktop con caja actual y pendientes (para Configuración → Cajas) |

- **Dashboard/estadísticas:** `overview`, `stats`, `daily-series`, `/stats/sales`, `/sales`, `/sales/summary` suman `cashSessionIds` (lista, opcional). Con el filtro, `ReportAggregationRepository` agrega `and s.cashSessionId in :ids`. Sin el filtro, no cambia nada (los goldens de `DashboardStatsCharacterizationTest` no se regraban).
- **Ventas/gastos/cobros:** `POST /api/sales`, `/api/expenses`, `/api/credit/collect` aceptan `cashSessionId` opcional (validado contra el tenant: 404 si es de otro); `ExpenseRequest` suma `paymentMethodId?`.
- **`DeviceScopeFilter`:** agregar a la lista blanca `pos` las rutas `POS_CAJA_*` y `GET /api/cash-sessions/{id}/summary`, `GET /api/cash-set-aside-rules` (y el test de contrato `allowlist.contract.test.ts` del POS).

### Outbox (`/api/sync/batch`)
- `SALE`, `EXPENSE`, `CREDIT_COLLECTION` suman `cashSessionId`.
- Tipos nuevos procesados en orden de `createdAt` (ya es la regla): `CASH_SESSION_OPEN`, `CASH_SESSION_CLOSING_START`, `CASH_SESSION_CLOSE`. Idempotentes (id de sesión / `clientId` del cierre). Una venta cuyo `cashSessionId` todavía no existe (llegó antes que su apertura por un lote partido) **crea la sesión en forma perezosa** con los datos mínimos del ítem en vez de rechazar.
- Caja revocada: mismo criterio que ventas (antes de `revoked_at` entra; después `REJECTED DEVICE_REVOKED`).

### Permisos (V43 + `RoleSeeds` + `permissions.ts` en los dos fronts)
| Código | Módulo | Scope | admin | operador |
|---|---|---|---|---|
| `POS_CAJA_ABRIR` | Caja (POS) | ACTION | ✓ | ✓ |
| `POS_CAJA_CERRAR` | Caja (POS) | ACTION | ✓ | ✓ |
| `CAJAS_VER` | Cajas | SCREEN | ✓ | — |
| `CAJAS_REVISAR` | Cajas | ACTION | ✓ | — |
| `CAJAS_CORREGIR` | Cajas | ACTION | ✓ | — |

`SubscriptionAccessFilter`: `GET` de `cash-ledger`/`cash-sessions` en la lista de solo lectura.

### Perfil `local` (H2)
`ddl-auto=update` crea las tablas; `LocalSchemaMigrator.migrateCashSchema` agrega las columnas a `sales`, `expenses`, `credit_payments`, `purchases` y siembra las claves. `AdminService.cleanupTransactionalData` borra también las tablas de caja.

## 4. POS (`omero-electron/web`)

- **`lib/cash/`**: `cashMath.ts` (espejo de `CashMath`, mismos fixtures), `terminal.ts` (terminal key: desktop = identidad de la caja vía endpoint local; web = `localStorage omero_terminal_id`, try/catch), `cashSessionStore.ts` (sesión actual + borrador de cierre).
- **Persistencia del borrador:** desktop → tabla nueva en el outbox SQLite (`cash_drafts`, migración del outbox; nunca se borra en logout, como el outbox); web → `localStorage` (`omero_cash_draft:{tenant}:{user}`), reutilizando el patrón de `useDraft`.
- **Outbox desktop:** `POST /api/cash-sessions*` se interceptan en `data-layer` como ventas/gastos (lista blanca del payload) y viajan como los tipos nuevos de `/api/sync/batch`. En web van directo.
- **Hook `useCashSession`**: estado (`none | open | closing-pending`), `open(manual|auto)`, apertura automática llamada desde `useProducts`/scan cuando `cash_control_enabled` y no hay caja; agrega `cashSessionId` en `useSales`, `useExpenses`, `useCreditCollection`.
- **Teclado:** `I` → `openCash` en `useKeyboard.electron/web` + `KeyboardGuide` (`{ key: 'I', label: 'Iniciar caja' }`). Solo cuando no hay modal abierto y el input está vacío (no interfiere con códigos: son numéricos).
- **UI:**
  - `CashStatusBadge` en el header (abierta desde / fondo / aviso +24 h / cierre pendiente).
  - `DailySummaryModal` → `CashSummaryModal` con el flag activo (datos de `/cash-sessions/{id}/summary` + ventas pendientes del outbox en desktop); botón "Finalizar caja" (`F` o Enter sobre el CTA).
  - `CashClosingWizard` (Modal `tone="dark"`, `closeOnEsc={false}`): pasos R4, navegación con Enter/Esc/flechas, cada paso guarda el borrador. El paso "Hay una diferencia" se renderiza **solo** si `cash_difference_check_enabled` y el umbral del signo está definido y se supera (`cashMath.needsReview`, mismo criterio que el backend); offline usa la config cacheada en `settings`.
  - Con `cash_control_enabled=false` (o al desactivarse: el POS relee la config al loguear y cada 5 min con el syncer) todo lo de caja se oculta y TAB vuelve a `DailySummaryModal`; un borrador de cierre pendiente se conserva pero no se ofrece.
  - Apartados: lee `/api/cash-set-aside-rules` (cacheado en `settings` del catálogo para offline) y quita el cableado "cigarrillo".
- **Tests:** unit de `cashMath`, `useCashSession`, wizard (flujo feliz, bloqueo R3, restante negativo, a ciegas), integración outbox (apertura→ventas→cierre offline, idempotencia, lote partido), contrato de allowlist.

## 5. Admin (`omero`)

- **Configuración → Caja** (`configSections.ts`, nueva sección `caja`): flag y claves de R10 (`BUSINESS_RULES`) + ABM de apartados (`lib/cashRulesApi.ts`), con selector de negocio/categoría y vista previa del sugerido.
- **Caja → Asientos** (`/admin/caja/asientos`, `CAJAS_VER`): tabla tipo planilla agrupada por día (selector General/Dispositivo/Usuario/Caja, rango de fechas), filas expandibles (por medio de pago y por apartado), totales, export CSV. Lógica pura en `lib/cashLedger.ts` con tests.
- Columnas del asiento (D10): Venta total · Venta Efectivo/Transferencia/Crédito/Otros · Gasto Efectivo/Transferencia/Crédito/Otros · Compras · Retiros (Casa + apartados) · Restante (no en General) · Fondo · Cobros · Sobrante/Faltante. Fila expandible con el detalle por medio de pago.
- **Detalle de cierre** (`/admin/caja/[id]`): movimientos, cifras del sistema vs. cajero, auditoría, acción **Corregir** (`CAJAS_CORREGIR`) y "Cerrar desde el admin" para pendientes (también "Control desactivado").
- **Cierres a revisar** (`/admin/caja/revision`, mismo patrón que `admin/sales/review`): pestañas Pendientes / Revisados, diferencia, umbral aplicado, comentario del cajero; **"Confirmar revisión"** con observación obligatoria (`CAJAS_REVISAR`). Contador en el menú (`useCashReviewCount`, 60 s).
- **Configuración → Caja:** switch de control de diferencias; con el switch apagado los dos umbrales se ocultan. Umbrales con `DecimalInput`, vacíos por defecto, texto explicativo ("vacío = no se controla, 0 = cualquier diferencia").
- **Configuración → Cajas:** columnas "Caja actual", "Cierres pendientes", aviso +24 h; incluye terminales web (`/api/terminals`), renombrables.
- **Compras:** selector "Origen del dinero" (Caja / Otro) en `usePurchasePage`; alerta "Dinero de caja sin registrar" con los movimientos disponibles y asignación parcial.
- **Gastos:** columna/medio de pago.
- **Dashboard:** filtro de cajas (multi-select de sesiones por rango + "Todas") en `dashboard/page.tsx`, propagado a `overview`.
- **Permisos:** `permissions.ts` + `permissions.contract.test.ts`; `navConfig` con `CAJAS_VER`.

## 6. Plan de entrega sugerido (detallado en `plan.md`)
1. **Backend A:** V43 + entidades + `CashMath` + sesiones (open/start/confirm) + resumen + permisos + allowlist + tests.
2. **Backend B:** outbox (tipos nuevos, `cashSessionId`), D7, ledger, correcciones, compras con caja, apartados, filtros de dashboard, backfill, H2.
3. **POS:** `useCashSession`, `I`, apertura automática, badge, resumen por caja, wizard, borrador offline, outbox.
4. **Admin:** configuración + apartados, asientos, detalle/corrección, cajas/terminales, compras, filtros de dashboard.

## 7. Riesgos
- **Volumen del lote del outbox:** un cierre offline con muchos movimientos debe entrar en 1 MB (holgado).
- **Concurrencia apertura automática** (dos pestañas web): índice único parcial + `open` idempotente que devuelve la existente.
- **Backfill en tenants grandes:** por lotes de días, fuera de la request del PUT (`@Async` con `TenantContext.runAs`).
- **Ramas paralelas con migraciones** (`feature/boot4-java25`, etc.): si otra rama toma V43 antes del merge, renumerar.
