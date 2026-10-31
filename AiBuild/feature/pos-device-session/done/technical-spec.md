# Technical Spec: Sesión de dispositivo del POS (fase 4)

## Metadata
- **Date:** 2026-09-21
- **Branch:** feature/pos-device-session (3 repos)
- **Based on:** functional-spec.md
- **Status:** WIP

## Hallazgos que condicionan el diseño
1. **El JWT vive en el navegador** (`sessionStorage` + cookies con `maxAge` = tiempo restante). Al vencer, `getAuthToken()` devuelve null y el middleware del POS redirige a `/login` antes de que la UI pueda hacer nada → la renovación debe poder ocurrir **en `/login`** además de en caliente.
2. El Next local corre en un `utilityProcess` de Electron: **`safeStorage` solo existe en el proceso main**; el Next debe pedirle al main que persista/lea el secreto (IPC por `parentPort`).
3. Backend: `refresh_tokens` es 1 por usuario, no rota, no distingue caja y el login lo borra → **no se reutiliza**; la web sigue con él sin cambios. `POST /api/auth/**` es `permitAll`: los endpoints nuevos se autentican por el secreto de la caja.
4. `@TenantId`: un endpoint sin JWT no conoce el tenant → lookup por id global con `JdbcTemplate` y luego `TenantContext.runAs(tenant, …)` **antes** de abrir la transacción (ver CLAUDE.md del backend).
5. El POS también llama al backend de forma directa desde el renderer solo con `NEXT_PUBLIC_API_URL` vacío (mismo origen → proxy); SSE de MercadoPago (`/api/mercadopago/events`) y `polling/start` van por el mismo camino → entran en la lista blanca.

## Architecture and patterns
### Decision: credencial de dispositivo rotativa + JWT `scope` + allowlist en un filtro
```
 Renderer (JWT en sessionStorage)          Next local (desktop)                     Backend
 ─────────────────────────────────         ──────────────────────────────────       ─────────────────────────
 login ─────────────────────────────────► intercepta POST /api/auth/login  ───────► /api/auth/login {+device}
                                            guarda deviceSecret (memoria)  ◄─────── {accessToken, deviceSecret}
                                            ─► parentPort ─► Electron main  (safeStorage → userData)
 ◄──── {accessToken,user}  (sin secreto)
 …1 h después (o al abrir /login)
 POST /api/_local/session/refresh ───────► /api/auth/device/refresh {secret} ─────► valida, ROTA secreto, extiende 14 d
 ◄──── {accessToken,user}                   guarda secreto nuevo ─► main (persist)   ◄── {accessToken, deviceSecret}
 Sender/Syncer (sin renderer) ────────────► token-provider: pos-token || refresh || sync-token
```
- **Backend**: entidad `Device` + `DeviceAuthService`; `JwtService` agrega claims `scope` (`pos`|`sync`) y `deviceId`; `DeviceScopeFilter` (después de `JwtFilter`) impone la lista blanca por `scope`. Tokens sin `scope` (web, login normal) no cambian.
- **POS**: `web/src/lib/device/` (estado, cliente, intercepción del login, endpoints `_local/session`, token-provider) + integración en `syncer`/`outbox-sender`; el renderer renueva en silencio (`useSessionRenewal`) y en `/login`.
- **Electron main**: `device-store.ts` (safeStorage + archivo atómico) e IPC con el Next.
- **Admin**: pantalla `/admin/devices`.
**Descartado:** ver tabla al final.

## Data model
### Nueva tabla `devices` (Flyway V18)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | Va dentro del secreto (`<id>.<random>`) → lookup global sin tenant |
| `tenant_id` | UUID NOT NULL FK | `@TenantId`; índice |
| `client_device_id` | UUID NOT NULL | Generado por la caja; `UNIQUE (tenant_id, client_device_id)` |
| `name` | VARCHAR(100) NOT NULL | Por defecto hostname; editable por el admin |
| `status` | VARCHAR(10) NOT NULL | `ACTIVE` \| `REVOKED` (CHECK). `EXPIRED` **se calcula** (`now > expires_at`) |
| `secret_hash` | CHAR(64) NOT NULL | SHA-256 hex del secreto actual (256 bits de entropía → sin bcrypt) |
| `prev_secret_hash`, `prev_valid_until` | CHAR(64), TIMESTAMPTZ | Gracia de 5 min tras rotar |
| `session_active` | BOOLEAN NOT NULL | `false` tras logout explícito: el refresh exige login; el sync-token no |
| `last_user_id` | UUID FK users | Cajero de la sesión; identidad del JWT emitido |
| `last_used_at`, `expires_at` | TIMESTAMPTZ | `expires_at = now + 14 d` en login y refresh |
| `app_version`, `platform` | VARCHAR | Informativo |
| `created_at`, `revoked_at`, `revoked_by` | TIMESTAMPTZ, UUID | |
| `reuse_detected_at` | TIMESTAMPTZ NULL | Secreto viejo presentado fuera de gracia |
Índices: `(tenant_id)`, `UNIQUE (tenant_id, client_device_id)`. Sin borrado automático (filas mínimas).

### Modificaciones a existentes
- `LoginRequest`: `device` opcional `{deviceId(UUID), name, platform, appVersion}`. `LoginResponse`: `deviceSecret` (`@JsonInclude NON_NULL`). Aditivo: clientes viejos no lo envían ni lo ven.
- `ApiResponse`: campo opcional `code` (NON_NULL) para errores tipificados (`DEVICE_REVOKED`, `LOGIN_REQUIRED`…). Aditivo.
- `JwtService`: `generateDeviceToken(user, device, scope)`; `JwtFilter` publica `scope`/`deviceId` en el request.

### Reglas de estado (backend)
- **Login con `device`**: si la caja existe y está `REVOKED` → 403 `DEVICE_REVOKED` (no inicia sesión). Si no existe → la crea (`ACTIVE`). Si venció → se reactiva. Siempre: rota secreto, `session_active=true`, `last_user_id=user`, `expires_at=now+14d`.
- **`refresh`**: exige `ACTIVE`, `expires_at ≥ now`, `session_active`, usuario habilitado → nuevo JWT `scope=pos` (1 h), **rota secreto**, `expires_at=now+14d`. Errores: 403 `DEVICE_REVOKED`, 401 `DEVICE_EXPIRED`, 401 `LOGIN_REQUIRED`, 401 `DEVICE_SECRET_INVALID`.
- **`sync-token`**: JWT `scope=sync` (1 h), **no rota**. Permitido si (`ACTIVE` y `now ≤ expires_at + 30 d`) o (`REVOKED` y `now ≤ revoked_at + 30 d`); si no, 403 `SYNC_WINDOW_CLOSED`. No exige `session_active`.
- **`logout`**: `session_active=false`.
- **Rotación con gracia**: se acepta el secreto actual o el anterior (≤ 5 min); al aceptar el anterior se emite uno nuevo. Un secreto con `id` conocido y hash que no coincide con ninguno → 401 + `reuse_detected_at=now` (**no revoca**). Comparación en tiempo constante (`MessageDigest.isEqual`).

## API / Contracts
### Backend (públicos, autenticados por el secreto; `permitAll` como el resto de `/api/auth/**`, con el rate limit existente)
```
POST /api/auth/login                 {email,password,device?{deviceId,name,platform,appVersion}}
                                     → {accessToken,refreshToken,expiresIn,user,deviceSecret?}
POST /api/auth/device/refresh        {deviceSecret}
                                     → {accessToken,expiresIn,deviceSecret,deviceExpiresAt,user}
POST /api/auth/device/sync-token     {deviceSecret} → {accessToken,expiresIn}
POST /api/auth/device/logout         {deviceSecret} → 200
Errores: {success:false,error,code}   401/403 según reglas de estado
```
### Backend (ADMIN, JWT normal)
```
GET   /api/devices                   → [{id,name,status(ACTIVE|REVOKED|EXPIRED),lastUsedAt,lastUserName,appVersion,platform,createdAt,expiresAt,revokedAt,reuseDetectedAt}]
PATCH /api/devices/{id}              {name(1..100)} → device
POST  /api/devices/{id}/revoke       → device   (idempotente; 404 de otro tenant)
```
### Lista blanca (`DeviceScopeFilter`)
- `scope=pos`: `GET /api/health`, `GET /api/auth/me`, `GET /api/products`, `/api/products/search`, `/api/products/{code}`, `GET /api/promotions`, `GET /api/business/config[/{key}]`, `GET /api/dashboard/daily-summary`, `GET /api/mercadopago/events`, `GET /api/mercadopago/transactions`, `POST /api/mercadopago/polling/start`, `POST /api/sales`, `POST /api/expenses`, `POST /api/sync/batch`, `POST /api/auth/device/**`. **Todo lo demás → 403**, incluso con usuario ADMIN.
- `scope=sync`: solo `POST /api/sync/batch` y `POST /api/auth/device/**`.
- Sin `scope`: sin restricción (web/admin/login normal).
(La lista se verifica contra las llamadas reales del POS en el build; un test falla si el POS llama a una ruta fuera de la lista.)

### POS local (Next, no se proxean)
```
POST   /api/_local/session/refresh   (sin Authorization) → 200 {accessToken,expiresIn,user}
                                     | 401 {code:LOGIN_REQUIRED|DEVICE_EXPIRED|NO_DEVICE} | 403 {code:DEVICE_REVOKED} | 503 {code:UNAVAILABLE}
GET    /api/_local/session           → {desktop, hasDevice, deviceState}
DELETE /api/_local/session           → logout de la caja (marca session_active=false en el backend, best-effort; conserva el secreto)
POST   /api/auth/login               (interceptado en desktop) inyecta device{…}, guarda deviceSecret y lo QUITA de la respuesta
```
Sin guardia local (decisión): el endpoint de refresh solo responde a 127.0.0.1. Riesgo aceptado: un proceso local podría pedir un JWT `scope=pos`. Mitigación futura: nonce por arranque (Electron → env + preload).

### Electron IPC
- main → Next (al hacer `fork`, por env): `OMERO_DEVICE_ID`, `OMERO_DEVICE_NAME`, `OMERO_APP_VERSION`, `OMERO_DEVICE_SECRETS` (JSON `{tenantId:{secret,sessionActive}}` descifrado), `OMERO_DEVICE_PERSIST=1|0`.
- Next → main: `process.parentPort.postMessage({type:'omero:device-secrets', secrets})` en cada cambio; main persiste.

## Componentes POS (detalle)
- `lib/device/device-state.ts`: mapa en memoria por tenant `{secret, sessionActive}`; carga inicial desde env; `onChange` → puente IPC.
- `lib/device/device-client.ts`: llamadas a `/api/auth/device/*` (timeout, sin reintentos propios).
- `lib/device/token-provider.ts`: `authorize(tenantId)` = token `pos` vigente del syncer (>2 min) → si no, `refresh` (si `sessionActive`) → si `DEVICE_REVOKED/EXPIRED/LOGIN_REQUIRED`, `sync-token`. Serializa (un solo refresh en vuelo por tenant: el secreto rota, dos concurrentes lo romperían).
- `outbox-sender`: usa `authorize()` (async) en vez de `getAuthorization`; con 401 reintenta **una vez** renovando; el estado `unauthorized` solo si tampoco hay credencial de caja.
- `catalog/syncer`: en vez de olvidar un token vencido intenta `renew` (solo tokens `pos`; nunca usa un `sync` para el catálogo).
- Renderer: `useSessionRenewal` (renueva a `exp − 5 min`, al recuperar red/visibilidad y en `/login` si hay caja) + mensaje `?reason=device-revoked|login-required`. `AuthContext.logout` llama `DELETE /api/_local/session`.

## Dependencies
| Package | Version | Purpose | Alternative considered |
|---|---|---|---|
| (ninguna nueva) | — | `safeStorage`/`crypto` de Electron/Node, `MessageDigest`/`SecureRandom` de Java, jjwt existente | keytar (nativo extra, en desuso) |

## Performance
- 1 lookup por PK + 1 UPDATE por refresh (1/h por caja); sin consulta a `devices` en cada request (la revocación surte efecto en el próximo refresh, ≤ 1 h — criterio de aceptación).
- Un refresh en vuelo por tenant (mutex en el Next). Índice `(tenant_id)` para la lista del admin.

## Security
- Secreto: 256 bits aleatorios (`SecureRandom`), guardado **hasheado**; nunca en logs, nunca en el renderer, nunca en `localStorage`; en disco solo cifrado con `safeStorage`. Si `safeStorage` no está disponible o usa `basic_text` (Linux sin keyring) → `OMERO_DEVICE_PERSIST=0`: sesión larga solo en memoria (sin persistencia entre arranques) y aviso en log.
- `scope` impuesto en el servidor (allowlist); un JWT de caja ADMIN no administra nada. Revocación: rechazo en refresh/login inmediato; el JWT vigente muere solo (≤ 1 h).
- Tenant: lookup global por `id` del secreto y `runAs(tenant)`; endpoints admin tenant-scoped (404 cross-tenant). `reuse_detected_at` visible al admin.
- Rate limit: los endpoints `/api/auth/device/*` entran al `RateLimiterInterceptor` existente.
- Riesgos aceptados: sin guardia local (arriba); revocación con latencia ≤ 1 h.

## Compatibilidad y despliegue
- POS nuevo + backend viejo: el login no devuelve `deviceSecret` → sin sesión larga, comportamiento actual.
- POS viejo + backend nuevo: sin `device` en el login → comportamiento actual.
- Orden: backend (V18) → POS/instaladores → admin. Feature flag no necesario (todo aditivo).

## Testing plan (tests_required = true) — Unit + Integración + safeStorage real
### Mandatory coverage
- Backend `DeviceAuthService` (reglas de estado, rotación, gracia, ventanas), `DeviceScopeFilter` (allowlist), hash/comparación.
- POS `lib/device/**` y `outbox-sender`/`syncer` integrados (umbral 85 % ya vigente), main de Electron `device-store` (unit con safeStorage falso).
### Test types
- **Backend (Testcontainers)** `DeviceSessionControllerTest`: login registra caja y devuelve secreto; refresh rota y extiende; gracia (secreto anterior ≤ 5 min ok, luego 401 + `reuse_detected_at`); revocada → 403 en login/refresh; sync-token dentro/fuera de la ventana de 30 d (reloj inyectable); vencida por 14 d; logout; **allowlist** (JWT `pos` de ADMIN → 403 en `/api/products` POST, `/api/sales/review`, `/api/devices`; `sync` solo batch); aislamiento entre tenants; OPERADOR no accede a `/api/devices`; compat: login sin `device` intacto.
- **POS unit/integración**: intercepción del login (secreto quitado de la respuesta), refresh local (todos los códigos), token-provider (mutex, orden pos→refresh→sync), sender/syncer renovando en silencio, reinicio con secreto persistido (env), revocada → sync-token y el outbox sube.
- **Renderer**: `useSessionRenewal`, `/login` con renovación silenciosa, mensajes de caja revocada, logout.
- **Electron**: `scripts/verify-safestorage.cjs` corre `safeStorage` **real** (`electron` con app mínima: cifra, descifra, verifica que el archivo no contiene el secreto en claro) + unit de `device-store` (round-trip, archivo corrupto, sin cifrado disponible).
- **Admin**: lista, renombrar, revocar (con confirmación), estados y permisos.
- **Smoke E2E local** (como la fase 3): backend real + POS desktop + gateway: activar caja, vencer el JWT (reloj/`exp` corto por config de test), renovar, revocar y vaciar el outbox por sync-token, ventana cerrada.

## Explored and discarded alternatives
| Alternative | Why discarded |
|---|---|
| Reusar `refresh_tokens` | 1 por usuario, el login lo pisa, no rota, sin identidad de caja ni revocación individual |
| JWT de caja de semanas (sin refresh) | No revocable hasta que venza; un robo dura semanas |
| Consultar `devices` en cada request | Un hit a DB por request; la latencia de revocación ≤ 1 h ya es criterio aceptado |
| Renovar desde el renderer con el secreto | El secreto pasaría por el renderer (XSS/devtools) |
| Persistir el secreto en el Next (archivo cifrado propio) | La clave quedaría junto al dato; `safeStorage` usa la llave del SO |
| `keytar` | Módulo nativo extra y en desuso; `safeStorage` viene con Electron |
| bcrypt/argon para el secreto | El secreto ya tiene 256 bits de entropía; SHA-256 basta y evita costo por refresh |
| Nonce por arranque para el endpoint local | Elegido **no** hacerlo por ahora (decisión del usuario); queda como mitigación futura |
| Auto-revocar ante reuso | Un crash legítimo antes de persistir bloquearía la caja; se avisa al admin |
| Reactivar caja revocada desde el admin | Fuera de alcance (se registra una caja nueva iniciando sesión) |

## Technical flow — renovación con sender
```
sender.authorize(tenant)
  ├─ syncer.token vigente (>2 min)? ─► usa (scope pos)
  ├─ device.sessionActive? ─► POST device/refresh ─► ok: syncer.remember(pos) + persist secreto rotado
  │        └─ 403 DEVICE_REVOKED / 401 EXPIRED / LOGIN_REQUIRED ─► POST device/sync-token ─► ok: usa (scope sync)
  │                                                                └─ 403 SYNC_WINDOW_CLOSED ─► estado "unauthorized" (outbox intacto)
  └─ sin secreto de caja ─► estado "unauthorized" (login manual, como hoy)
```

## Open questions (para el plan)
- Nombre por defecto de la caja si el hostname está vacío (`Caja <últimos 4 del id>`).
- Texto exacto de los mensajes de caja revocada/vencida en el login.

---

## Addendum — decisiones tomadas durante el build (2026-09-21)

Lo construido coincide con el contrato de arriba salvo lo siguiente:

**Backend**
- Los hashes son `VARCHAR(64)` (no `CHAR`): Hibernate `validate` no acepta `CHAR(64)` como `VARCHAR`.
- `DeviceTxService` usa `noRollbackFor = ApiException` para que el rechazo por secreto viejo persista `reuse_detected_at`.
- No se agregó rate limit a `/api/auth/device/*`: el `RateLimiterInterceptor` existente es solo de registro (5/h/IP); el secreto de 256 bits hace inviable la fuerza bruta. Queda en la deuda.
- El login con `device` se registra en `AuthService.login` **antes** de emitir tokens (una caja revocada no inicia sesión y no se toca `refresh_tokens`).
- `ApiResponse.code` es aditivo (`NON_NULL`) y `ApiException` acepta un `code`.
- La lista blanca real está en `DeviceScopeFilter`; `POST /api/auth/**` es válido para cualquier scope (un `Bearer` viejo no bloquea el login).

**POS / Electron**
- `device-wiring.ts` cablea `DeviceSession` ↔ `CatalogSyncer` (`setSink`/`setRenewer`) para evitar un ciclo de imports; `rememberSession` (outbox-runtime) lo invoca.
- `DeviceState.resolveTenant(hint)`: la renovación local no trae `Authorization`; el tenant sale de una pista (JWT vencido del renderer), de la última sesión, o del único tenant con sesión activa tras un reinicio.
- El sender reintenta **una vez** ante 401/403 renovando (`authRetried`); y un "online" durante un envío que falla reintenta ya (`forceAgain`) — carrera latente de la fase 3 corregida.
- El `token-provider` cachea el token `sync` hasta 2 min antes de vencer; un token `sync` emitido sigue valiendo hasta que vence (la ventana de 30 días gobierna la emisión).
- El renderer manda el JWT vencido a `/api/_local/session/refresh` solo como **pista de tenant** (el servidor no lo acepta como credencial).
- `npm run verify:safestorage` compila y corre un script con el Electron real (no un mock).

**Admin**
- La revocación no se puede deshacer desde el admin (fuera de alcance); una caja revocada solo se puede renombrar.

**Verificación**: backend 185 tests; POS 686 (`lib/device/**` ≥ 99 %); admin 178; Electron 40 (100 % en `device-store`); smoke E2E 20/20 contra el backend real; `safeStorage` real verificado en macOS.
