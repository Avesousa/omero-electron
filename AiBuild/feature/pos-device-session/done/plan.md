# Task Plan: Sesión de dispositivo del POS (fase 4)

## Metadata
- **Date:** 2026-09-21
- **Branch:** feature/pos-device-session (omero-backend, omero-electron, omero)
- **Type:** feature
- **Tests required:** yes
- **Total tasks:** 19
- **Parallelizable groups:** backend (T002/T003) ∥ Electron main (T006) ∥ POS lib (T008); admin (T015) ∥ tests

## Executive summary
Una spec, 3 PRs en orden: **backend → POS (+Electron main) → admin**. Primero el backend (tabla `devices`, JWT con `scope`, allowlist, endpoints de caja). En paralelo, el `device-store` de Electron con `safeStorage` y el estado/cliente de caja del POS. Luego la intercepción del login y los endpoints locales, el `token-provider` que hace que el outbox se renueve solo (y suba por `sync-token` con la caja revocada), y el renderer (renovación silenciosa y `/login`). El admin agrega la pantalla de cajas. Todo es aditivo: POS viejo/backend nuevo y viceversa siguen funcionando. Cierra con tests por capa, smoke E2E local con gateway intermitente y documentación.

## Phases and tasks
### Phase 0: Setup
- [ ] **T001** — [backend] Migración V18 `devices`, entidad, repositorio y `code` en ApiResponse
  - Detail: Flyway V18 con la tabla `devices` (columnas e índices de la tech-spec, FK a tenants/users, CHECK de status, `UNIQUE(tenant_id, client_device_id)`). Entidad `Device` con `@TenantId`, `DeviceRepository` (findByClientDeviceId tenant-scoped; lookup global por id vía JdbcTemplate en un `DeviceLookup`). Agregar campo opcional `code` (NON_NULL) a `ApiResponse` y a `GlobalExceptionHandler`/`ApiException` para errores tipificados. Test de migración (columnas, índices, unicidad).
  - Done when: V18 aplica sobre la base sembrada; `./mvnw test` sigue verde; `ApiResponse` serializa `code` solo cuando existe.
  - Dependencies: none
  - Files affected: (omero-backend) db/migration/V18__devices.sql, model/Device.java, repository/DeviceRepository.java, service/DeviceLookup.java, dto/ApiResponse.java, exception/*
  - Complexity: M
### Phase 1: Foundation
- [ ] **T002** — [backend] JWT con `scope`/`deviceId` y `DeviceScopeFilter` (lista blanca)
  - Detail: `JwtService.generateDeviceToken(user, device, scope)` (claims `scope`, `deviceId`, 1 h); `JwtFilter` publica scope/deviceId en el request; `DeviceScopeFilter` (después de JwtFilter) impone la allowlist de la tech-spec para `pos` y `sync` (403 con `sendError`), sin efecto para tokens sin scope; registrar en `SecurityConfig`.
  - Done when: Con un JWT `pos` de ADMIN, rutas fuera de la lista dan 403; `sync` solo permite `/api/sync/batch` y `/api/auth/device/**`; tokens sin scope no cambian (suite existente verde).
  - Dependencies: T001
  - Can parallelize with: T003
  - Files affected: (omero-backend) security/JwtService.java, security/JwtFilter.java, security/DeviceScopeFilter.java, security/SecurityConfig.java
  - Complexity: M
- [ ] **T003** — [backend] `DeviceAuthService` + endpoints públicos (login con device, refresh, sync-token, logout)
  - Detail: Fachada no transaccional que resuelve el tenant por id global y usa `TenantContext.runAs` antes de la transacción. Login con `device` (crea/reconoce/reactiva caja, rechaza revocada con `DEVICE_REVOKED`, rota secreto, `session_active`, `expires_at=+14d`); `LoginRequest.device`/`LoginResponse.deviceSecret`; `POST /api/auth/device/{refresh,sync-token,logout}` con las reglas de estado, rotación con gracia de 5 min, `reuse_detected_at`, comparación en tiempo constante, hash SHA-256, reloj inyectable, y códigos de error. Incluir los paths en el rate limiter.
  - Done when: Los cuatro flujos cumplen las reglas de estado de la tech-spec (verificado en T005); el login sin `device` es idéntico al actual.
  - Dependencies: T001, T002
  - Files affected: (omero-backend) service/DeviceAuthService.java, service/DeviceTxService.java, controller/AuthController.java, dto/auth/*, service/AuthService.java, security/RateLimiterInterceptor.java
  - Complexity: L
- [ ] **T006** — [electron] `device-store` con safeStorage e integración en `process-manager`
  - Detail: `main/device-store.ts`: deviceId persistente (archivo plano), secretos por tenant cifrados con `safeStorage` en `<userData>/device-session.bin` (escritura atómica tmp+rename, archivo corrupto → se aparta, sin cifrado disponible o backend `basic_text` → no persiste); `process-manager`: env `OMERO_DEVICE_ID/NAME/APP_VERSION/SECRETS/PERSIST` al hacer `fork` y escucha `message` `omero:device-secrets` del Next para persistir (debounce). Tests unit con safeStorage falso.
  - Done when: Round-trip cifrado/descifrado, corrupto y sin cifrado cubiertos en unit; el Next recibe el env al arrancar.
  - Dependencies: none
  - Can parallelize with: T001
  - Files affected: main/device-store.ts, main/device-store.test.ts, main/process-manager.ts
  - Complexity: M
- [ ] **T008** — [pos] Estado de caja, puente IPC y cliente del backend (`lib/device`)
  - Detail: `device-state.ts` (mapa por tenant `{secret, sessionActive}`, carga desde `OMERO_DEVICE_SECRETS`, `onChange`), `device-bridge.ts` (`process.parentPort.postMessage`, no-op fuera de Electron), `device-client.ts` (`/api/auth/device/{refresh,sync-token,logout}` con timeout y códigos de error tipificados, sin reintentos). Solo desktop; en web todo es no-op.
  - Done when: Estado y cliente cubiertos por unit con backend falso; el puente notifica cada cambio.
  - Dependencies: T001
  - Can parallelize with: T006
  - Files affected: (omero-electron) web/src/lib/device/device-state.ts, device-bridge.ts, device-client.ts
  - Complexity: M
### Phase 2: Core
- [ ] **T004** — [backend] Administración de cajas (ADMIN): listar, renombrar, revocar
  - Detail: `DeviceController`/`DeviceAdminService`: `GET /api/devices` (estado calculado ACTIVE/REVOKED/EXPIRED, último cajero, versión), `PATCH /api/devices/{id}` (nombre 1..100), `POST /api/devices/{id}/revoke` (idempotente, `revoked_at/by`). `@PreAuthorize ADMIN`, tenant-scoped (404 cross-tenant). Un JWT `pos` no accede (allowlist).
  - Done when: Los tres endpoints responden el contrato y respetan rol y tenant (verificado en T005).
  - Dependencies: T003
  - Files affected: (omero-backend) controller/DeviceController.java, service/DeviceAdminService.java, dto/device/*
  - Complexity: M
- [ ] **T009** — [pos] Intercepción del login y endpoints locales de sesión
  - Detail: En `data-layer` (desktop): `POST /api/auth/login` inyecta `device{deviceId,name,platform,appVersion}` (de env), guarda el `deviceSecret` de la respuesta y lo QUITA del body; endpoints locales `POST /api/_local/session/refresh` (sin Authorization; mapea códigos: 200 / 401 LOGIN_REQUIRED|DEVICE_EXPIRED|NO_DEVICE / 403 DEVICE_REVOKED / 503 UNAVAILABLE, y persiste el secreto rotado), `GET /api/_local/session` y `DELETE /api/_local/session` (logout de caja, conserva el secreto). Un refresh en vuelo por tenant (mutex). Web: 404/no-op.
  - Done when: El renderer nunca ve el secreto; refresh y logout locales funcionan contra un backend falso.
  - Dependencies: T008
  - Files affected: (omero-electron) web/src/lib/device/session-proxy.ts, web/src/lib/data-layer.ts, web/src/app/api/%5Flocal/session/route.ts, web/src/app/api/%5Flocal/session/refresh/route.ts
  - Complexity: L
- [ ] **T010** — [pos] `token-provider` e integración con sender y syncer
  - Detail: `authorize(tenantId)`: token `pos` del syncer vigente (>2 min) → `refresh` (si `sessionActive`) → ante `DEVICE_REVOKED/DEVICE_EXPIRED/LOGIN_REQUIRED` → `sync-token`; un solo refresh en vuelo. `outbox-sender` usa `authorize` (async) y con 401 reintenta una vez renovando; `unauthorized` solo si tampoco hay credencial de caja. `syncer` intenta `renew` en lugar de olvidar el token vencido (solo tokens `pos`; nunca usa uno `sync` para el catálogo).
  - Done when: Con un backend falso, el outbox sube con el JWT vencido renovando solo, y con la caja revocada sube con `sync-token` (verificado en T012/T013).
  - Dependencies: T008, T009
  - Files affected: (omero-electron) web/src/lib/device/token-provider.ts, web/src/lib/outbox/outbox-sender.ts, web/src/lib/catalog/syncer.ts
  - Complexity: L
- [ ] **T015** — [admin] Pantalla `/admin/devices` (cajas)
  - Detail: `devicesApi.ts` + tipos; página con tabla (nombre, estado ACTIVA/REVOCADA/VENCIDA, último uso, último cajero, versión, alta), aviso 'reuso de secreto detectado', acciones **Renombrar** (modal) y **Revocar** (confirmación explicando: no puede iniciar sesión ni operar, sí subir lo pendiente 30 días); contador de cajas activas; ítem 'Cajas' en `navConfig` (Configuración). `Modal` compartido, `o-cta*`/`badge-*`; estados de carga/error/vacío.
  - Done when: El admin lista, renombra y revoca contra el backend (o un mock) sin errores de consola.
  - Dependencies: T004
  - Can parallelize with: T008
  - Files affected: (omero) src/app/admin/devices/page.tsx, src/app/admin/devices/components/*, src/lib/devicesApi.ts, src/shared/types/devices.ts, src/app/components/nav/navConfig.ts
  - Complexity: M
### Phase 3: Integration
- [ ] **T005** — [backend] Tests de integración del backend (Testcontainers)
  - Detail: `DeviceSessionControllerTest`: login registra caja + secreto; refresh rota y extiende 14 d; gracia (anterior ≤ 5 min ok / luego 401 + `reuse_detected_at`); revocada → 403 en login y refresh; vencida por 14 d; sync-token dentro/fuera de la ventana de 30 d (reloj inyectable) para revocada y vencida; logout (`LOGIN_REQUIRED` en refresh, sync-token sigue); allowlist (`pos` de ADMIN → 403 en POST /api/products, /api/sales/review, /api/devices; `sync` solo batch); aislamiento entre tenants; OPERADOR → 403 en `/api/devices`; renombrar/revocar; compat (login sin `device`, refresh de la web intactos).
  - Done when: `./mvnw test` pasa incluyendo las clases nuevas.
  - Dependencies: T003, T004
  - Can parallelize with: T012
  - Files affected: (omero-backend) src/test/java/com/omero/integration/DeviceSessionControllerTest.java, DeviceScopeFilterTest.java, DeviceAdminControllerTest.java
  - Complexity: L
- [ ] **T007** — [electron] Verificación real de `safeStorage` con Electron
  - Detail: `scripts/verify-safestorage.cjs` (+ `npm run verify:safestorage`): app mínima de Electron que espera `ready`, cifra/descifra, escribe el archivo con `device-store` y comprueba que NO contiene el secreto en claro; sale con código ≠ 0 si falla. Documentar que requiere sesión gráfica (macOS/Windows).
  - Done when: El script pasa en macOS con el Electron real del proyecto y detecta un secreto en claro (probado con un caso negativo).
  - Dependencies: T006
  - Can parallelize with: T005
  - Files affected: scripts/verify-safestorage.cjs, package.json
  - Complexity: S
- [ ] **T011** — [pos] Renderer: renovación silenciosa, `/login` y logout
  - Detail: `useSessionRenewal` (agenda `exp − 5 min`, al recuperar red/visibilidad; en desktop con caja) e integrarlo en `AuthProvider`; `LoginForm`: al montar en desktop intenta renovar en silencio y vuelve a `redirectTo`, si no muestra el mensaje según `?reason=device-revoked|device-expired|login-required`; `AuthContext.logout` llama `DELETE /api/_local/session`; verificar que el middleware/`proxy.ts` no impida llegar a `/login`. Web: sin cambios.
  - Done when: Con el JWT vencido, abrir el POS renueva sin pedir credenciales; con caja revocada muestra el mensaje y no deja operar.
  - Dependencies: T009
  - Can parallelize with: T010
  - Files affected: (omero-electron) web/src/shared/contexts/auth.tsx, web/src/app/login/components/LoginForm.tsx, web/src/lib/useSessionRenewal.ts, web/src/lib/sessionManager.ts
  - Complexity: L
### Phase 4: Quality
- [ ] **T012** — [pos] Tests unit del POS (`lib/device`, sender, syncer)
  - Detail: Unit: estado y puente, cliente (todos los códigos), intercepción del login (secreto quitado), endpoints locales (200/401/403/503, persistencia del secreto rotado, mutex), token-provider (orden pos→refresh→sync, concurrencia, ventana cerrada), sender (renovación con 401 una vez, `unauthorized` sin caja) y syncer (`renew`). Cobertura ≥ 85 % en `lib/device/**`.
  - Done when: `npm --prefix web run check` pasa con los umbrales (incluir `lib/device/**` en la cobertura).
  - Dependencies: T010
  - Can parallelize with: T005
  - Files affected: (omero-electron) web/src/lib/device/*.test.ts, web/src/lib/outbox/outbox-sender.test.ts, web/src/lib/catalog/syncer.test.ts, web/vitest.config.mts
  - Complexity: L
- [ ] **T013** — [pos] Test de integración del POS + contrato de allowlist
  - Detail: Backend HTTP falso con el contrato de la tech-spec: activar (login), renovar tras vencer el JWT (outbox sube sin login), rotación del secreto persistida (reinicio simulado con env), caja revocada (POS bloquea, outbox sube por sync-token), ventana cerrada (`unauthorized`, outbox intacto), otro tenant sin cruce. **Test de contrato**: extrae las rutas que el POS llama (`apiFetch`/`fetch`/`EventSource`) y falla si alguna no está en la lista blanca de la tech-spec.
  - Done when: La clase pasa 3 veces seguidas; el test de contrato pasa y detecta una ruta nueva no incluida.
  - Dependencies: T010, T011
  - Files affected: (omero-electron) web/src/lib/device/device.integration.test.ts, web/src/lib/device/allowlist.contract.test.ts
  - Complexity: L
- [ ] **T014** — [pos] Tests de UI del renderer
  - Detail: Testing Library: `useSessionRenewal` (agenda, red, revocada), `LoginForm` (renovación silenciosa, mensajes por `reason`, sin caja), `AuthContext.logout` (llama al endpoint local, mantiene el aviso de pendientes), sin cambios en web.
  - Done when: `npm --prefix web test` pasa.
  - Dependencies: T011
  - Can parallelize with: T013
  - Files affected: (omero-electron) web/src/lib/useSessionRenewal.test.ts, web/src/app/login/components/LoginForm.test.tsx, web/src/shared/contexts/auth.test.tsx
  - Complexity: M
- [ ] **T016** — [admin] Tests del admin
  - Detail: vitest + Testing Library: lista (carga/vacío/error), estados y reuso, renombrar (éxito/validación), revocar (confirmación, error, ya revocada), navConfig; `devicesApi` (rutas y cuerpos). `tsc --noEmit` limpio.
  - Done when: `yarn test` y `tsc --noEmit` pasan en omero (archivos nuevos al 100 %).
  - Dependencies: T015
  - Can parallelize with: T014
  - Files affected: (omero) src/app/admin/devices/*.test.tsx, src/lib/__tests__/devicesApi.test.ts
  - Complexity: M
### Phase 5: Polish
- [ ] **T017** — [e2e] Smoke end-to-end local con los 3 repos
  - Detail: Con `dev.sh` (backend de la rama con V18), POS desktop y gateway intermitente (como en la fase 3), con `exp` corto de prueba: (1) login activa la caja y aparece en el admin; (2) vence el JWT → se renueva solo y el outbox sube sin login; (3) rotación del secreto persistida tras reiniciar el Next; (4) revocar → login/refresh rechazados y el outbox sube por sync-token; (5) ventana de 30 d cerrada; (6) logout + otro cajero en la misma caja; (7) backend viejo sin endpoints → comportamiento actual; (8) JWT `pos` de ADMIN → 403 en rutas de administración. Registrar en `manual-checklist.md`.
  - Done when: Los checks pasan y quedan con fecha en manual-checklist.md.
  - Dependencies: T005, T013, T015
  - Files affected: AiBuild/feature/pos-device-session/WIP/manual-checklist.md, (scratchpad) e2e-device.py
  - Complexity: L
- [ ] **T018** — [e2e] Documentación de los tres repos y tech-spec
  - Detail: CLAUDE.md de omero-backend (V18, scope, allowlist, endpoints de caja, reglas de estado), omero-electron (device-store/safeStorage, `lib/device`, endpoints locales, token-provider, variables `OMERO_DEVICE_*`, `verify:safestorage`) y omero (pantalla de cajas); ajustar la technical-spec con las decisiones del build.
  - Done when: Un desarrollador nuevo entiende el flujo completo; la spec refleja lo construido.
  - Dependencies: T011, T015
  - Can parallelize with: T019
  - Files affected: (omero-backend) CLAUDE.md, (omero-electron) CLAUDE.md, (omero) CLAUDE.md, technical-spec.md
  - Complexity: M
- [ ] **T019** — [e2e] Checklist manual, deuda técnica y preparación de los 3 PRs
  - Detail: Completar manual-checklist.md (instaladores Win/mac con `safeStorage` real, Linux sin keyring, reloj desajustado, varias cajas, otro tenant, revocar con la caja abierta y con venta pendiente). Registrar deuda: nonce local, revocación con latencia ≤ 1 h, auto-revocación por reuso, reactivar caja desde el admin, tope de cajas. Orden de PRs y despliegue (backend → POS → admin).
  - Done when: Checklist y deuda documentados; los tres PRs con descripción y test plan.
  - Dependencies: T017
  - Can parallelize with: T018
  - Files affected: AiBuild/feature/pos-device-session/WIP/manual-checklist.md
  - Complexity: S
## Dependency map
```
BACKEND  T001 ─► T002 ─┐
                └► T003 ─► T004 ─► T005
ELECTRON T006 ─► T007
POS      T001 ─► T008 ─► T009 ─► T010 ─► T011 ─► T014
                              └────────┴─► T012 / T013
ADMIN    T004 ─► T015 ─► T016
E2E      T005+T013+T015 ─► T017 ─► T019      T011+T015 ─► T018
```

## Parallelizable groups
- **Group A** (tras T001): T002 ∥ T006 ∥ T008
- **Group B** (tras T003/T004): T015 ∥ T009 ∥ T010 (repos distintos)
- **Group C** (calidad): T005 ∥ T007 ∥ T012 ∥ T016 ∥ T014
- **Group D**: T018 ∥ T019

## Risks and mitigations
| Risk | Probability | Mitigation |
|------|------------|------------|
| Dos refresh concurrentes rompen el secreto rotado | Media | Mutex por tenant en el Next + gracia de 5 min en el backend |
| El Next crashea antes de persistir el secreto rotado | Baja | Persistencia inmediata (IPC) + gracia del secreto anterior |
| La allowlist deja afuera una ruta que usa el POS | Media | Test de contrato T013 que extrae las llamadas reales; smoke E2E |
| `safeStorage` no disponible (Linux sin keyring) | Media | `OMERO_DEVICE_PERSIST=0`: sesión larga solo en memoria + aviso |
| El middleware redirige a `/login` antes de renovar | Alta | Renovación silenciosa en `LoginForm` (T011) verificada en E2E |
| Endpoint local sin guardia | Baja/Aceptado | Decisión del usuario; mitigación futura: nonce por arranque |
| Revocación tarda hasta 1 h en cortar un JWT vigente | Aceptado | Criterio de aceptación; refresh/login rechazan al instante |

## Complexity summary
| Task | S/M/L/XL | Reason |
|------|----------|--------|
| T001 | M | Migración V18 `devices`, entidad, repositorio y `code` en ApiResponse |
| T002 | M | JWT con `scope`/`deviceId` y `DeviceScopeFilter` (lista blanca) |
| T003 | L | `DeviceAuthService` + endpoints públicos (login con device, refresh, sync-token, logout) |
| T004 | M | Administración de cajas (ADMIN): listar, renombrar, revocar |
| T005 | L | Tests de integración del backend (Testcontainers) |
| T006 | M | `device-store` con safeStorage e integración en `process-manager` |
| T007 | S | Verificación real de `safeStorage` con Electron |
| T008 | M | Estado de caja, puente IPC y cliente del backend (`lib/device`) |
| T009 | L | Intercepción del login y endpoints locales de sesión |
| T010 | L | `token-provider` e integración con sender y syncer |
| T011 | L | Renderer: renovación silenciosa, `/login` y logout |
| T012 | L | Tests unit del POS (`lib/device`, sender, syncer) |
| T013 | L | Test de integración del POS + contrato de allowlist |
| T014 | M | Tests de UI del renderer |
| T015 | M | Pantalla `/admin/devices` (cajas) |
| T016 | M | Tests del admin |
| T017 | L | Smoke end-to-end local con los 3 repos |
| T018 | M | Documentación de los tres repos y tech-spec |
| T019 | S | Checklist manual, deuda técnica y preparación de los 3 PRs |
