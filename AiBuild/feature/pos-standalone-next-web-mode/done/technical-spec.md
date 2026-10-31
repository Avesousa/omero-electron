# Technical Spec: POS independiente con Next y modo web (Fase 1)

## Metadata
- **Fecha:** 2026-09-21
- **Rama:** `feature/pos-standalone-next-web-mode` (base `develop`)
- **Basado en:** functional-spec.md
- **Estado:** WIP

## Resumen técnico
`omero-electron` pasa a ser un repo con **dos paquetes**: Electron en la raíz (`main/`) y el Next del POS en `web/`. El Next expone un **proxy `/api/*` en runtime** (route handler catch-all) hacia `omero-backend`, con `BACKEND_URL` leída en runtime. El mismo build sirve para Railway (`OMERO_RUNTIME=web`) y para Electron (`OMERO_RUNTIME=desktop`, spawneado como `utilityProcess`). Java/JRE/JAR desaparecen del instalador.

## Estructura del repo

```
omero-electron/
├── main/                     # Electron (CommonJS) — se mantiene
│   ├── main.ts               # orquesta splash + ventana (sin backend Java)
│   ├── process-manager.ts    # solo startFrontend / waitForFrontend / stopAll / isPortFree
│   ├── config.ts             # resolveBackendUrl(), POS_URL
│   ├── build-config.ts       # (nuevo) lee resources/build-config.json
│   └── ...
├── web/                      # Next del POS (ESM) — NUEVO, su propio package.json
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx, globals.css, page.tsx (redirect → /pos)
│   │   │   ├── login/**                       # copia de omero
│   │   │   ├── pos/**                         # copia de omero (componentes, hooks, tests)
│   │   │   ├── components/{ProtectedRoute,ThemeProvider,ThemeToggle,OmeroLogo,ui/Modal}
│   │   │   └── api/
│   │   │       ├── _local/health/route.ts     # readiness LOCAL (no proxy)
│   │   │       └── [...path]/route.ts         # proxy runtime → BACKEND_URL
│   │   ├── lib/
│   │   │   ├── runtime.ts                     # getRuntime(), getBackendUrl()
│   │   │   ├── backend-proxy.ts               # proxyToBackend(req) — pura y testeable
│   │   │   └── (apiClient, sessionManager, tenantTime, purchaseQueueStorage, utils…)  # copias
│   │   ├── shared/{contexts,services,types}   # copias
│   │   ├── instrumentation.ts                 # valida env al arrancar
│   │   └── middleware.ts                      # copia (JWT estructural + redirect a /login)
│   ├── public/brand/**
│   ├── next.config.ts, tsconfig.json, postcss.config.mjs, vitest.config.ts
│   ├── Dockerfile, railway.toml               # modo web en Railway (Root Directory = web/)
│   └── package.json (npm)
├── scripts/
│   ├── prepare-frontend.mjs   # arma resources/frontend desde web/.next/standalone
│   └── write-build-config.mjs # escribe resources/build-config.json desde env
├── electron-builder.config.ts # sin jre/backend
├── .github/workflows/installer.yml
└── AiBuild/…
```

## Arquitectura y patrones

### Decisión 1: Proxy `/api/*` como route handler catch-all en runtime
`app/api/[...path]/route.ts` delega en `lib/backend-proxy.ts` (`proxyToBackend(request)`), que lee `BACKEND_URL` en **runtime** y reenvía método, headers y body en streaming. Los métodos exportados: `GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD`, con `export const runtime = 'nodejs'` y `export const dynamic = 'force-dynamic'`.

**Por qué:** los `rewrites` de Next se resuelven en build (`routes-manifest.json`), por lo que `BACKEND_URL` no podría sobrescribirse en el desktop empaquetado (requisito funcional) y en fases 2–3 igual habría que reemplazarlos por route handlers con la capa SQLite/outbox. El handler es la base natural: fase 2/3 envuelve `proxyToBackend` con una capa de datos (proxy directo en `web`, offline-first en `desktop`).

**Alternativas descartadas:** ver tabla al final.

### Decisión 2: Modo de ejecución por `OMERO_RUNTIME=web|desktop`, validado al arrancar
`lib/runtime.ts` expone `getRuntime()` (lanza si falta o es inválido) y `getBackendUrl()` (lanza si falta o no es una URL http/https válida; se normaliza sin `/` final). **No se ejecutan en import-time** para no romper `next build`; se validan en `instrumentation.ts` (`register()`, solo Node) → si falla, el servidor no arranca y el error es visible (spec: "falla de forma visible").

En esta fase el modo **no cambia el comportamiento del proxy** (ambos son proxy directo); existe para que fases 2–3 seleccionen la implementación de la capa de datos. Se expone también en `/api/_local/health`.

### Decisión 3: Repo con subcarpeta `web/` (dos paquetes)
Electron (CommonJS, `tsc`) y Next (ESM, bundler) tienen tsconfig y dependencias distintas. Railway usa `web/` como *Root Directory* y su Dockerfile no arrastra Electron. Gestor de paquetes: **npm** en ambos (el CI ya usa npm; se evita mezclar yarn/npm en un repo).

### Decisión 4: Sin capa de datos ni SQLite en esta fase
Solo proxy. Los puntos de extensión (`backend-proxy.ts`, `runtime.ts`) quedan preparados, sin abstracciones vacías.

### Decisión 5: Duplicar, no compartir
El POS copia de `omero` lo que necesita (calculado con el grafo de imports, ver plan). `globals.css` se copia completo en esta fase (podarlo es deuda del rediseño del POS). Se documenta el origen de cada copia en `web/README.md` para poder auditar divergencias.

## Modelo de datos
Sin cambios. No hay base de datos local en esta fase (H2 desaparece del desktop; SQLite llega en fase 2). `omero-backend` no se modifica.

## API / Contratos

### `GET /api/_local/health` (nuevo, local — NO se proxea)
Ruta específica; en App Router tiene prioridad sobre el catch-all. Sirve para readiness de Electron y healthcheck de Railway, sin depender de la conectividad con el backend.
```
200 { "ok": true, "runtime": "web" | "desktop", "backendConfigured": true }
```
Si `OMERO_RUNTIME`/`BACKEND_URL` son inválidos el servidor ya no habrá arrancado (instrumentation), por lo que no hay caso 5xx propio.

### `ANY /api/*` (proxy)
Contrato transparente con `omero-backend`: mismo método, path, query, headers y body; misma respuesta.

Reglas de `proxyToBackend`:
- **URL destino:** `new URL(request.nextUrl.pathname + request.nextUrl.search, BACKEND_URL)`. Se verifica que `url.origin === new URL(BACKEND_URL).origin` y que el path empiece con `/api/` (defensa contra `//host`, `..`, esquemas raros); si no → `400`.
- **Request headers:** se reenvían todos **excepto** hop-by-hop (`connection`, `keep-alive`, `proxy-*`, `te`, `trailer`, `transfer-encoding`, `upgrade`), `host` y `content-length` (lo recalcula undici). `Authorization` se reenvía tal cual.
- **Body:** streaming (`request.body`, `duplex: 'half'`), sin bufferizar (multipart de cargas masivas y JSON grandes). Métodos GET/HEAD sin body.
- **Redirects:** `redirect: 'manual'` (se devuelve el 3xx al navegador).
- **Response:** `new Response(upstream.body, { status, statusText, headers })`. Como `fetch` (undici) **descomprime** el cuerpo, se eliminan `content-encoding` y `content-length` de los headers de respuesta para no corromper el payload. Se pasa el resto (incluye `set-cookie`, `cache-control`, `content-type`).
- **SSE (`/api/mercadopago/events`):** si `content-type` es `text/event-stream` se fuerza `Cache-Control: no-cache, no-transform` y `X-Accel-Buffering: no`; el stream se transmite sin buffer. La cancelación del cliente (`request.signal`) aborta el `fetch` upstream.
- **Timeouts:** tiempo máximo hasta recibir los *headers* del upstream: `PROXY_TIMEOUT_MS` (default 30 000). Una vez recibidos los headers no hay timeout total (los streams SSE pueden ser largos).
- **Errores del proxy** (mantienen el contrato JSON de `apiFetch`):
  - upstream inalcanzable / DNS / conexión rechazada → `502 { "success": false, "error": "No se pudo conectar con el servidor." }`
  - sin headers a tiempo → `504 { "success": false, "error": "El servidor tardó demasiado en responder." }`
  - path/origen inválido → `400 { "success": false, "error": "Ruta inválida." }`
- Los estados de error del backend (401/403/404/5xx) se devuelven sin modificar.

### Comportamiento heredado que se preserva
- `apiFetch` sigue haciendo `fetch(path)` relativo (same-origin). **`NEXT_PUBLIC_API_URL` se deja vacío/no definido en el POS** (el SSE y el polling de MP usan `NEXT_PUBLIC_API_URL ?? ''` → `''` = mismo origen = proxy).
- `middleware.ts` mantiene `BYPASS_PREFIXES` con `/api` (health y proxy sin chequeo de sesión; la auth la valida el backend por `Authorization`).

## Cambios en Electron (`main/`)

| Archivo | Cambio |
|---|---|
| `process-manager.ts` | Elimina `startBackend`, `waitForBackend`, constantes JRE/JAR/`DATA_DIR`. Agrega `waitForFrontend()` que consulta `http://127.0.0.1:3000/api/_local/health`. `startFrontend()` pasa a inyectar `OMERO_RUNTIME=desktop` y `BACKEND_URL`. |
| `main.ts` | Solo verifica el puerto **3000** (ya no 8080); `startFrontend()` → `waitForFrontend()` → ventana. Mensaje de error actualizado. |
| `config.ts` | `resolveBackendUrl(env, buildConfig)`: `env.BACKEND_URL` > `build-config.json.defaultBackendUrl`; si ninguno → error controlado (diálogo). `POS_URL` se mantiene (`OMERO_POS_URL` ?? `http://localhost:3000/pos`). |
| `build-config.ts` | Lee `resources/build-config.json` (empaquetado) si existe. |
| `logger.ts` | Se elimina `backendLogger` (ya no hay proceso Java). Se mantiene Better Stack para logs de Electron/frontend. |
| `electron-builder.config.ts` | Se quitan `jre` y `backend` de `extraResources`; se agrega `build-config.json`. `frontend` sigue igual. |

**Dev (`npm run dev`):** sin cambios de comportamiento — Electron carga `OMERO_POS_URL`. Se documenta levantar `npm --prefix web run dev` en otra terminal (con `OMERO_RUNTIME=desktop BACKEND_URL=...`).

## Build, empaquetado y CI

**`scripts/prepare-frontend.mjs`** (multiplataforma, Node): tras `npm --prefix web run build`, arma `resources/frontend/` con:
1. contenido de `web/.next/standalone/` (incluye `server.js`),
2. `web/.next/static` → `resources/frontend/.next/static`,
3. `web/public` → `resources/frontend/public`.

`web/next.config.ts` fija `output: 'standalone'` y `outputFileTracingRoot` a la carpeta `web/` para que el standalone quede con `server.js` en la raíz (con dos lockfiles Next podría inferir la raíz del repo y anidar en `standalone/web/`).

**`scripts/write-build-config.mjs`:** escribe `resources/build-config.json` `{ "defaultBackendUrl": process.env.OMERO_DEFAULT_BACKEND_URL }`; falla el build si la variable está vacía.

**`.github/workflows/installer.yml`:** elimina descargas de JAR, JRE y `frontend.zip`; agrega `npm ci` (raíz y `web/`), `write-build-config`, build de `web/`, `prepare-frontend`, y el resto igual (`electron-builder`). Variable de repo/secret: `OMERO_DEFAULT_BACKEND_URL`.

**Railway (modo web):** servicio nuevo con *Root Directory* `web/`, `Dockerfile` multi-stage (deps → builder → runner, Node 20 alpine, como `omero`) y `railway.toml` con healthcheck `/api/_local/health`.
Variables del servicio: `OMERO_RUNTIME=web`, `BACKEND_URL=https://<omero-backend>` (o URL interna de Railway), `PORT`. **No** se definen `NEXT_PUBLIC_*`.

## Dependencias

### `web/package.json` (mismas versiones que `omero` para minimizar divergencia)
| Paquete | Versión | Propósito | Alternativa considerada |
|---|---|---|---|
| next | ^16.1.2 | Framework, standalone | — (igual que omero) |
| react / react-dom | ^18.2.0 | UI | — |
| tailwindcss + @tailwindcss/postcss | ^4.1.11 | Estilos del POS | — |
| lucide-react | ^0.469.0 | Iconos | — |
| clsx, tailwind-merge | ^2.0.0 | Utilidades de clases | — |
| vitest, jsdom, @testing-library/* | igual que omero | Tests | Jest (descartado: ya se usa vitest) |
| (dev) typescript, eslint, @types/* | igual que omero | Tipos | — |

Sin nuevas dependencias de runtime: el proxy usa `fetch` nativo de Node 20 (undici).

### Raíz (Electron)
| Paquete | Propósito |
|---|---|
| vitest (dev) | Tests de la lógica pura de `main/config.ts` (resolución de `BACKEND_URL`) |

### A remover
JRE 21 Temurin, `omero-backend.jar` y todo el código Java en `main/`.

## Performance
- El proxy agrega un salto local (~ms) y **no bufferiza** requests ni responses (streaming en ambos sentidos).
- Sin caché (`force-dynamic`; `cache-control` del backend se respeta).
- SSE sin timeout total; se libera la conexión upstream al cancelar el cliente (evita conexiones colgadas).
- Arranque desktop: menor que hoy (sin JVM; `-Xmx256m` desaparece). Volumen: una terminal por instalación.
- Instalador más liviano (sin JRE ni JAR).

## Seguridad
- `BACKEND_URL` es **solo de servidor** (no `NEXT_PUBLIC_*`); el navegador nunca la ve.
- **Anti-SSRF:** el destino se construye siempre contra el origen configurado; se rechaza cualquier path que cambie de origen o no empiece por `/api/`.
- Hop-by-hop y `host` no se reenvían; `Authorization` sí (es el mecanismo de auth del backend).
- Desktop: el Next escucha solo en `127.0.0.1`; ventana con `contextIsolation: true`, `nodeIntegration: false` (sin cambios).
- Sesión: el JWT sigue en `sessionStorage` + cookies de sesión (comportamiento heredado). **Consecuencia funcional:** al ser un origen distinto de `omero`, la sesión del admin **ya no se comparte** con el POS; el cajero inicia sesión en el POS. Se documenta.
- Los errores del proxy no exponen detalles internos (URL, stack) al cliente; se loguean en servidor.
- Secretos: `betterstack.token` sigue fuera del repo (`.gitignore`).

## Testing plan (`tests_required = true`, nivel Unit + Integration)

### Cobertura obligatoria
- `web/src/lib/runtime.ts` y `web/src/lib/backend-proxy.ts`: umbral 85 % (líneas/funciones/branches), como `omero`.
- `main/config.ts` (`resolveBackendUrl`): 100 % de ramas.

### Unit
- `runtime`: `OMERO_RUNTIME` válido/ausente/inválido; `BACKEND_URL` válida/ausente/malformada/con `/` final/esquema no http(s).
- `backend-proxy` (con `fetch` mockeado): construcción de URL (query, path), rechazo de `//evil.com`, `..`, path fuera de `/api/`; filtrado de headers hop-by-hop/host; pass-through de `Authorization`; eliminación de `content-encoding`/`content-length` en respuesta; mapeo de errores (502/504/400).
- `resolveBackendUrl`: env > build-config > error.
- Tests existentes del POS migrados (`offlineQueue-utils.test.ts` y los que aparezcan al copiar).

### Integration (backend falso con `http.createServer`)
- GET/POST JSON: método, headers y body llegan íntegros; respuesta y status pasan (200/401/404/500).
- Multipart grande: se transmite sin bufferizar.
- **SSE:** los eventos llegan al cliente de forma incremental *antes* de que el upstream cierre; cerrar el cliente aborta la conexión upstream.
- Upstream gzip: el cliente recibe el cuerpo correcto (sin doble descompresión).
- Upstream caído → 502; upstream que no responde headers → 504 (con `PROXY_TIMEOUT_MS` reducido).
- `/api/_local/health` responde local aunque el backend esté caído.

### Verificación manual (checklist en el plan)
- Modo web: login y venta completa contra backend real; error visible con backend apagado.
- Desktop (Windows y macOS): instalar, verificar que **no** se lanza `java`, POS carga en `localhost:3000`, puerto ocupado → diálogo, cerrar app → sin procesos huérfanos, override `BACKEND_URL`.
- `omero`: "Abrir POS" con y sin `NEXT_PUBLIC_POS_URL` (cambio pequeño en `omero`, ver plan).

### Fuera de alcance de tests
E2E automatizado del arranque de Electron (se cubre con checklist manual).

## Cambio mínimo requerido en `omero` (mismo alcance, PR aparte a su repo)
- `navConfig.ts`, `HomeNavCards.tsx` y `admin/sales/page.tsx` (que enlazan a `/pos`): usar `process.env.NEXT_PUBLIC_POS_URL ?? '/pos'` como destino del acceso "Abrir POS". Sin la variable se mantiene el `/pos` interno (transición). Es un PR contra `develop` del repo `omero`, independiente del de `omero-electron`.

## Explorado y descartado
| Alternativa | Por qué se descarta |
|---|---|
| `rewrites` de `next.config` (como `omero`) | Destino fijo en build → sin override de `BACKEND_URL` en desktop; en fases 2–3 habría que migrar igual a route handlers |
| `proxy.ts`/middleware con `NextResponse.rewrite` | Las env del middleware pueden inlinearse en build según el runtime; comportamiento poco predecible para override en runtime |
| Servidor custom con `http-proxy` | Rompe el `standalone` estándar y complica empaquetado/actualizaciones |
| Un único `package.json` en la raíz | Conflicto de tsconfig (CommonJS vs ESM), Railway arrastraría dependencias de Electron |
| Monorepo con workspaces | Overkill para dos paquetes; complica `electron-builder` y el tracing de standalone |
| Mantener Java/H2 en el desktop | Contradice la decisión de eliminar Java; +~300 MB; dos backends |
| Docker + H2/SQLite local en cada caja | Las cajas no suelen tener Docker; SQLite embebido llega en fase 2 sin Docker |
| Deducir el modo del entorno de Railway | Frágil; se prefiere `OMERO_RUNTIME` explícito |
| `yarn` en `web/` | El repo y el CI usan npm; evita dos gestores |
| Compartir código con `omero` por paquete npm/submódulo | Se decidió duplicar por ahora; el POS se rediseñará |

## Flujo técnico

```
                       ┌──────────────── Railway ─────────────────┐
 Navegador ──HTTPS──►  │ POS Next (OMERO_RUNTIME=web)             │
                       │   /pos, /login (UI)                      │
                       │   /api/_local/health (local)             │
                       │   /api/* ── proxyToBackend ──────────────┼──► omero-backend (Railway)
                       └──────────────────────────────────────────┘

 ┌──────────── Máquina del cliente (Electron) ────────────┐
 │ main.ts ─ splash ─ isPortFree(3000)                    │
 │    └─ utilityProcess.fork(server.js)                   │
 │         env: OMERO_RUNTIME=desktop, BACKEND_URL=…      │
 │         Next standalone 127.0.0.1:3000                 │
 │           ├─ /pos, /login (UI)                         │
 │           ├─ /api/_local/health ◄── waitForFrontend()  │
 │           └─ /api/* ── proxyToBackend ─────────────────┼──► omero-backend (Railway)
 │    └─ BrowserWindow.loadURL(localhost:3000/pos)        │
 └────────────────────────────────────────────────────────┘

 Fase 2/3 (no ahora): entre proxyToBackend y el backend se inserta la capa
 SQLite/outbox solo en modo desktop.
```

## Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Proxy propio con bugs de streaming/compresión | Tests de integración con SSE, gzip y multipart; implementación mínima sobre `fetch` |
| Standalone anidado por dos lockfiles | `outputFileTracingRoot` fijado + verificación en `prepare-frontend.mjs` (falla si no existe `server.js` en la raíz) |
| Divergencia futura entre POS y `omero` | `web/README.md` con origen de cada copia; rediseño planificado |
| Instalaciones actuales con H2 | Siguen en `master`; migración H2→Railway registrada como pendiente (fuera de fase 1) |
| Sesión no compartida admin↔POS | Documentado; login propio del POS |

## Ajustes y decisiones tomadas durante el build (2026-09-21)
| Tema | Decisión | Motivo |
|---|---|---|
| Headers de request | El proxy **no reenvía `origin` ni `referer`** (además de hop-by-hop, `host`, `content-length`) | El backend aplica CORS con `CORS_ALLOWED_ORIGINS` (default solo `http://localhost:3000`). Reenviar el `Origin` del navegador (`127.0.0.1:3000`, dominio del POS) daría 403. Al ser servidor-a-servidor no hace falta tocar el backend |
| Ruta de health | La carpeta es `api/%5Flocal/health` (URL `/api/_local/health`) | En App Router `_local` es carpeta privada (sin ruta) y caería en el catch-all |
| Entorno inválido | `instrumentation-node.ts` hace `process.exit(1)` | Next no termina el proceso si falla el hook; sin esto Railway no reinicia y Electron espera 60 s. Verificado en Docker |
| Electron | `waitForFrontend` falla rápido si el Next salió | Evitar el timeout de 60 s ante config inválida |
| `BACKEND_URL` | Solo **origen** (sin path/query/credenciales), validado igual en Electron (`resolveBackendUrl`) y en Next (`getBackendUrl`) | Consistencia y anti-SSRF |
| npm | `.npmrc` con `legacy-peer-deps=true` en la raíz y en `web/` | Bug de arborist en npm 10.9 (`reading 'edgesOut'`); `npm ls` sin peers inválidos |
| Lint | No se incluyó ESLint en `web/` | `next lint` no existe en Next 16 y `omero` tampoco tiene script; el gate es `tsc` + tests |
| Config vitest | `web/vitest.config.mts` | Evitar warning de ESM en CJS |
| Origen de la copia | `origin/develop` de `omero` (commit `7b99acb`), 60 archivos + `public/brand` | Reproducibilidad; no se copió desde la rama de paleta sin mergear |
| Tests | 92 en `web` (61 unit, 12 integración, 19 migrados) + 16 en la raíz | Integración con backend HTTP real: SSE incremental, cancelación, multipart en streaming, gzip, 502/504 |
| Validación real | Docker (`web/`) y standalone empaquetado (`resources/frontend`) contra el backend `devdata` | Ver `manual-checklist.md` sección A |
