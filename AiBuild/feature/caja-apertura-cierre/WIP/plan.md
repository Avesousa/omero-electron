# Plan de tareas: Apertura y cierre de caja

## Metadata
- **Fecha:** 2026-11-22
- **Rama:** `feature/caja-apertura-cierre` (3 repos)
- **Tipo:** feature
- **Tests requeridos:** sí
- **Total de tareas:** 30
- **Repos:** backend 16 · POS 6 · admin 5 · transversales 3

## Resumen ejecutivo
Se construye backend primero (V43, CashMath puro con fixtures compartidos, sesiones, cierre, revisión, ledger, outbox), después POS y admin en paralelo contra el contrato ya probado. El cálculo vive en `CashMath` (backend) y `cashMath.ts` (POS) con los mismos casos JSON, así el POS offline y el backend dan el mismo resultado. Todo queda detrás de `cash_control_enabled` (apagado por defecto) para no tocar al cliente actual. Orden de despliegue: backend → admin → POS.

## Fases y tareas

### Fase 0: Setup
- [ ] **T001** [all] — Línea de base de los 3 worktrees
  - Detalle: En .wt/caja-backend `./mvnw clean test` (JDK 21); en .wt/caja-admin `yarn test` + `tsc --noEmit`; en .wt/caja-pos `npm --prefix web run check`. Registrar totales en meta.json.
  - Listo cuando: Los tres en verde (o fallas previas documentadas) con el total de tests anotado.
  - Depende de: nada
  - Complejidad: S
- [ ] **T002** [omero-backend] — Migración V43 (esquema de caja)
  - Detalle: Tablas cash_sessions, cash_closings, cash_closing_breakdown, cash_movements, cash_purchase_allocations, cash_set_aside_rules, cash_closing_audit (tenant_id + FK + índices, únicos parciales OPEN/CLOSING por terminal+usuario). Columnas cash_session_id en sales/expenses/credit_payments, expenses.payment_method_id, purchases.money_source/cash_session_id. Seed de 7 claves business_config_key y de 5 permisos (POS_CAJA_ABRIR, POS_CAJA_CERRAR, CAJAS_VER, CAJAS_REVISAR, CAJAS_CORREGIR) para los roles existentes.
  - Listo cuando: FlywayMigrationTest con caso V43 sobre una base en V42 con datos: aplica limpio, columnas nullable, defaults correctos.
  - Depende de: T001
  - Archivos: `src/main/resources/db/migration/V43__cash_register.sql`, `FlywayMigrationTest.java`
  - Complejidad: M

### Fase 1: Fundación
- [ ] **T003** [omero-backend] — Entidades y repositorios de caja
  - Detalle: CashSession, CashClosing, CashClosingBreakdown, CashMovement, CashPurchaseAllocation, CashSetAsideRule, CashClosingAudit con @TenantId, sin Lombok, setters con Amounts. Enums CashSessionStatus/Kind, PaymentGroup (de PaymentMethodKind, D10), ReviewStatus. Campos nuevos en Sale, Expense, CreditPayment, Purchase.
  - Listo cuando: La app arranca con ddl-auto=validate contra V43 (test de contexto verde).
  - Depende de: T002
  - Archivos: `model/Cash*.java`, `repository/Cash*Repository.java`
  - Complejidad: M
- [ ] **T004** [omero-backend] — CashMath (puro) + fixtures compartidos
  - Detalle: Esperado, diferencia, distribución/restante, identidad del asiento, needsReview(diferencia, enabled, umbralFaltante, umbralSobrante) con umbral vacío = no controla. Fixtures src/test/resources/cash-cases.json con el ejemplo de R5/R6 (91.500) y casos de umbral.
  - Listo cuando: CashMathTest verde con todos los casos del JSON.
  - Depende de: T001
  - En paralelo con: T002, T003
  - Archivos: `service/cash/CashMath.java`, `cash-cases.json`
  - Complejidad: S
- [ ] **T005** [omero-backend] — Permisos y configuración
  - Detalle: Permission.java + RoleSeeds (admin todo; operador POS_CAJA_*), DeviceScopeFilter (rutas pos de caja), SubscriptionAccessFilter (GET de lectura), validación de claves `number` en BusinessConfigService (vacío permitido).
  - Listo cuando: PermissionEnforcementTest, DeviceScopeFilterTest y RoleMigrationTest verdes con los códigos nuevos.
  - Depende de: T003
  - En paralelo con: T004
  - Archivos: `security/Permission.java`, `security/RoleSeeds.java`, `security/DeviceScopeFilter.java`, `service/BusinessConfigService.java`
  - Complejidad: S
- [ ] **T018** [omero-electron] — lib/cash: cashMath espejo + terminal key
  - Detalle: cashMath.ts con los mismos fixtures (copia de cash-cases.json), terminal.ts (desktop: identidad de la caja vía endpoint local; web: localStorage omero_terminal_id con try/catch), tipos.
  - Listo cuando: Tests de cashMath con los fixtures y de terminal en web/desktop.
  - Depende de: T004
  - Archivos: `web/src/lib/cash/*`
  - Complejidad: S
- [ ] **T024** [omero] — Clientes API + tipos + permisos
  - Detalle: lib/cashApi.ts, cashRulesApi.ts, cashLedger.ts (lógica pura: columnas, agrupación, export), tipos; permissions.ts + contract test; navConfig (Caja → Asientos / Cierres a revisar).
  - Listo cuando: Tests de lógica pura y de contrato de permisos verdes.
  - Depende de: T014
  - Archivos: `src/lib/cash*.ts`, `src/shared/permissions.ts`, `navConfig.ts`
  - Complejidad: S

### Fase 2: Núcleo
- [ ] **T006** [omero-backend] — CashSessionService: abrir / iniciar cierre
  - Detalle: open idempotente (devuelve la OPEN existente), fondo = remaining del último CLOSED (NULL si hay CLOSING), startClosing con 409 CASH_CLOSING_PENDING, 409 CASH_CONTROL_DISABLED con el flag apagado. TransactionTemplate por operación.
  - Listo cuando: Tests de integración: apertura doble, fondo encadenado, bloqueo de segundo cierre, flag apagado, aislamiento de tenants.
  - Depende de: T003, T004, T005
  - Archivos: `service/cash/CashSessionService.java`, `CashSessionTest.java`
  - Complejidad: M
- [ ] **T007** [omero-backend] — Resumen de caja + apartados sugeridos
  - Detalle: CashSummaryService (ventas/gastos/cobros por medio y grupo, salidas previas, esperado oculto si cash_show_expected=false) y CashSetAsideCalculator con HQL agrupado (ITEM_REVENUE / LINE_COST_SUM) por negocio/categoría. Sin N+1: una consulta por concepto.
  - Listo cuando: Tests: resumen de una caja de 2 días con crédito y huérfanos; sugeridos por SALE_TOTAL/COST/PERCENT; cantidad de queries acotada (Hibernate statistics).
  - Depende de: T006
  - En paralelo con: T008
  - Archivos: `service/cash/CashSummaryService.java`, `service/cash/CashSetAsideCalculator.java`
  - Complejidad: M
- [ ] **T008** [omero-backend] — Confirmar cierre (asiento)
  - Detalle: confirmClosing: recalcula con CashMath, persiste closing + breakdown + movimientos (gastos al cierre crean Expense con payment_method_id y cash_session_id), columnas por grupo (D10), accounting_date en zona del tenant, completa opening_amount de la sesión siguiente, review PENDING según umbrales con snapshot. Idempotente por clientId. Restante negativo → 400 CASH_REMAINING_NEGATIVE.
  - Listo cuando: Test con el ejemplo de R5: faltante 500, identidad 91.500, columnas por grupo; umbral faltante 1000 / sin umbral sobrante; reintento con el mismo clientId no duplica.
  - Depende de: T006
  - Archivos: `service/cash/CashSessionService.java`, `CashClosingTest.java`
  - Complejidad: L
- [ ] **T009** [omero-backend] — Ventas/gastos/cobros asociados a la caja + D7
  - Detalle: cashSessionId opcional en POST /sales, /expenses (+ paymentMethodId), /credit/collect, validado por tenant (404). Con flag activo y sin caja → caja AUTO_DAILY del usuario. Con flag apagado no se aplica (D9).
  - Listo cuando: Tests: venta con caja, venta sin caja con flag on/off, caja de otro tenant 404, gasto con medio MP.
  - Depende de: T006
  - En paralelo con: T007, T008
  - Archivos: `service/SaleService.java`, `service/ExpenseService.java`, `service/CreditService.java`
  - Complejidad: M
- [ ] **T010** [omero-backend] — Revisión y corrección desde el admin
  - Detalle: review (nota obligatoria, idempotente, 409 CASH_REVIEW_NOT_PENDING), correct (auditoría before/after, recalcula, propaga restante a la sesión siguiente, no reabre revisión), cerrar desde el admin OPEN/CLOSING aun con flag apagado.
  - Listo cuando: Tests: revisar, revisar dos veces, corregir con propagación del fondo, auditoría registrada, permisos.
  - Depende de: T008
  - Archivos: `service/cash/CashSessionService.java`, `CashReviewTest.java`
  - Complejidad: M
- [ ] **T011** [omero-backend] — Compras con plata de la caja
  - Detalle: moneySource/cashSessionId/cashAllocations en POST /purchases; cash_purchase_allocations; disponible = monto − asignado; 409 CASH_ALLOCATION_EXCEEDS; GET /cash-movements/unallocated-purchases. Respeta preview (rollback).
  - Listo cuando: Tests: asignación total y parcial, exceso, preview no persiste, alerta lista saldo.
  - Depende de: T008
  - En paralelo con: T010
  - Archivos: `service/PurchaseService.java`, `service/cash/CashPurchaseService.java`
  - Complejidad: M
- [ ] **T012** [omero-backend] — Asiento diario (ledger) + export
  - Detalle: CashLedgerService: GROUP BY accounting_date [+ terminal|user|session], columnas por grupo, restante solo fuera de GENERAL, CSV.
  - Listo cuando: Tests: dos cierres el mismo día suman; restante ausente en GENERAL y presente por caja; CSV con encabezados en español.
  - Depende de: T008
  - En paralelo con: T010, T011
  - Archivos: `service/cash/CashLedgerService.java`
  - Complejidad: M
- [ ] **T013** [omero-backend] — Backfill LEGACY_DAILY (activar/reactivar)
  - Detalle: Job @Async con TenantContext.runAs, por lotes de días, idempotente por (día, usuario); se dispara al PUT de cash_control_enabled=true y por endpoint admin. Cubre reactivación (solo días sin caja).
  - Listo cuando: Tests: activar crea cajas cerradas sin arqueo y asigna ventas; correr dos veces no duplica; desactivar/reactivar completa solo el hueco.
  - Depende de: T009
  - Archivos: `service/cash/CashBackfillJob.java`
  - Complejidad: M
- [ ] **T019** [omero-electron] — Outbox y borrador de cierre (desktop) + interceptación
  - Detalle: Migración del outbox con tabla cash_drafts; data-layer intercepta POST /api/cash-sessions* (lista blanca) → tipos nuevos del batch; endpoints locales del borrador. Web: borrador en localStorage.
  - Listo cuando: outbox.integration.test: apertura→ventas→cierre offline, reinicio conserva el borrador, idempotencia.
  - Depende de: T015, T018
  - Archivos: `web/src/lib/outbox/*`, `web/src/lib/data-layer.ts`
  - Complejidad: L
- [ ] **T020** [omero-electron] — useCashSession + apertura (I y automática)
  - Detalle: Hook con estados none/open/closing-pending, tecla I (useKeyboard.electron/web, KeyboardGuide), apertura automática al escanear/tipear código, cashSessionId en useSales/useExpenses/useCreditCollection, config cash_* cacheada en settings, todo oculto con el flag apagado.
  - Listo cuando: Tests: I abre con fondo propuesto, escaneo abre y agrega el producto, flag apagado = comportamiento actual (tests existentes verdes).
  - Depende de: T014, T018
  - En paralelo con: T019
  - Archivos: `web/src/app/pos/hooks/useCashSession.ts`, `useKeyboard.*.ts`, `page.tsx`
  - Complejidad: M

### Fase 3: Integración
- [ ] **T014** [omero-backend] — Controllers REST de caja
  - Detalle: CashSessionController, CashLedgerController, CashSetAsideRuleController, TerminalController según tabla del spec técnico; ApiResponse + errores con code.
  - Listo cuando: Tests HTTP por endpoint (200/400/403/404/409) y aislamiento de tenants.
  - Depende de: T007, T010, T011, T012
  - Archivos: `controller/Cash*.java`, `controller/TerminalController.java`
  - Complejidad: M
- [ ] **T015** [omero-backend] — Outbox: tipos de caja + cashSessionId
  - Detalle: CASH_SESSION_OPEN / CLOSING_START / CLOSE en /api/sync/batch, idempotentes; SALE/EXPENSE/CREDIT_COLLECTION con cashSessionId; sesión perezosa si la venta llega antes que la apertura; caja revocada igual que ventas.
  - Listo cuando: SyncControllerTest: secuencia offline completa, lote partido, duplicados, caja revocada.
  - Depende de: T008, T009
  - En paralelo con: T014
  - Archivos: `service/SyncItemProcessor.java`, `dto/sync/*`
  - Complejidad: L
- [ ] **T016** [omero-backend] — Filtro por caja en dashboard/estadísticas
  - Detalle: cashSessionIds en overview, stats, daily-series, /stats/sales, /sales, /sales/summary (ReportAggregationRepository). Sin filtro no cambia nada.
  - Listo cuando: Goldens de DashboardStatsCharacterizationTest sin regrabar + test nuevo con filtro de una y de varias cajas.
  - Depende de: T009
  - En paralelo con: T014, T015
  - Archivos: `repository/ReportAggregationRepository.java`, `service/DashboardService.java`
  - Complejidad: M
- [ ] **T017** [omero-backend] — Perfil local H2
  - Detalle: LocalSchemaMigrator.migrateCashSchema (columnas en tablas existentes + claves), AdminService.cleanupTransactionalData borra tablas de caja.
  - Listo cuando: LocalSchemaMigratorTest verde con el caso de caja.
  - Depende de: T003
  - En paralelo con: T006
  - Archivos: `config/LocalSchemaMigrator.java`, `service/AdminService.java`
  - Complejidad: S
- [ ] **T021** [omero-electron] — Badge de caja + resumen por caja (TAB)
  - Detalle: CashStatusBadge (abierta desde, fondo, aviso +24 h, cierre pendiente); CashSummaryModal con /cash-sessions/{id}/summary + pendientes del outbox; apartados con show_in_summary reemplazan el cableado de cigarrillo.
  - Listo cuando: Tests de render y del cálculo con pendientes; DailySummaryModal intacto con flag apagado.
  - Depende de: T020
  - Archivos: `web/src/app/pos/components/cash/*`
  - Complejidad: M
- [ ] **T022** [omero-electron] — Asistente de cierre
  - Detalle: CashClosingWizard: pasos R4, teclado, borrador por paso, bloqueo R3, restante negativo, a ciegas, pantalla de diferencia solo si control activo y umbral superado.
  - Listo cuando: Tests: flujo feliz, retomar borrador, bloqueo, a ciegas, con/sin control de diferencias, offline.
  - Depende de: T019, T021
  - Archivos: `web/src/app/pos/components/cash/CashClosingWizard.tsx`
  - Complejidad: L
- [ ] **T025** [omero] — Configuración → Caja + apartados
  - Detalle: Sección caja en configSections: claves R10 (switch de diferencias oculta umbrales; umbrales vacíos con DecimalInput), ABM de apartados con negocio/categoría y base.
  - Listo cuando: Smoke tests + test de payload (vacío vs 0).
  - Depende de: T024
  - En paralelo con: T026, T027
  - Archivos: `src/app/admin/configuracion/caja/*`
  - Complejidad: M
- [ ] **T026** [omero] — Asientos (tabla tipo planilla)
  - Detalle: Pantalla /admin/caja/asientos: General/Dispositivo/Usuario/Caja, rango de fechas, columnas por grupo, filas expandibles, totales, CSV.
  - Listo cuando: Smoke test + tests de cashLedger con dos cierres del mismo día.
  - Depende de: T024
  - En paralelo con: T025, T027
  - Archivos: `src/app/admin/caja/asientos/*`
  - Complejidad: L
- [ ] **T027** [omero] — Detalle, revisión y corrección de cierres
  - Detalle: /admin/caja/[id] (movimientos, sistema vs cajero, auditoría, Corregir, cerrar pendiente), /admin/caja/revision (Pendientes/Revisados, Confirmar revisión con observación), contador en el menú.
  - Listo cuando: Smoke tests + flujo de revisión y corrección con API mockeada.
  - Depende de: T024
  - En paralelo con: T025, T026
  - Archivos: `src/app/admin/caja/[id]/*`, `src/app/admin/caja/revision/*`
  - Complejidad: L
- [ ] **T028** [omero] — Cajas/terminales, compras, gastos y filtro de dashboard
  - Detalle: Configuración → Cajas con caja actual/pendientes/+24 h y terminales web; Compras: origen del dinero + alerta + asignación parcial; Gastos: medio de pago; Dashboard: filtro de cajas propagado a overview.
  - Listo cuando: Smoke tests de cada pantalla tocada + test de asignación en usePurchasePage.
  - Depende de: T024, T016
  - Archivos: `src/app/admin/devices/*`, `src/app/admin/purchases/*`, `src/app/dashboard/*`
  - Complejidad: L

### Fase 4: Calidad
- [ ] **T023** [omero-electron] — Contrato de allowlist y permisos del POS
  - Detalle: allowlist.contract.test.ts con las rutas nuevas; permissions.ts + test de contrato.
  - Listo cuando: `npm --prefix web run check` verde (umbral 85 % en lib/cash y outbox).
  - Depende de: T020
  - En paralelo con: T021, T022
  - Archivos: `web/src/lib/device/allowlist.contract.test.ts`, `web/src/shared/permissions.ts`
  - Complejidad: S
- [ ] **T029** [all] — Prueba punta a punta y performance
  - Detalle: Backend completo verde; flujo manual POS desktop offline→online contra backend local; EXPLAIN del ledger y del resumen con 50k ventas (usar índices de V43).
  - Listo cuando: Las 3 suites verdes; consultas del ledger y del resumen < 200 ms con 50k ventas.
  - Depende de: T013, T015, T016, T017, T022, T023, T025, T026, T027, T028
  - Complejidad: M

### Fase 5: Cierre
- [ ] **T030** [all] — Documentación (CLAUDE.md de los 3 repos)
  - Detalle: Sección 'Apertura y cierre de caja (V43)' con contrato, decisiones D1–D10, orden de despliegue y deuda técnica.
  - Listo cuando: Secciones agregadas y revisadas.
  - Depende de: T029
  - Archivos: `CLAUDE.md`
  - Complejidad: S

## Mapa de dependencias
```
T001 → T002 → T003 → T005 → T006 ─┬→ T007 ─────────────┐
   └→ T004 ─────────────────────┘  ├→ T008 ─┬→ T010 ──┤
                                    │        ├→ T011 ──┼→ T014 → T020 → T021 → T022
                                    │        ├→ T012 ──┘     └→ T024 → T025/T026/T027/T028
                                    │        └→ T015 → T019 ────────────────↗ (T022)
                                    └→ T009 → T013, T016 → T028
T003 → T017      T004 → T018 → T019/T020      todo → T029 → T030
```

## Grupos paralelizables
- **A** (tras T001): T002 y T004.
- **B** (tras T003): T005, T017.
- **C** (tras T006): T007, T008, T009.
- **D** (tras T008): T010, T011, T012, T015.
- **E** (tras T014): POS (T020→T022) y admin (T024→T028) en paralelo.

## Riesgos y mitigaciones
| Riesgo | Prob. | Mitigación |
|---|---|---|
| Cálculo distinto entre POS offline y backend | Media | Fixtures `cash-cases.json` compartidos y backend como fuente de verdad (D4) |
| Orden de llegada en el outbox (venta antes que apertura) | Media | Sesión perezosa en T015 + tests de lote partido |
| Otra rama toma V43 antes del merge | Media | Renumerar al rebasear; FlywayMigrationTest lo detecta |
| Regresión en dashboard | Baja | Goldens sin regrabar en T016 |
| Backfill lento en tenants grandes | Baja | Job asíncrono por lotes de días (T013) |

## Resumen de complejidad
| Tarea | Tamaño | Motivo |
|---|---|---|
| T001 | S | Línea de base de los 3 worktrees |
| T002 | M | Migración V43 (esquema de caja) |
| T003 | M | Entidades y repositorios de caja |
| T004 | S | CashMath (puro) + fixtures compartidos |
| T005 | S | Permisos y configuración |
| T006 | M | CashSessionService: abrir / iniciar cierre |
| T007 | M | Resumen de caja + apartados sugeridos |
| T008 | L | Confirmar cierre (asiento) |
| T009 | M | Ventas/gastos/cobros asociados a la caja + D7 |
| T010 | M | Revisión y corrección desde el admin |
| T011 | M | Compras con plata de la caja |
| T012 | M | Asiento diario (ledger) + export |
| T013 | M | Backfill LEGACY_DAILY (activar/reactivar) |
| T014 | M | Controllers REST de caja |
| T015 | L | Outbox: tipos de caja + cashSessionId |
| T016 | M | Filtro por caja en dashboard/estadísticas |
| T017 | S | Perfil local H2 |
| T018 | S | lib/cash: cashMath espejo + terminal key |
| T019 | L | Outbox y borrador de cierre (desktop) + interceptación |
| T020 | M | useCashSession + apertura (I y automática) |
| T021 | M | Badge de caja + resumen por caja (TAB) |
| T022 | L | Asistente de cierre |
| T023 | S | Contrato de allowlist y permisos del POS |
| T024 | S | Clientes API + tipos + permisos |
| T025 | M | Configuración → Caja + apartados |
| T026 | L | Asientos (tabla tipo planilla) |
| T027 | L | Detalle, revisión y corrección de cierres |
| T028 | L | Cajas/terminales, compras, gastos y filtro de dashboard |
| T029 | M | Prueba punta a punta y performance |
| T030 | S | Documentación (CLAUDE.md de los 3 repos) |
