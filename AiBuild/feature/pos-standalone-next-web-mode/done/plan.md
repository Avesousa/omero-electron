# Task Plan: POS independiente con Next y modo web (Fase 1)

## Metadata
- **Date:** 2026-09-21
- **Branch:** feature/pos-standalone-next-web-mode (repo `omero-electron`, base `develop`)
- **Type:** feature
- **Tests required:** yes (Unit + Integration)
- **Total tasks:** 22 (10 S · 10 M · 2 L)
- **Parallelizable groups:** 6 waves (ver abajo)

## Executive summary
El plan crea el paquete `web/` (Next del POS) con el cierre de imports del POS copiado de `omero` (~59 archivos), agrega el proxy `/api/*` en runtime como núcleo técnico (`runtime.ts` + `backend-proxy.ts` + route handlers) y adelgaza Electron quitando Java (`process-manager`, `main`, `config`, `builder`, CI). El modo web se completa con Dockerfile/railway.toml. Los tests van pegados a cada pieza (unit para `runtime`, `backend-proxy`, `resolveBackendUrl`; integración con un backend falso para streaming SSE, gzip, multipart y errores). La tarea T013 vive en **otro repo** (`omero`) y va en un PR aparte. Lo más delicado es el proxy (T007) y su integración (T018).

## Phases and tasks

### Phase 0: Setup

- [ ] **T001** — Scaffold del paquete web/ (Next 16, npm)
  - Detail: Crear web/package.json (mismas versiones que omero: next ^16.1.2, react ^18.2, tailwind 4 + @tailwindcss/postcss, lucide-react, clsx, tailwind-merge; dev: typescript, vitest, jsdom, @testing-library/*, eslint), tsconfig.json (alias @/*), next.config.ts (output standalone, outputFileTracingRoot=web/, redirects "/"→"/pos", SIN rewrites), postcss.config.mjs, vitest.config.ts (jsdom, setup, coverage 85% sobre lib/runtime.ts y lib/backend-proxy.ts), .gitignore (.next, node_modules), scripts npm (dev, build, start, test, typecheck). Ejecutar npm install para generar package-lock.json.
  - Done when: `cd web && npm ci && npx tsc --noEmit` corre sin errores con un app/page.tsx mínimo; `npm run build` genera .next/standalone/server.js en la raíz del standalone (no anidado en web/).
  - Dependencies: none
  - Can parallelize with: T004, T006
  - Files affected: web/package.json, web/package-lock.json, web/tsconfig.json, web/next.config.ts, web/postcss.config.mjs, web/vitest.config.ts, web/.gitignore
  - Complexity: M

- [ ] **T002** — Copiar del repo omero el cierre de imports del POS a web/src
  - Detail: Copiar SIN modificar lógica (mismos paths relativos bajo web/src): app/pos/** (35 archivos incl. hooks/__tests__), app/login/** (4), app/components/{OmeroLogo,ProtectedRoute(+.module.css),ThemeProvider,ThemeToggle,ui/Modal}, app/globals.css, app/layout.tsx, lib/{apiClient,loginValidation,purchaseQueueStorage,sessionManager,tenantTime}.ts, shared/{index.ts,contexts/auth.tsx,services/authService.ts,types/auth.ts,types/mercadopago.ts}, middleware.ts, instrumentation.ts (base), test/setup.ts, public/brand/**. Crear web/README.md con tabla "archivo → origen en omero (commit/fecha)".
  - Done when: Todos los archivos existen en web/src; el listado de web/README.md coincide con `git ls-files web/src`; ningún archivo importa algo inexistente (verificado en T003).
  - Dependencies: T001
  - Can parallelize with: T004, T006
  - Files affected: web/src/app/pos/**, web/src/app/login/**, web/src/app/components/**, web/src/app/globals.css, web/src/app/layout.tsx, web/src/lib/*, web/src/shared/**, web/src/middleware.ts, web/src/instrumentation.ts, web/src/test/setup.ts, web/public/brand/**, web/README.md
  - Complexity: M

- [ ] **T003** — Hacer compilar el POS copiado (tsc + next build)
  - Detail: Agregar app/page.tsx que redirige a /pos (o confirmar redirect de next.config). Corregir imports rotos y referencias al admin (links a /admin o rutas que no existan en el POS). Confirmar que NEXT_PUBLIC_API_URL no es requerida (mismo origen). Ajustar metadata del layout si aplica. No cambiar lógica de negocio.
  - Done when: `cd web && npx tsc --noEmit` y `npm run build` terminan con exit 0; `npm run start` sirve /login y /pos (redirige a /login sin sesión).
  - Dependencies: T002
  - Files affected: web/src/app/page.tsx, web/next.config.ts, web/src/**
  - Complexity: M

### Phase 1: Foundation

- [ ] **T004** — lib/runtime.ts: getRuntime() y getBackendUrl()
  - Detail: getRuntime(): lee OMERO_RUNTIME, valida "web"|"desktop", lanza Error explícito si falta o es inválido. getBackendUrl(): lee BACKEND_URL, valida URL http/https, normaliza sin "/" final, lanza si falta o es inválida. NO ejecutar en import-time (funciones puras que leen process.env al llamarse). Exportar tipo Runtime.
  - Done when: Funciones exportadas y tipadas; `tsc --noEmit` OK; sin efectos al importar el módulo.
  - Dependencies: T001
  - Can parallelize with: T002, T006
  - Files affected: web/src/lib/runtime.ts
  - Complexity: S

- [ ] **T005** — instrumentation.ts: validar entorno al arrancar (+ mantener Better Stack)
  - Detail: En register() (solo runtime nodejs) llamar getRuntime() y getBackendUrl() y loguear (console) runtime y ORIGEN del backend (sin secretos ni path). Si lanzan, dejar que el error detenga el arranque. Conservar el logging a Better Stack existente. Verificar que `next build` NO ejecuta la validación.
  - Done when: `OMERO_RUNTIME` ausente → `npm run start` falla con mensaje claro; con env válida arranca y loguea "runtime=<x> backend=<origin>"; `npm run build` funciona sin variables.
  - Dependencies: T002, T004
  - Can parallelize with: T007
  - Files affected: web/src/instrumentation.ts
  - Complexity: S

- [ ] **T006** — Electron: config.ts con resolveBackendUrl() + build-config.ts
  - Detail: Extraer función pura resolveBackendUrl(env, buildConfig) → string (prioridad: env.BACKEND_URL > buildConfig.defaultBackendUrl; valida URL http/https; lanza Error controlado si ninguna). Crear main/build-config.ts que lee resources/build-config.json (packaged: <exe dir>/resources; dev: ./resources) y devuelve null si no existe. Mantener POS_URL.
  - Done when: `npm run typecheck` OK en la raíz; resolveBackendUrl es pura y exportada sin importar electron.
  - Dependencies: none
  - Can parallelize with: T001, T002, T004
  - Files affected: main/config.ts, main/build-config.ts
  - Complexity: S

### Phase 2: Core

- [ ] **T007** — lib/backend-proxy.ts: proxyToBackend(request)
  - Detail: Implementar según technical-spec: (1) URL destino con new URL(pathname+search, BACKEND_URL), verificar mismo origen y path que empieza con /api/ (si no → 400 JSON); (2) headers de request: quitar hop-by-hop, host, content-length; reenviar Authorization; (3) body streaming con duplex:"half" (GET/HEAD sin body); (4) fetch con redirect:"manual" y AbortController encadenado a request.signal; (5) timeout hasta headers = PROXY_TIMEOUT_MS (default 30000), luego sin timeout; (6) respuesta: new Response(upstream.body,{status,statusText,headers}) eliminando content-encoding y content-length; (7) SSE: si content-type es text/event-stream forzar Cache-Control "no-cache, no-transform" y X-Accel-Buffering "no"; (8) errores: inalcanzable → 502, timeout → 504, ambos JSON {success:false,error}; log de servidor sin exponer detalles al cliente.
  - Done when: Función exportada y tipada; comportamiento verificado por los tests T017 y T018.
  - Dependencies: T004
  - Can parallelize with: T005, T009, T010
  - Files affected: web/src/lib/backend-proxy.ts
  - Complexity: L

- [ ] **T008** — Route handlers: /api/[...path] y /api/_local/health
  - Detail: app/api/[...path]/route.ts exporta GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD delegando en proxyToBackend, con runtime="nodejs" y dynamic="force-dynamic". app/api/_local/health/route.ts responde 200 {ok:true,runtime,backendConfigured:true} sin tocar el backend. Confirmar que la ruta específica tiene prioridad sobre el catch-all y que middleware.ts sigue haciendo bypass de /api.
  - Done when: `GET /api/_local/health` → 200 con runtime correcto aun con backend caído; `GET /api/auth/x` llega al backend configurado (verificado en T014/T018).
  - Dependencies: T007, T004
  - Files affected: web/src/app/api/[...path]/route.ts, web/src/app/api/_local/health/route.ts
  - Complexity: S

- [ ] **T009** — Electron: quitar Java y orquestar solo el Next local
  - Detail: process-manager.ts: eliminar startBackend, waitForBackend, JRE_JAVA, BACKEND_JAR, DATA_DIR y el spawn de child_process; agregar waitForFrontend(timeout 60s) que pollea http://127.0.0.1:3000/api/_local/health; startFrontend() inyecta env {NODE_ENV,PORT:"3000",HOSTNAME:"127.0.0.1",OMERO_RUNTIME:"desktop",BACKEND_URL:resolveBackendUrl(...)}; stopAll solo mata el frontend. main.ts: verificar solo puerto 3000; flujo startFrontend→waitForFrontend→createMainWindow; diálogo específico si BACKEND_URL no se puede resolver; mensajes actualizados. logger.ts: quitar backendLogger.
  - Done when: `npm run typecheck` OK; no queda ninguna referencia a java/jre/jar/8080 en main/ (`grep -ri "java\|\.jar\|8080" main/` vacío).
  - Dependencies: T006
  - Can parallelize with: T007, T010
  - Files affected: main/process-manager.ts, main/main.ts, main/logger.ts
  - Complexity: M

- [ ] **T010** — Scripts de empaquetado y config de electron-builder
  - Detail: scripts/prepare-frontend.mjs: (Node, multiplataforma) limpia resources/frontend y copia web/.next/standalone/* , web/.next/static → resources/frontend/.next/static, web/public → resources/frontend/public; falla si no existe resources/frontend/server.js. scripts/write-build-config.mjs: escribe resources/build-config.json {defaultBackendUrl} desde OMERO_DEFAULT_BACKEND_URL; falla si está vacía o no es URL http(s). package.json raíz: scripts build:web, prepare:frontend, build:config, dev:web; el script build encadena los pasos. electron-builder.config.ts: quitar extraResources jre y backend, agregar build-config.json. .gitignore: resources/frontend, resources/build-config.json.
  - Done when: Con web/ construido, `node scripts/prepare-frontend.mjs` deja resources/frontend/server.js ejecutable con `node server.js`; `electron-builder.config.ts` ya no referencia jre/backend; `npm run typecheck` OK.
  - Dependencies: T006
  - Can parallelize with: T007, T009
  - Files affected: scripts/prepare-frontend.mjs, scripts/write-build-config.mjs, package.json, electron-builder.config.ts, .gitignore
  - Complexity: M

### Phase 3: Integration

- [ ] **T011** — Modo web en Railway: Dockerfile y railway.toml de web/
  - Detail: web/Dockerfile multi-stage (node:20-alpine: deps → builder → runner, usuario no-root, copia standalone + .next/static + public, CMD node server.js, HOSTNAME 0.0.0.0, PORT 3000) sin NEXT_PUBLIC_* ; web/.dockerignore; web/railway.toml (builder DOCKERFILE, healthcheck /api/_local/health, restart ON_FAILURE). Documentar variables: OMERO_RUNTIME=web, BACKEND_URL, PORT.
  - Done when: `docker build web/` produce imagen; `docker run -e OMERO_RUNTIME=web -e BACKEND_URL=http://host.docker.internal:8080 -p 3000:3000` responde 200 en /api/_local/health (si Docker no está disponible localmente, se valida con `npm run build && node .next/standalone/server.js` y se deja Docker para el primer deploy).
  - Dependencies: T003, T008
  - Can parallelize with: T012, T013
  - Files affected: web/Dockerfile, web/.dockerignore, web/railway.toml
  - Complexity: M

- [ ] **T012** — CI del instalador: eliminar JAR/JRE y construir el POS propio
  - Detail: Editar .github/workflows/installer.yml: quitar pasos de descarga de backend JAR, JRE y frontend.zip y creación de resources/backend|jre; agregar setup-node, `npm ci` (raíz) y `npm ci` en web/, pasos de tests (`npm --prefix web test`, `npm test` raíz), `npm --prefix web run build`, `node scripts/write-build-config.mjs` (env OMERO_DEFAULT_BACKEND_URL desde vars/secrets), `node scripts/prepare-frontend.mjs`, y luego electron-builder como hoy. Mantener el trigger por tags v*.*.*.
  - Done when: El YAML es válido (`actionlint` o revisión) y no contiene referencias a jre/omero-backend.jar/frontend.zip; la lista de pasos coincide con el flujo descrito en la technical-spec.
  - Dependencies: T010
  - Can parallelize with: T011, T013
  - Files affected: .github/workflows/installer.yml
  - Complexity: M

- [ ] **T013** — omero (admin): "Abrir POS" usa NEXT_PUBLIC_POS_URL — PR aparte
  - Detail: En el repo omero, rama desde develop: en navConfig.ts, HomeNavCards.tsx y admin/sales/page.tsx reemplazar los enlaces a /pos por un helper posUrl() = process.env.NEXT_PUBLIC_POS_URL ?? "/pos" (enlace externo con target _blank cuando es URL absoluta). Documentar la variable en env.example.txt y CLAUDE.md de omero. Sin borrar /pos.
  - Done when: Con NEXT_PUBLIC_POS_URL definida los 3 puntos navegan a esa URL; sin ella siguen apuntando a /pos; `tsc --noEmit` y `yarn test` de omero pasan; PR abierto contra develop de omero.
  - Dependencies: none
  - Can parallelize with: T011, T012
  - Files affected: (repo omero) src/app/components/nav/navConfig.ts, (repo omero) src/app/components/HomeNavCards.tsx, (repo omero) src/app/admin/sales/page.tsx, (repo omero) env.example.txt
  - Complexity: S

- [ ] **T014** — Smoke test local end-to-end del build standalone
  - Detail: Construir web/, correr `node .next/standalone/server.js` (y luego el resources/frontend generado por prepare-frontend) con OMERO_RUNTIME=desktop y BACKEND_URL apuntando al backend local de desarrollo (./dev.sh) o a uno falso; verificar /api/_local/health, redirect de /pos a /login sin sesión, login real contra el backend y una llamada autenticada por el proxy. Registrar resultados en manual-checklist.md.
  - Done when: Los 4 checks pasan y quedan anotados con fecha en manual-checklist.md.
  - Dependencies: T003, T008, T010
  - Files affected: AiBuild/feature/pos-standalone-next-web-mode/WIP/manual-checklist.md
  - Complexity: M

### Phase 4: Quality

- [ ] **T015** — Tests root: configurar vitest y probar resolveBackendUrl
  - Detail: Agregar vitest (dev) al package.json raíz + script test + vitest.config.ts (node env). Tests de main/config.ts: env > build-config > error; URL inválida; trimming de "/"; buildConfig null. 100% de ramas.
  - Done when: `npm test` en la raíz pasa con 100% de cobertura de ramas en resolveBackendUrl.
  - Dependencies: T006
  - Can parallelize with: T016, T017
  - Files affected: package.json, vitest.config.ts, main/config.test.ts
  - Complexity: S

- [ ] **T016** — Tests unitarios de lib/runtime.ts
  - Detail: Casos: OMERO_RUNTIME web/desktop/ausente/inválido; BACKEND_URL válida, con "/" final, ausente, malformada, esquema no http(s) (ftp:, file:, javascript:); verificar que importar el módulo no lanza.
  - Done when: `cd web && npx vitest run src/lib/runtime.test.ts` pasa; cobertura ≥85%.
  - Dependencies: T004
  - Can parallelize with: T015, T017
  - Files affected: web/src/lib/runtime.test.ts
  - Complexity: S

- [ ] **T017** — Tests unitarios de lib/backend-proxy.ts (fetch mockeado)
  - Detail: Casos: construcción de URL (query, path anidado); rechazo de "//evil.com", "..", paths fuera de /api/ y origen distinto (400); filtrado hop-by-hop/host/content-length y paso de Authorization; eliminación de content-encoding/content-length en respuesta; passthrough de status 401/403/404/500 y de set-cookie; mapeo de errores a 502 y 504 con PROXY_TIMEOUT_MS reducido; redirect manual devuelve 3xx sin seguir.
  - Done when: `npx vitest run src/lib/backend-proxy.test.ts` pasa; cobertura de backend-proxy.ts ≥85%.
  - Dependencies: T007
  - Can parallelize with: T015, T016
  - Files affected: web/src/lib/backend-proxy.test.ts
  - Complexity: M

- [ ] **T018** — Tests de integración del proxy con backend falso (http.createServer)
  - Detail: Levantar un servidor HTTP falso y ejecutar los route handlers (o el standalone) contra él. Casos: GET/POST JSON íntegros (método, headers, body); multipart grande sin bufferizar; SSE: el cliente recibe el primer evento ANTES de que el upstream cierre y al cancelar el cliente el upstream ve la conexión cerrada; upstream gzip → cuerpo correcto; upstream caído → 502; upstream sin headers → 504; /api/_local/health responde con backend caído.
  - Done when: `npx vitest run src/lib/backend-proxy.integration.test.ts` pasa de forma estable (3 corridas seguidas sin flakiness).
  - Dependencies: T008
  - Files affected: web/src/lib/backend-proxy.integration.test.ts
  - Complexity: L

- [ ] **T019** — Tests migrados del POS pasan en web/
  - Detail: Ejecutar vitest sobre los tests copiados (offlineQueue-utils.test.ts y cualquier otro) y ajustar setup/alias si hace falta, sin cambiar la lógica probada.
  - Done when: `cd web && npm test` pasa completo (incluye migrados + nuevos).
  - Dependencies: T003
  - Can parallelize with: T015, T016, T017
  - Files affected: web/src/app/pos/hooks/__tests__/**, web/src/test/setup.ts, web/vitest.config.ts
  - Complexity: S

- [ ] **T020** — Umbrales de cobertura y gates de calidad
  - Detail: Confirmar thresholds 85% para runtime.ts y backend-proxy.ts en vitest.config.ts; script `npm run check` en web/ (typecheck + test:coverage) y en la raíz (typecheck + test); asegurar que el CI del instalador los ejecuta antes del build.
  - Done when: `npm run check` pasa en web/ y en la raíz; el workflow lo invoca.
  - Dependencies: T015, T016, T017, T018, T019, T012
  - Files affected: web/package.json, web/vitest.config.ts, package.json, .github/workflows/installer.yml
  - Complexity: S

### Phase 5: Polish

- [ ] **T021** — Documentación: CLAUDE.md, README, .env.example y web/README
  - Detail: Actualizar CLAUDE.md y README.md del repo (nueva arquitectura web/ + main/, sin Java, variables OMERO_RUNTIME/BACKEND_URL/OMERO_DEFAULT_BACKEND_URL/PROXY_TIMEOUT_MS/OMERO_POS_URL, comandos dev/build, cómo desplegar en Railway con Root Directory web/, dev en dos terminales). Crear web/.env.example. Completar web/README.md (origen de cada copia).
  - Done when: Un desarrollador nuevo puede levantar modo web y desktop siguiendo solo el README; CLAUDE.md ya no menciona JRE/JAR.
  - Dependencies: T011, T012
  - Can parallelize with: T022
  - Files affected: CLAUDE.md, README.md, web/README.md, web/.env.example
  - Complexity: M

- [ ] **T022** — Checklist manual, deuda técnica y pendientes
  - Detail: Crear manual-checklist.md (web: login+venta, error sin backend; desktop Windows y macOS: sin proceso java, puerto ocupado, override BACKEND_URL, cierre sin huérfanos; omero: Abrir POS con/sin variable) y una sección de deuda técnica: código duplicado con omero, globals.css completo, borrar /pos de omero tras validar, pendiente H2→Railway, fases 2-4.
  - Done when: Archivo existe, referenciado desde el PR; pendientes reflejados también en memoria del proyecto.
  - Dependencies: T014
  - Can parallelize with: T021
  - Files affected: AiBuild/feature/pos-standalone-next-web-mode/WIP/manual-checklist.md
  - Complexity: S

## Dependency map
```
T001 ─┬─► T002 ─► T003 ─┬─► T011
      │           │     ├─► T014 ─► T022
      │           │     └─► T019
      └─► T004 ─┬─► T005 (también T002)
                ├─► T016
                └─► T007 ─┬─► T008 ─┬─► T011
                          │         ├─► T014
                          │         └─► T018
                          └─► T017
T006 ─┬─► T009
      ├─► T010 ─┬─► T012 ─► T021
      │         └─► T014
      └─► T015
T013 (repo omero, independiente)
T015,T016,T017,T018,T019,T012 ─► T020
T011,T012 ─► T021
```

## Parallelizable groups
- **Wave 1** (sin dependencias): T001, T006, T013
- **Wave 2**: T002 y T004 (tras T001); T009, T010 y T015 (tras T006)
- **Wave 3**: T003 y T005 (tras T002 / T004); T007 y T016 (tras T004)
- **Wave 4**: T008 y T017 (tras T007); T019 (tras T003); T012 (tras T010)
- **Wave 5**: T011, T014, T018 (tras T003/T008/T010)
- **Wave 6**: T020, T021, T022

**Cuidado con conflictos de archivos entre tareas paralelas:** `package.json` raíz lo tocan T010, T015 y T020; `installer.yml` lo tocan T012 y T020; `web/vitest.config.ts` lo tocan T001, T019 y T020. Al paralelizar con subagentes hay que integrar esos archivos en orden (T010 → T015 → T020, T012 → T020) o asignarlos al mismo agente.

## Ruta crítica
T001 → T004 → T007 → T008 → T014 → T022 (y T018 en paralelo al final).

## Risks and mitigations
| Risk | Probability | Mitigation |
|------|------------|------------|
| Streaming/compresión del proxy con bugs sutiles (SSE bufferizado, gzip doblemente descomprimido) | Media | T017/T018 cubren SSE incremental, abort y gzip; implementación mínima sobre `fetch` nativo |
| Standalone anidado (`standalone/web/server.js`) por dos lockfiles | Media | `outputFileTracingRoot` en T001 y verificación de `server.js` en la raíz en T010 |
| Copia del POS arrastra referencias al admin o variables faltantes | Media | T003 compila y corre `next build`; sin cambios de lógica |
| `next build` ejecuta validación de entorno por accidente | Baja | T004 sin efectos al importar; T005 valida solo en `register()`; criterio de aceptación explícito |
| Tests de integración inestables (timing SSE) | Media | Puertos efímeros, señales de sincronización explícitas en lugar de `sleep`, criterio de 3 corridas seguidas |
| Sin Docker local para probar T011 | Media | Validar con standalone local y dejar la verificación de imagen al primer deploy en Railway |
| Colisión de archivos al paralelizar | Media | Orden de integración documentado arriba |
| Instalaciones actuales con H2 | Alta (conocida) | Siguen en `master`; migración registrada como pendiente (T022) |

## Complexity summary
| Task | S/M/L/XL | Reason |
|------|----------|--------|
| T001 | M | Scaffold del paquete web/ (Next 16, npm) |
| T002 | M | Copiar del repo omero el cierre de imports del POS a web/src |
| T003 | M | Hacer compilar el POS copiado (tsc + next build) |
| T004 | S | lib/runtime.ts: getRuntime() y getBackendUrl() |
| T005 | S | instrumentation.ts: validar entorno al arrancar (+ mantener Better Stack) |
| T006 | S | Electron: config.ts con resolveBackendUrl() + build-config.ts |
| T007 | L | lib/backend-proxy.ts: proxyToBackend(request) |
| T008 | S | Route handlers: /api/[...path] y /api/_local/health |
| T009 | M | Electron: quitar Java y orquestar solo el Next local |
| T010 | M | Scripts de empaquetado y config de electron-builder |
| T011 | M | Modo web en Railway: Dockerfile y railway.toml de web/ |
| T012 | M | CI del instalador: eliminar JAR/JRE y construir el POS propio |
| T013 | S | omero (admin): "Abrir POS" usa NEXT_PUBLIC_POS_URL — PR aparte |
| T014 | M | Smoke test local end-to-end del build standalone |
| T015 | S | Tests root: configurar vitest y probar resolveBackendUrl |
| T016 | S | Tests unitarios de lib/runtime.ts |
| T017 | M | Tests unitarios de lib/backend-proxy.ts (fetch mockeado) |
| T018 | L | Tests de integración del proxy con backend falso (http.createServer) |
| T019 | S | Tests migrados del POS pasan en web/ |
| T020 | S | Umbrales de cobertura y gates de calidad |
| T021 | M | Documentación: CLAUDE.md, README, .env.example y web/README |
| T022 | S | Checklist manual, deuda técnica y pendientes |

## Notas de alcance
- Este plan **no** incluye SQLite, outbox, sesión larga, `mp_offline` ni la pantalla de ventas a revisar (fases 2–4), ni el borrado de `/pos` en `omero`.
- La estimación gruesa es de 2 a 4 jornadas de trabajo efectivo; el mayor riesgo de desvío es T007/T018 (proxy) y el empaquetado real en Windows/macOS (T014 y checklist manual T022).
