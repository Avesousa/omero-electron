# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**omero-electron** es el proyecto del **POS de Omero**, independiente del admin (`omero`). Contiene dos paquetes:

- **`web/`** — app Next.js del POS. Un mismo build corre en dos modos (`OMERO_RUNTIME`):
  - `web`: servicio en Railway (Root Directory `web/`), se usa desde el navegador.
  - `desktop`: lo levanta Electron en `127.0.0.1:3000` dentro del instalador.
  En ambos, `/api/*` se reenvía al `omero-backend` de Railway con un **proxy en runtime** (`BACKEND_URL`).
- **`main/`** — wrapper de Electron (frameless, teclado numérico). Ya **no** incluye Java/JRE/JAR: solo levanta el Next local.

Si `omero` (admin) cae, el POS sigue funcionando. Fases futuras (no implementadas): SQLite como caché offline, outbox de ventas, sesión larga de dispositivo (ver `AiBuild/.../functional-spec.md`).

## Commands

```bash
# Electron (raíz)
npm run dev               # Electron cargando OMERO_POS_URL (default http://localhost:3000/pos)
npm run typecheck         # tsc --noEmit
npm test                  # vitest (main/*.test.ts)
npm run check             # typecheck + tests con cobertura

# POS (web/)
npm run dev:web           # = npm --prefix web run dev
npm --prefix web run check   # typecheck + tests con cobertura (umbral 85 % en runtime/backend-proxy)

# Instalador (requiere OMERO_DEFAULT_BACKEND_URL)
npm run build:win         # Windows NSIS x64
npm run build:mac         # macOS DMG universal
npm run prepare:app       # build:config + build:web + prepare:frontend (sin electron-builder)
```

`build:*` encadenan: `build:config` → `build:web` → `prepare:frontend` → `tsc` → `electron-builder`. Nunca correr `electron-builder` directo.

## Architecture

```
main/                         Electron (CommonJS, tsc → dist/main)
├── main.ts                   splash → isPortFree(3000) → startFrontend → waitForFrontend → ventana
├── process-manager.ts        utilityProcess.fork(resources/frontend/server.js); espera /api/_local/health
├── config.ts                 POS_URL, resolveBackendUrl(env, buildConfig) — pura, 100 % testeada
├── build-config.ts           lee resources/build-config.json (default del backend embebido)
├── keyboard.ts               bloquea F1 a nivel Electron (el resto lo filtra el renderer)
├── preload.ts                contextBridge: electronAPI.isElectron / .platform
└── logger.ts                 electron-log + Better Stack opcional

web/                          Next.js 16 (ESM, standalone). Su propio package.json (npm)
├── src/app/pos, login/       POS y login — COPIADOS de omero (ver web/README.md)
├── src/app/api/[...path]/    proxy → proxyToBackend()
├── src/app/api/%5Flocal/health/  GET /api/_local/health (readiness local, NO se proxea)
├── src/lib/runtime.ts        getRuntime(), getBackendUrl(), getProxyTimeoutMs()
├── src/lib/backend-proxy.ts  proxyToBackend(request)
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
| `OMERO_POS_URL` | Electron dev | URL de la ventana |
| `BETTERSTACK_TOKEN` | Electron | Logs remotos opcionales |

No definir `NEXT_PUBLIC_API_URL` en el POS (mismo origen + proxy).

## Bundled Resources

`electron-builder` empaqueta desde `resources/` (todo generado, ignorado por git):
- `frontend/` — Next standalone (`npm run prepare:frontend`: `web/.next/standalone` + `.next/static` + `public`)
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
- **Auto-updater** de Electron sigue inactivo (`publish: null`); requiere code signing.
- Solo F1 se bloquea en Electron; el resto del filtrado está en el renderer (`useKeyboard.electron.ts`).
- Windows: `javaw.exe`/JRE ya no existen; no debe aparecer ningún proceso `java`.

## Pendientes registrados

- **Migración de datos H2 → Railway** de las instalaciones actuales (rama `master`, con Java+H2) antes de actualizarlas.
- Eliminar `/pos` de `omero` tras validar este POS.
- Fases 2–4: caché SQLite, outbox (ventas/gastos, `mp_offline`, ventas a revisar en admin), sesión de dispositivo larga.

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
