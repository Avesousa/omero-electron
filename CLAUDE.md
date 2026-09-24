# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**omero-electron** es el proyecto del **POS de Omero**, independiente del admin (`omero`). Contiene dos paquetes:

- **`web/`** — app Next.js del POS. Un mismo build corre en dos modos (`OMERO_RUNTIME`):
  - `web`: servicio en Railway (Root Directory `web/`), se usa desde el navegador.
  - `desktop`: lo levanta Electron en `127.0.0.1:3000` dentro del instalador.
  En ambos, `/api/*` se reenvía al `omero-backend` de Railway con un **proxy en runtime** (`BACKEND_URL`).
- **`main/`** — wrapper de Electron (frameless, teclado numérico). Ya **no** incluye Java/JRE/JAR: solo levanta el Next local.

Si `omero` (admin) cae, el POS sigue funcionando. En **desktop** el Next mantiene una **caché SQLite de solo lectura del catálogo** (productos y promociones, una base por tenant) que sirve las lecturas cuando el backend no responde (fase 2). En **desktop** las ventas y gastos se guardan primero en un **outbox SQLite** y se suben en segundo plano (fase 3). En **desktop** la caja tiene una **sesión de dispositivo** de 14 días deslizante, renovable en silencio, revocable desde el admin y limitada al POS (fase 4).

## Commands

```bash
# Electron (raíz)
npm run dev               # Electron cargando OMERO_POS_URL (default http://localhost:3000/pos)
npm run typecheck         # tsc --noEmit
npm test                  # vitest (main/*.test.ts)
npm run check             # typecheck + tests con cobertura
npm run fetch:native      # descarga los binarios de better-sqlite3 para el ABI de Electron (checksums fijados)
npm run verify:native     # carga el binario con el ABI REAL de Electron (ELECTRON_RUN_AS_NODE)

# POS (web/)
npm run dev:web           # = npm --prefix web run dev
npm --prefix web run check   # typecheck + tests con cobertura (umbral 85 % en runtime, backend-proxy, data-layer y catalog/**)

# Instalador (requiere OMERO_DEFAULT_BACKEND_URL)
npm run build:win         # Windows NSIS x64
npm run build:mac         # macOS DMG universal
npm run prepare:app       # build:config + fetch:native + build:web + prepare:frontend + verify:native (sin electron-builder)
```

`build:*` encadenan: `build:config` → `build:web` → `prepare:frontend` → `tsc` → `electron-builder`. Nunca correr `electron-builder` directo.

## Architecture

```
main/                         Electron (CommonJS, tsc → dist/main)
├── main.ts                   splash → isPortFree(3000) → startFrontend → waitForFrontend → ventana
├── process-manager.ts        utilityProcess.fork(resources/frontend/server.js); espera /api/_local/health;
│                             inyecta OMERO_DATA_DIR (<userData>/catalog-cache) y OMERO_SQLITE_BINDING (resources/native/…)
├── paths.ts                  RESOURCES_DIR (process.resourcesPath empaquetado: correcto en Windows y macOS)
├── config.ts                 POS_URL, resolveBackendUrl(env, buildConfig) — pura, 100 % testeada
├── build-config.ts           lee resources/build-config.json (default del backend embebido)
├── keyboard.ts               bloquea F1 a nivel Electron (el resto lo filtra el renderer)
├── preload.ts                contextBridge: electronAPI.isElectron / .platform
└── logger.ts                 electron-log + Better Stack opcional

web/                          Next.js 16 (ESM, standalone). Su propio package.json (npm)
├── src/app/pos, login/       POS y login — COPIADOS de omero (ver web/README.md)
├── src/app/api/[...path]/    proxy → proxyToBackend()
├── src/app/api/%5Flocal/health/       GET /api/_local/health (readiness local, NO se proxea)
├── src/app/api/%5Flocal/connectivity/ GET  → estado del backend + de la caché (solo VERIFICA conexión)
├── src/app/api/%5Flocal/cache/        DELETE → borra la base del tenant (logout)
├── src/lib/runtime.ts        getRuntime(), getBackendUrl(), getProxyTimeoutMs()
├── src/lib/backend-proxy.ts  proxyToBackend(request)
├── src/lib/data-layer.ts     handleApiRequest(): web → proxy directo; desktop → outbox (POST /api/sales|expenses) o proxyWithCatalog
├── src/lib/outbox/           outbox de ventas/gastos (ver sección abajo)
├── src/lib/device/           sesión de la caja: estado, cliente, token-provider (ver sección abajo)
├── src/lib/catalog/          caché SQLite del catálogo (ver sección abajo)
├── src/instrumentation*.ts   valida entorno al arrancar (process.exit(1) si es inválido)
└── Dockerfile, railway.toml  modo web
```

### Proxy `/api/*` (web/src/lib/backend-proxy.ts)

- Lee `BACKEND_URL` en **runtime** (los `rewrites` de Next se resuelven en build, por eso no se usan).
- Destino = origen configurado + path `/api/...`; rechaza (400) cualquier otro path/origen.
- **No reenvía** hop-by-hop, `host`, `content-length`, **`origin` ni `referer`** (llamada servidor-a-servidor: el backend aplica CORS con `CORS_ALLOWED_ORIGINS` y rechazaría el origen del POS). `Authorization` sí.
- Streaming sin bufferizar (SSE de MercadoPago, multipart). El `content-encoding`/`content-length` de respuestas comprimidas se elimina (fetch ya descomprimió).
- Timeout hasta headers `PROXY_TIMEOUT_MS` (30 s); sin timeout una vez que llegan (SSE). Cancelación del cliente aborta el upstream.
- Errores propios con contrato `{ success:false, error }`: 502 (inalcanzable), 504 (timeout), 400 (ruta), 500 (config).
- **App Router**: una carpeta `_local` sería privada (sin ruta); por eso la carpeta se llama `%5Flocal` y la URL es `/api/_local/health`.

### Caché SQLite del catálogo (fase 2, solo desktop)

`web/src/lib/catalog/`: `cache-policy` (qué rutas), `tenant` (JWT → tenantId), `migrations` + `sqlite-store` (una base por tenant),
`store-registry` (carga lazy de `better-sqlite3`, degrada a null), `catalog-proxy` (read-through + fallback), `syncer` (refresco) y
`connectivity` (`GET {BACKEND_URL}/api/health`).

- **Rutas cacheadas:** solo `GET /api/products` y `GET /api/promotions` (sin query) y `GET /api/products/{code}` con código **numérico**
  (así `/search` y `/bulk-upload` no se capturan). El resto pasa por el proxy.
- **Con conexión:** el 200 del backend pasa tal cual y actualiza SQLite (snapshot **completo y transaccional**, hash-skip si no cambió;
  el backend no tiene `updatedSince` y borra físicamente, así se detectan eliminados). **Sin conexión** (502/503/504, que incluye red caída y
  timeout mapeados por el proxy) y con datos locales: 200 con `X-Omero-Cache: hit` + `X-Omero-Cache-At`/`-Age`. 401/403/404/500 pasan sin tocar.
- **Syncer:** cada 5 min (`CATALOG_SYNC_INTERVAL_MS`) refresca con el último `Authorization` de cada tenant, guardado **solo en memoria**;
  si falla entra en recuperación (sondea `/api/health` cada 30 s y sincroniza al volver). 401 o token vencido → olvida el token.
- **Almacenamiento:** `<OMERO_DATA_DIR>/<tenantId>.sqlite` (JSON crudo por ítem; `PRAGMA user_version` + migraciones; base corrupta o de esquema
  más nuevo → se elimina y recrea). El tenant sale del claim `tenantId` **sin verificar la firma** y solo elige el archivo (UUID validado).
- **UI (POS):** en desktop el header muestra `ConnectionStatus` **solo** sin conexión o con pendientes; su botón "Actualizar" **solo verifica la
  conexión** (no sincroniza). En web el header conserva el botón de refresco de productos. El logout llama `DELETE /api/_local/cache`; el 401 por
  expiración **no** borra la caché.
- **Degradación:** modo web, sin `OMERO_DATA_DIR` (producción), módulo nativo ausente/ABI equivocado o directorio sin permisos → pass-through
  sin error (la caché jamás rompe una request).
- **Limitación (resuelta en la fase 4):** el JWT dura 1 h; con caja registrada se renueva solo (ver "Sesión de dispositivo"). Sin caja (web, backend viejo) sigue pidiendo login.

### Outbox de ventas y gastos (fase 3, solo desktop)

`web/src/lib/outbox/`. Toda venta/gasto se confirma al cajero **después de escribirse en SQLite** y un sender la sube al backend en segundo plano.

- **Intercepción** (`outbox-proxy` + `data-layer`): `POST /api/sales` y `POST /api/expenses` en desktop → valida liviano, arma el payload con **lista blanca** (jamás viaja el costo; el backend lo resuelve), lo inserta en el outbox y responde `201 { id:null, clientId, queued:true, createdAt, … }`. Sin tenant/token, sin outbox o con error de disco devuelve `null` → proxy directo (degradación sin error). En web **nunca** intercepta.
- **Base** (`outbox-store`, `outbox-migrations`, `outbox-registry`): `<OMERO_DATA_DIR>/<tenantId>.outbox.sqlite` (archivo distinto de la caché), `synchronous=FULL`, WAL. Filas `PENDING → SENT | REVIEW | FAILED` con `client_id` UUID único (idempotencia), `created_at` = hora de la caja. Base corrupta o de esquema más nuevo → se aparta a `.corrupt-<ts>`, **nunca se borra**. Retención: `SENT` 7 d; `REVIEW` y `FAILED` descartados 30 d. **El logout borra la caché de catálogo pero NO el outbox.**
- **Sender** (`outbox-sender`): lotes de hasta 50 (más viejo primero) → `POST {BACKEND_URL}/api/sync/batch`. Reintentos de transporte (red/timeout/5xx/404/respuesta inválida) a **30 s → 90 s → 270 s → 810 s y luego cada 810 s**; un lote exitoso reinicia la cuenta; `413` parte el lote. Por ítem: `CREATED/DUPLICATE` → `SENT` (o `REVIEW` si el backend lo marcó), `REJECTED/VALIDATION` → `FAILED` (sin reintento), `INTERNAL_ERROR` → sigue `PENDING`. **401/403 → se detiene y olvida el token** (`backend:"unauthorized"`; lo pendiente no se pierde); 404 → `unsupported`. Nunca sube con el token de otro tenant. Estados en `GET /api/_local/outbox` (`backend`, `nextAttemptAt`).
- **Token**: sale del `CatalogSyncer` (solo en memoria, `getAuthorization`). `rememberSession()` (`outbox-runtime`) crea el sender **antes** de registrar el token: el evento "token nuevo" es lo que sube los pendientes tras reiniciar la caja. El syncer publica `online` (al recuperar conexión → reintento inmediato) y `authorization`.
- **Stock mostrado** (`stock-adjust`): en `GET /api/products` y `/{code}` (en vivo y desde caché) = stock del backend − ventas `PENDING` (o enviadas después del snapshot − 2 s), piso 0, el código `000` no se ajusta. Solo ajusta la **respuesta**; la caché guarda el valor crudo.
- **Endpoints locales** (no se proxean; tenant del JWT): `GET /api/_local/outbox` (`counts`, `backend`, `items` sin payload; `?status=`, `?limit=`, `?detail=<clientId>` con payload), `POST /api/_local/outbox/import` (cola vieja de localStorage, idempotente por `clientId` derivado), `POST /api/_local/outbox/{clientId}/dismiss` (un `FAILED` deja de contarse). `GET /api/_local/connectivity` suma `outbox:{pending,review,failed,backend,nextAttemptAt}`. En web/sin outbox responden `available:false`.
- **Configuración offline**: la caché de catálogo también guarda `mp_offline` (`settings`). En el POS, el botón MercadoPago se bloquea sin conexión salvo `mp_offline` (`useBusinessFlag`, `PaymentModal`); el negocio lo activa en el admin.
- **UI**: `ConnectionStatus` (chips "N pendientes sin sync" / "N para revisar", "Sesión vencida: iniciá sesión…"), `OutboxListModal` (lista y "Entendido" para rechazos), `useOutboxStatus` (5 s con pendientes / 20 s en reposo). Cerrar sesión con pendientes pregunta antes (no los borra). `useSales` hace **un solo intento** (sin reintentos ni `localStorage`); `useOfflineQueue` solo **migra** la cola vieja (desktop → import al outbox; web → la sube una vez).
- **Limitación conocida**: el JWT dura 1 h y no se renueva; pasada la hora hay que iniciar sesión para subir lo pendiente (fase 4: sesión de dispositivo de semanas, revocable).
- Tests: unit por módulo + `outbox.integration.test.ts` (backend HTTP falso + SQLite real: envío, `DUPLICATE`, mixto, red caída, 401 y reanudación, 404, reinicio, aislamiento de tenants, cola vieja, web y degradación). `npm --prefix web run check` (umbral 85 % también en `lib/outbox/**`).

### Sesión de dispositivo de la caja (fase 4, solo desktop)

`main/device-store.ts` (Electron) + `web/src/lib/device/` (Next local) + `web/src/lib/{deviceSession,useSessionRenewal}.ts` (renderer). Resuelve el JWT de 1 h: la caja se registra al hacer login y renueva sola su sesión.

- **Identidad y secreto** (Electron main): `device-id` (UUID plano, no secreto) y `device-session.bin` (secretos por tenant **cifrados con `safeStorage`**: Keychain/DPAPI) en `<userData>/device/`. `safeStorage` solo existe en el main, así que `process-manager` descifra al arrancar y pasa al Next por env `OMERO_DEVICE_ID/NAME/PLATFORM/SECRETS/PERSIST` y `OMERO_APP_VERSION`; el Next avisa cada cambio por IPC (`parentPort` → `omero:device-secrets`) y el main lo persiste (debounce, escritura atómica). Sin cifrado del SO (o Linux `basic_text`) **no se persiste**: la sesión larga vive solo en memoria. Archivo ilegible → se aparta a `.corrupt-<ts>`, nunca se borra.
- **Login** (`session-proxy`): `POST /api/auth/login` se intercepta en desktop, agrega `device{…}`, guarda el `deviceSecret` y lo **quita de la respuesta** (el renderer nunca ve el secreto; solo recibe el JWT de 1 h). Sin identidad de caja (web / dev sin Electron) o con un backend viejo → comportamiento de siempre.
- **Renovación** (`device-session`, un refresh en vuelo por tenant porque el secreto **rota** en cada uno): `POST /api/_local/session/refresh` (sin Authorization; el tenant sale de una pista o de la última sesión) → 200 `{accessToken,expiresIn,user}` | 401 `LOGIN_REQUIRED|DEVICE_EXPIRED|NO_DEVICE` | 403 `DEVICE_REVOKED` | 503 `UNAVAILABLE`. `GET/DELETE /api/_local/session` (estado de la caja y logout: conserva el secreto para subir lo pendiente, renovar exige un nuevo login). **Sin guardia local** (decisión): riesgo aceptado, mitigación futura = nonce por arranque.
- **Outbox** (`token-provider`): `authorize(tenant)` = JWT `pos` vigente (>2 min) → `refresh` → (revocada / vencida / sin sesión) **`sync-token`** (JWT `scope=sync`, solo `/api/sync/batch`, ventana de 30 d) → `unauthorized` (el outbox no se toca). El sender reintenta **una vez** ante un 401/403 renovando; el `syncer` renueva en vez de olvidar un token vencido (solo con tokens `pos`). Un "volvió la conexión" durante un envío que falla reintenta ya (`forceAgain`). `device-wiring` cablea sesión ↔ syncer sin ciclos de imports (`rememberSession` lo invoca).
- **Renderer**: `useSessionRenewal` agenda la renovación a `exp − 5 min` (y al recuperar red / volver a la pestaña); `LoginForm` renueva en silencio al montar (el middleware nos manda a `/login` apenas vence el JWT) y muestra el motivo (`?reason=device-revoked|device-expired|login-required`); `logout` llama `DELETE /api/_local/session`. Web: nada cambia.
- **Alcance**: el backend impone la lista blanca del POS (`scope=pos`). `web/src/lib/device/allowlist.contract.test.ts` **extrae las rutas `/api/...` que el POS llama y falla si alguna no está en la lista**: si el POS agrega una llamada nueva, agregarla también en `DeviceScopeFilter` del backend.
- Comandos: `npm run verify:safestorage` (compila y corre `safeStorage` **real** con Electron: cifra/descifra, comprueba que el archivo no tiene el secreto en claro; requiere sesión gráfica).
- Tests: `main/device-store.test.ts` (100 %), unit de `lib/device/**` (≥ 99 %), `device.integration.test.ts` (backend HTTP falso: activación, renovación con JWT vencido, rotación y reinicio, revocada → sync-token, ventana cerrada, logout, aislamiento de tenants, web/backend viejo), renderer (`useSessionRenewal`, `LoginForm`, `deviceSession`, logout).

### Empaquetado del módulo nativo

Hay **tres ABIs distintos**: Node del sistema (dev), Node 20 de Docker/CI y **Electron 40 = ABI 143**. Un `.node` con ABI equivocado no carga.
- `better-sqlite3` **12.11.1 exacta** en `web/` como `optionalDependencies` (la 13.x no publica binarios y exige Node ≥22; Electron 41+ aún sin binarios 12.x).
- `scripts/fetch-native.mjs` baja los binarios de Electron para win32-x64, darwin-arm64 y darwin-x64 a `resources/native/`, verificados contra
  `scripts/native-checksums.json` (`--update` para registrar; revisar el diff). `scripts/verify-native.mjs` los carga con el Electron real.
- `better-sqlite3` se carga con **`createRequire`** (no con un `require` estático): así Turbopack no lo resuelve en build y el modo web/Docker compila
  aunque la dependencia opcional no esté instalada (con `require` estático el build de Docker fallaba: `Module not found`). Consecuencia: Next **no lo traza**
  al standalone; `prepare-frontend.mjs` copia explícitamente `lib/` y `package.json` (~60 KB) desde `web/node_modules`, sin el `.node` (ABI de Node).
  En runtime se usa `OMERO_SQLITE_BINDING` (`better_sqlite3-${platform}-${arch}.node`, elegido por `process.arch`; el DMG universal lleva los dos de macOS).

## Dev vs. Packaged Behavior

**Dev** (`npm run dev`): Electron carga `OMERO_POS_URL` (default `http://localhost:3000/pos`) y **no** administra procesos; hay que levantar `npm run dev:web` aparte (`web/.env.local` desde `web/.env.example`). `./dev.sh up` levanta el Next de `omero` también en :3000: usar `PORT=3001` para el POS de este repo.

**Packaged**: splash → verifica puerto 3000 libre (si no, diálogo y salida) → `startFrontend()` con `OMERO_RUNTIME=desktop` y `BACKEND_URL` (env override > `resources/build-config.json`) → `waitForFrontend()` (falla rápido si el Next muere) → ventana. Si no hay URL de backend: diálogo "Configuración incompleta".

## Environment Variables

| Variable | Dónde | Propósito |
|---|---|---|
| `OMERO_RUNTIME` | Next | `web` \| `desktop`, obligatoria (Electron inyecta `desktop`) |
| `BACKEND_URL` | Next / Electron | Origen del omero-backend (sin path). En desktop es override del default del build |
| `PROXY_TIMEOUT_MS` | Next | Timeout hasta headers (default 30000) |
| `OMERO_DEFAULT_BACKEND_URL` | build | Se embebe en `resources/build-config.json` |
| `OMERO_DATA_DIR` | Next (desktop) | Carpeta de las bases SQLite. Electron: `<userData>/catalog-cache`. Dev sin definir → `web/.data`; producción sin definir → sin caché |
| `OMERO_SQLITE_BINDING` | Next (desktop) | Ruta al `.node` de Electron; sin definir se usa el binding por defecto (dev con Node del sistema) |
| `CATALOG_SYNC_INTERVAL_MS` | Next (desktop) | Refresco de la caché (default 300000) |
| `OMERO_DEVICE_ID/NAME/PLATFORM`, `OMERO_APP_VERSION` | Next (desktop) | Identidad de la caja; los inyecta Electron (sin `OMERO_DEVICE_ID` válido no hay sesión de dispositivo) |
| `OMERO_DEVICE_SECRETS`, `OMERO_DEVICE_PERSIST` | Next (desktop) | Secretos descifrados por Electron (JSON por tenant) y si se pueden persistir (`1`/`0`); **no definir a mano en producción** |
| `OMERO_POS_URL` | Electron dev | URL de la ventana |
| `BETTERSTACK_TOKEN` | Electron | Logs remotos opcionales |

No definir `NEXT_PUBLIC_API_URL` en el POS (mismo origen + proxy).

## Bundled Resources

`electron-builder` empaqueta desde `resources/` (todo generado, ignorado por git):
- `frontend/` — Next standalone (`npm run prepare:frontend`: `web/.next/standalone` + `.next/static` + `public`)
- `native/` — binarios de better-sqlite3 (ABI de Electron) por plataforma/arquitectura (`npm run fetch:native`)
- `build-config.json` — `{ defaultBackendUrl }` (`npm run build:config`)
- `betterstack.token` (opcional, gitignored)

## Build Targets

- **Windows**: `release/omero-pos-setup.exe` (NSIS x64). **macOS**: `release/omero-pos.dmg` (universal).
- Sin firma de código. CI: `.github/workflows/installer.yml` (tags `v*.*.*`), requiere la variable de repo `OMERO_DEFAULT_BACKEND_URL`.

## Key Gotchas

- **npm 10.9 (arborist)** falla con `Cannot read properties of null (reading 'edgesOut')`: `.npmrc` con `legacy-peer-deps=true` en la raíz y en `web/`. `npm ls` no muestra peers inválidos.
- **Next no termina el proceso si falla `instrumentation`**: por eso `instrumentation-node.ts` hace `process.exit(1)` si la env es inválida (Railway reinicia; Electron lo detecta).
- **El POS copiado diverge de `omero`**: no arreglar solo en un lado sin decidir; origen y commit en `web/README.md`.
- **Sesión no compartida** con el admin (orígenes distintos): el cajero inicia sesión en el POS.
- **Electron 40** (Node 24, ABI 143): 33 estaba fuera de soporte. Electron ≥38 exige **macOS 12+**. Subir de versión implica revisar los binarios de `better-sqlite3` (ABI) y `native-checksums.json`.
- **No usar `npm ci --omit=optional`** en el Dockerfile del POS: omite TODAS las optionals, incluidas las binarias de Tailwind 4 (`lightningcss-*`) y de SWC de Next, y rompe el build.
- **`resources/` en macOS** es `Contents/Resources`, no `dirname(exe)/resources`: usar siempre `RESOURCES_DIR` (`main/paths.ts`). La fase 1 asumía Windows.
- **SQLite y orden:** `upsert` usa `ON CONFLICT DO UPDATE`; `INSERT OR REPLACE` borra y reinserta la fila y la mueve al final, alterando el orden de la lista del backend.
- **Auto-updater** de Electron sigue inactivo (`publish: null`); requiere code signing.
- Solo F1 se bloquea en Electron; el resto del filtrado está en el renderer (`useKeyboard.electron.ts`).
- Windows: `javaw.exe`/JRE ya no existen; no debe aparecer ningún proceso `java`.

## Pendientes registrados

- **Migración de datos H2 → Railway** de las instalaciones actuales (rama `master`, con Java+H2) antes de actualizarlas.
- Eliminar `/pos` de `omero` tras validar este POS.
- Idea futura: tabla de sobreventas (hoy el stock se limita a 0 y no queda registro de lo vendido de más).
- Node 20 (Docker/CI del POS web) está fuera de soporte; el desktop corre en Node 24. Base SQLite sin cifrar (SQLCipher fuera de alcance).

## SDD Features

### pos-standalone-next-web-mode (added 2026-09-21, branch: feature/pos-standalone-next-web-mode, commit b8f58be)

#### What it does
Fase 1 de separar el POS del admin: `omero-electron` contiene el Next del POS (`web/`) que corre en modo **web** (Railway) o **desktop** (Electron, sin Java) y en ambos reenvía `/api/*` al `omero-backend` de Railway con un proxy en runtime.

#### Key files
- `web/src/lib/backend-proxy.ts` — `proxyToBackend()`: proxy con streaming (SSE/multipart), anti-SSRF, sin `Origin`/`Referer`.
- `web/src/lib/runtime.ts` — `getRuntime()`, `getBackendUrl()`, `getProxyTimeoutMs()` (leen `process.env` al llamarse).
- `web/src/instrumentation-node.ts` — valida el entorno al arrancar y sale con código 1 si es inválido.
- `web/src/app/api/[...path]/route.ts` y `api/%5Flocal/health/route.ts` — proxy y readiness local.
- `main/process-manager.ts`, `main/config.ts`, `main/build-config.ts` — Electron levanta el Next local; `resolveBackendUrl()`.
- `scripts/prepare-frontend.mjs`, `scripts/write-build-config.mjs` — empaquetado del instalador.
- `web/Dockerfile`, `web/railway.toml`, `.github/workflows/installer.yml`.

#### Technical decisions
- Proxy como route handler en runtime (no `rewrites`): permite override de `BACKEND_URL` en desktop y es la base de las fases 2-3.
- No se reenvía `Origin`/`Referer`: el backend aplica CORS por lista y rechazaría el origen del POS.
- Dos paquetes (`main/` CommonJS y `web/` ESM), npm en ambos, `legacy-peer-deps` por bug de arborist.
- POS duplicado desde `omero` (no compartido) hasta el rediseño; el origen se documenta en `web/README.md`.
- Modo por `OMERO_RUNTIME` explícito; `BACKEND_URL` solo origen, validado igual en Electron y Next.

#### How it works
Desktop: `main.ts` verifica el puerto 3000 → `startFrontend()` forkea `resources/frontend/server.js` (`OMERO_RUNTIME=desktop`, `BACKEND_URL`) → `waitForFrontend()` consulta `/api/_local/health` → abre `localhost:3000/pos`. Web: el mismo standalone en Railway. El navegador llama `/api/*` del mismo origen; `proxyToBackend` construye el destino con el origen de `BACKEND_URL`, filtra headers, transmite el body y devuelve la respuesta (descomprimida, sin `content-encoding`).

#### Useful commands
```bash
npm --prefix web run check        # typecheck + tests (92) con cobertura
npm run check                     # Electron: typecheck + tests (16)
OMERO_DEFAULT_BACKEND_URL=https://<backend> npm run build:win
docker build web/                 # imagen del modo web
```

#### TODOs / Technical debt
- [ ] Migración de datos H2 → Railway de las instalaciones actuales (rama `master`) antes de actualizarlas.
- [ ] Eliminar `/pos` de `omero` tras validar este POS (PR aparte); `NEXT_PUBLIC_POS_URL` ya está en la rama `feat/pos-external-url` de `omero`.
- [ ] Verificación manual: instalador Windows/macOS y deploy en Railway (`AiBuild/.../done/manual-checklist.md`).
- [ ] CI de PR (solo hay workflow por tags); `middleware.ts` usa la convención deprecada de Next 16.
- [ ] Fases 2 (SQLite caché), 3 (outbox, `mp_offline`, ventas a revisar) y 4 (sesión de dispositivo larga).

**Archivo de specs:** `AiBuild/feature/pos-standalone-next-web-mode/done/`

### pos-sqlite-catalog-cache (added 2026-09-21, branch: feature/pos-sqlite-catalog-cache, commit dea94ac)

#### What it does
Fase 2: en modo desktop el Next del POS mantiene una **caché SQLite de solo lectura del catálogo** (productos y promociones, una base por tenant) y la sirve cuando el backend no responde; el POS avisa "Sin conexión" con un botón que solo verifica la conexión. Incluye la actualización de Electron 33 → 40. Detalle en las secciones "Caché SQLite del catálogo" y "Empaquetado del módulo nativo" de este archivo.

#### Key files
- `web/src/lib/data-layer.ts` — `handleApiRequest()`: web → proxy directo; desktop → `proxyWithCatalog` (punto de extensión de la fase 3).
- `web/src/lib/catalog/{cache-policy,tenant,migrations,sqlite-store,store-registry,catalog-proxy,syncer,connectivity,snapshot,types}.ts`.
- `web/src/app/api/%5Flocal/{connectivity,cache}/route.ts` — endpoints locales.
- `web/src/app/pos/{hooks/useConnectionStatus.ts,components/ConnectionStatus.tsx,page.tsx}` y `web/src/shared/contexts/auth.tsx` (logout borra la caché).
- `main/{paths,process-manager}.ts`, `scripts/{fetch-native,verify-native,prepare-frontend}.mjs`, `scripts/native-checksums.json`.

#### Technical decisions
- Snapshot completo por sync (el backend no tiene `updatedSince` y borra físicamente); guarda el JSON crudo para servir el DTO exacto.
- `better-sqlite3` 12.11.1 exacta, opcional, cargada con `createRequire`; binarios de Electron (ABI 143) por plataforma/arquitectura con checksum fijado.
- Electron 40 (33 sin soporte); techo por disponibilidad de binarios de `better-sqlite3` 12.x. `node:sqlite` sigue experimental.
- El tenant sale del JWT sin verificar la firma y solo elige el archivo local; el token vive solo en memoria.
- Limitación aceptada: JWT de 1 h sin renovar (lo resuelve la fase 4).

#### How it works
El route handler `/api/*` llama a `handleApiRequest`. En desktop, para las 3 lecturas de catálogo hace read-through: 200 → actualiza SQLite; 502/503/504 con datos locales → 200 con `X-Omero-Cache: hit`; otros estados pasan sin tocar. Un syncer en el proceso del Next refresca cada 5 min y, tras un fallo, sondea `/api/health` cada 30 s. El header del POS consulta `/api/_local/connectivity` (30 s, eventos online/offline). Cualquier fallo de la caché degrada a pass-through.

#### Useful commands
```bash
npm --prefix web run check     # typecheck + 299 tests con cobertura
npm run fetch:native           # binarios de better-sqlite3 para Electron (--update para registrar checksums)
npm run verify:native          # los carga con el Electron real (ELECTRON_RUN_AS_NODE)
OMERO_DEFAULT_BACKEND_URL=https://<backend> npm run prepare:app   # arma resources/ sin electron-builder
```

#### TODOs / Technical debt
- [ ] Verificación manual: Electron 40 (numpad/F1/foco), aviso en pantalla, instaladores Windows y macOS (arm64 e Intel) — `AiBuild/.../done/manual-checklist.md`.
- [ ] Fase 3: outbox de ventas/gastos, `mp_offline`, ventas a revisar en admin, stock en 0. Fase 4: sesión de dispositivo de semanas.
- [ ] Node 20 (Docker/CI del POS web) fuera de soporte; `electron-builder` 25 sin probar empaquetando con Electron 40; base SQLite sin cifrar.
- [ ] Migración H2 → Railway de instalaciones actuales; eliminar `/pos` de `omero`; `middleware` → `proxy` de Next 16.

**Archivo de specs:** `AiBuild/feature/pos-sqlite-catalog-cache/done/`

### roles-permisos-fundacion (added 2026-09-22, branch: feature/roles-permisos-fundacion)

#### What it does
Mismo catálogo de permisos que `omero`/`omero-backend`, disponible en el contexto de auth del POS de
escritorio. Contrato completo en `omero-backend` (ver su CLAUDE.md, sección "Sistema de permisos
granulares"). No gatea ninguna acción del POS todavía — no existe ninguna hoy — queda la
infraestructura lista para cuando se decida cuál requiere permiso (spec futuro).

#### Key files
- `web/src/shared/permissions.ts` — copia idéntica de `omero/src/shared/permissions.ts` (mismo
  backend, mismo catálogo), con su propio `permissions.contract.test.ts`.
- `web/src/shared/hooks/useHasPermission.ts` — sobre `useAuth().user.permissions`.
- `web/src/lib/device/device-client.ts` (`DeviceUser`) y `web/src/shared/types/auth.ts` (`User`) —
  suman `permissions: string[]`.

#### Technical decisions
- **Los permisos SÍ se actualizan en cada rotación silenciosa de la sesión de caja** (no recién al
  relogin del cajero, a diferencia de la web): `DeviceTxService.refresh` en el backend ya devolvía
  `user` fresco en cada rotación antes de este spec — se le sumó `permissions` con el mismo criterio.
  Con una sesión de 14 días, esperar al relogin para propagar una revocación sería demasiado lento.
- Catálogo duplicado a mano (no compartido vía paquete) — mismo criterio que el resto del POS
  ("copiado desde `omero`, no compartido hasta el rediseño", ver `web/README.md`).

#### How it works
`session-api.ts` (`/api/_local/session/refresh`) y `device-session.ts` pasan `user` (con
`permissions`) tal cual lo devuelve `omero-backend` — no hay mapeo campo por campo, es un passthrough
genérico. `deviceSession.ts` (renderer) lo guarda con `setSession()` igual que el resto de la sesión.

#### Useful commands
```bash
npm --prefix web run check     # typecheck + tests con cobertura
```

#### TODOs / Technical debt
- [ ] Definir qué acciones del POS empiezan a requerir permiso (anular venta, descuento, precio
  libre) cuando exista la UI de gestión de roles (`roles-permisos-autogestion`, spec futuro).

**Archivo de specs:** `omero-backend/AiBuild/feature/roles-permisos-fundacion/done/`
