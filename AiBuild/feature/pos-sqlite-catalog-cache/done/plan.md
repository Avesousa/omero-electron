# Task Plan: Caché SQLite del catálogo para el POS desktop (Fase 2)

## Metadata
- **Date:** 2026-09-21
- **Branch:** feature/pos-sqlite-catalog-cache (repo `omero-electron`, base `develop`)
- **Type:** feature
- **Tests required:** yes (Unit + Integration + ABI real de Electron)
- **Total tasks:** 22 (4 S · 14 M · 4 L)
- **Parallelizable groups:** 7 waves (ver abajo)

## Executive summary
El plan arranca con la **actualización de Electron 33 → 40 en un commit aislado** (T001) y en paralelo prepara `better-sqlite3` como dependencia opcional de `web/` (T002). Luego resuelve el punto más riesgoso —el módulo nativo— con scripts de descarga con checksum y verificación bajo el ABI real de Electron (T003, T004). El núcleo son las piezas de `web/src/lib/catalog/` (política, tenant, store, syncer) y la capa de datos `handleApiRequest` que envuelve `proxyToBackend` en modo desktop (T005–T010). El cliente integra el estado de conexión **en el header existente del POS** (donde hoy hay un botón "Actualizar" que refresca productos y un chip de pendientes) y el logout borra la caché (T012). Cierran el empaquetado (T013), un smoke end-to-end con el backend caído (T014), los tests y la documentación. Sin cambios en `omero-backend`.

## Hallazgo durante el plan
El header del POS (`pos/page.tsx`) ya tiene un botón **"Actualizar"** que llama a `refreshProducts()` y un chip **"N pendientes sin sync"**. En desktop pasan a ser un único componente `ConnectionStatus` que solo se muestra cuando no hay conexión o hay pendientes, y cuyo botón únicamente verifica la conexión; en web el header no cambia.

## Phases and tasks

### Phase 0: Setup

- [ ] **T001** — Actualizar Electron 33 → 40 (commit aislado)
  - Detail: Subir `electron` a ^40.10.6 en el package.json raíz (y `electron-builder` a ^26 solo si la 25 falla con Electron 40; `@types/node` a ^24). `npm install` (con .npmrc legacy-peer-deps). Correr typecheck y tests. Smoke manual de `npm run dev`: ventana pantalla completa sin marco, splash, filtro de teclado (F1 bloqueado, numpad), re-foco al blur en empaquetado, `utilityProcess.fork`. Hacerlo en un commit propio (mensaje `chore(electron): 33 → 40`) para poder revertirlo sin tocar la caché. Anotar breaking changes encontrados.
  - Done when: `npm run check` pasa; `node -e "require('electron')"` reporta 40.x y `ELECTRON_RUN_AS_NODE=1 electron -e "console.log(process.versions.modules)"` imprime 143; `npm run dev` abre el POS con teclado y pantalla completa correctos; el cambio queda en un commit separado.
  - Dependencies: none
  - Can parallelize with: T002, T005
  - Files affected: package.json, package-lock.json, main/*.ts (solo si hay breaking changes)
  - Complexity: M

- [ ] **T002** — Dependencia better-sqlite3 en web/ (opcional) y config de build
  - Detail: En web/package.json: `optionalDependencies: { "better-sqlite3": "12.11.1" }` (versión exacta) y `@types/better-sqlite3` en devDependencies; `npm install`. En web/next.config.ts: `serverExternalPackages: ["better-sqlite3"]`. web/.gitignore: `.data/`. web/Dockerfile: `npm ci --omit=optional` (el modo web no carga SQLite ni compila nada nativo). Confirmar que `next build` funciona con y sin el módulo instalado.
  - Done when: `cd web && npm ci && npx tsc --noEmit && npm run build` OK; `npm ci --omit=optional && npm run build` también OK (sin better-sqlite3); `docker build web/` OK.
  - Dependencies: none
  - Can parallelize with: T001, T005
  - Files affected: web/package.json, web/package-lock.json, web/next.config.ts, web/.gitignore, web/Dockerfile
  - Complexity: M

- [ ] **T003** — scripts/fetch-native.mjs: binarios de Electron con checksum fijado
  - Detail: Nuevo scripts/fetch-native.mjs: para win32-x64, darwin-arm64 y darwin-x64 descarga `better-sqlite3-v12.11.1-electron-v143-<plat>-<arch>.tar.gz` desde GitHub Releases, verifica SHA-256 contra scripts/native-checksums.json (generado la primera vez y commiteado), extrae `build/Release/better_sqlite3.node` con el paquete `tar` y lo guarda como `resources/native/better_sqlite3-<plat>-<arch>.node`. Falla si el checksum no coincide o falta un binario. Scripts raíz: `fetch:native`. `.gitignore`: `resources/native/`. Agregar `tar` como devDependency raíz.
  - Done when: `npm run fetch:native` deja los 3 archivos en resources/native con checksums verificados; alterar un checksum hace fallar el script.
  - Dependencies: T001
  - Can parallelize with: T011
  - Files affected: scripts/fetch-native.mjs, scripts/native-checksums.json, package.json, .gitignore
  - Complexity: M

- [ ] **T004** — scripts/verify-native.mjs: carga con el ABI real de Electron
  - Detail: Nuevo scripts/verify-native.mjs: ubica el binario `resources/native/better_sqlite3-${process.platform}-${process.arch}.node` (o el indicado), ejecuta el Electron instalado con `ELECTRON_RUN_AS_NODE=1` corriendo un mini script que hace `new Database(":memory:", { nativeBinding })`, crea una tabla, inserta y ejecuta `SELECT sqlite_version()`, imprime la versión y sale 0; sale ≠0 si falla (ABI equivocado, archivo ausente). Script raíz `verify:native`.
  - Done when: `npm run verify:native` imprime la versión de SQLite en esta máquina; con un binario de otro ABI (p. ej. el de Node) falla con error claro.
  - Dependencies: T003
  - Files affected: scripts/verify-native.mjs, package.json
  - Complexity: M

### Phase 1: Foundation

- [ ] **T005** — catalog: types, cache-policy y tenant
  - Detail: web/src/lib/catalog/types.ts (CatalogStore, SnapshotResult, CatalogMeta, CatalogRoute). cache-policy.ts: `matchCatalogRoute(method, pathname, search)` → `{kind:"products"|"product"|"promotions", code?}` o null (solo GET; `/api/products` y `/api/promotions` sin query; `/api/products/{code}` excluyendo `search`, `bulk-upload` y otras palabras reservadas). tenant.ts: `tenantFromAuthHeader(header)` (decodifica payload base64url, valida `tenantId` con regex UUID, devuelve null si falla) y `tokenExpiry(header)`. Sin verificar firma (documentarlo en el código).
  - Done when: Funciones exportadas y tipadas; `tsc --noEmit` OK; comportamiento verificado en T015.
  - Dependencies: none
  - Can parallelize with: T001, T002
  - Files affected: web/src/lib/catalog/types.ts, web/src/lib/catalog/cache-policy.ts, web/src/lib/catalog/tenant.ts
  - Complexity: M

- [ ] **T006** — catalog: migraciones y SqliteCatalogStore
  - Detail: migrations.ts: array ordenado; migración 1 con products(id,code,barcode,json)+índices, promotions(id,json), sync_meta(resource,last_sync_at,payload_hash,item_count). sqlite-store.ts `SqliteCatalogStore` sobre better-sqlite3 (`nativeBinding` opcional): abre `<dataDir>/<tenantId>.sqlite` validando que la ruta resuelta quede dentro de dataDir; PRAGMA WAL/synchronous=NORMAL/busy_timeout; `PRAGMA user_version` + migraciones en transacción; downgrade (user_version mayor) o base corrupta (SQLITE_CORRUPT/NOTADB) → eliminar y recrear con log; `replaceProducts(list)`/`replacePromotions(list)` transaccionales con sha256 (si el hash no cambió solo actualiza last_sync_at); `upsertProduct(p)`; `getProducts()` y `getPromotions()` (devuelven el JSON crudo), `findProduct(code)` (code → barcode → id), `getMeta(resource)`, `close()`, `wipe()` (borra .sqlite/-wal/-shm).
  - Done when: Con un archivo temporal: crear, migrar, snapshot, leer, lookup y wipe funcionan; `tsc --noEmit` OK; cobertura en T016.
  - Dependencies: T002, T005
  - Files affected: web/src/lib/catalog/migrations.ts, web/src/lib/catalog/sqlite-store.ts
  - Complexity: L

- [ ] **T007** — runtime: getDataDir/getSqliteBinding y store-registry
  - Detail: runtime.ts: `getDataDir(env)` (OMERO_DATA_DIR; en dev sin definir y NODE_ENV≠production → `<cwd>/.data`; en producción sin definir → null), `getSqliteBinding(env)` (OMERO_SQLITE_BINDING o null), `getSyncIntervalMs(env)` (CATALOG_SYNC_INTERVAL_MS, default 300000, entero positivo). catalog/store-registry.ts: `getCatalogStore(tenantId)` — solo si runtime===desktop y hay dataDir; carga `better-sqlite3` de forma lazy con `require` en try/catch (si falla: log una sola vez y devuelve null); mantiene un Map de handles por tenant; `closeStore(tenantId)`; cualquier excepción al abrir → null (degrada a pass-through).
  - Done when: `getCatalogStore` devuelve null en web, sin dataDir o sin módulo; devuelve un store operativo en desktop con dataDir; sin efectos al importar (compatible con next build sin variables).
  - Dependencies: T006
  - Files affected: web/src/lib/runtime.ts, web/src/lib/catalog/store-registry.ts
  - Complexity: M

### Phase 2: Core

- [ ] **T008** — catalog-proxy y data-layer (read-through + fallback)
  - Detail: catalog/catalog-proxy.ts `proxyWithCatalog(request)`: si `matchCatalogRoute` no aplica o no hay tenant/store → `proxyToBackend`. Si aplica: registra el Authorization en el syncer, llama a `proxyToBackend`; con 200 lee el texto, parsea `{success,data}` y aplica snapshot (lista) o upsert (por código) sin bloquear la respuesta ante errores de caché (try/catch + log), y devuelve una Response nueva con el mismo body/headers; con 502/503/504 y datos locales responde 200 `{success:true,data}` con headers X-Omero-Cache: hit, X-Omero-Cache-At, X-Omero-Cache-Age; sin datos/no encontrado devuelve la respuesta original; cualquier otro status pasa sin cambios. data-layer.ts `handleApiRequest(request)`: runtime web → proxyToBackend; desktop → proxyWithCatalog. Documentar el punto de extensión para escrituras (fase 3).
  - Done when: Verificado por T018: online deja snapshot, backend caído sirve caché con headers, 401/404/500 no activan caché.
  - Dependencies: T005, T007
  - Can parallelize with: T009
  - Files affected: web/src/lib/catalog/catalog-proxy.ts, web/src/lib/data-layer.ts
  - Complexity: L

- [ ] **T009** — CatalogSyncer: refresco cada 5 min y sondeo de recuperación
  - Detail: catalog/syncer.ts: singleton en `globalThis` (seguro ante recargas de dev). `remember(tenantId, authHeader)` guarda en memoria el último Authorization y su exp (nunca en disco ni logs). Timer `unref` cada `getSyncIntervalMs()`: por cada tenant con token vigente hace fetch directo a `{BACKEND_URL}/api/products` y `/api/promotions` (con timeout) y aplica snapshot. Si falla → modo recuperación: sondea `/api/health` cada 30 s y al responder sincroniza de inmediato. 401 o token vencido → olvida el token hasta la próxima request autenticada. `setOnline(state)` pasivo para que connectivity informe. `stop()` para tests/cierre.
  - Done when: Con timers falsos: sincroniza a los 5 min, entra en recuperación tras fallo y sincroniza al volver; token vencido/401 detiene el intento (T017).
  - Dependencies: T005, T007
  - Can parallelize with: T008
  - Files affected: web/src/lib/catalog/syncer.ts
  - Complexity: M

- [ ] **T010** — Endpoints locales y route handler con la capa de datos
  - Detail: catalog/connectivity.ts `checkBackend()`: GET {BACKEND_URL}/api/health con `AbortSignal.timeout(3000)` → {online, checkedAt, latencyMs}. `app/api/%5Flocal/connectivity/route.ts` (GET → contrato de la tech-spec, incluye `runtime` y `cache` si hay Authorization+base; no dispara sincronización). `app/api/%5Flocal/cache/route.ts` (DELETE con Authorization → cierra el store, `wipe()`, olvida el token del syncer; 204; en web 204 no-op). `app/api/[...path]/route.ts`: delegar en `handleApiRequest`.
  - Done when: `GET /api/_local/connectivity` responde 200 online/offline; `DELETE /api/_local/cache` borra el archivo del tenant; el catch-all usa la capa de datos; `tsc` y `npm run build` OK.
  - Dependencies: T008, T009
  - Can parallelize with: T011
  - Files affected: web/src/lib/catalog/connectivity.ts, web/src/app/api/%5Flocal/connectivity/route.ts, web/src/app/api/%5Flocal/cache/route.ts, web/src/app/api/[...path]/route.ts
  - Complexity: M

- [ ] **T011** — Electron: OMERO_DATA_DIR y OMERO_SQLITE_BINDING al Next
  - Detail: process-manager.ts `startFrontend`: agregar al env `OMERO_DATA_DIR = path.join(app.getPath("userData"), "catalog-cache")` (distinto de userData/data de la H2 legacy) y, si está empaquetado, `OMERO_SQLITE_BINDING = <ROOT>/resources/native/better_sqlite3-${process.platform}-${process.arch}.node`. Loguear ambos (sin secretos). Crear el directorio si no existe.
  - Done when: `npm run typecheck` OK; el env del utilityProcess incluye ambas variables (verificado en T014).
  - Dependencies: T001
  - Can parallelize with: T003, T010
  - Files affected: main/process-manager.ts
  - Complexity: S

### Phase 3: Integration

- [ ] **T012** — POS: estado de conexión en el header y logout que borra la caché
  - Detail: Nuevo hooks/useConnectionStatus.ts: llama a GET /api/_local/connectivity al montar, cada 30 s, en eventos window online/offline y a demanda; expone {runtime, online, cache, checking, lastCheckedAt, check()}. Nuevo components/ConnectionStatus.tsx integrado en el header de pos/page.tsx (donde hoy están el chip "N pendientes sin sync" y el botón "Actualizar" que llama a refreshProducts): en desktop se muestran SOLO cuando `!online || pendingCount > 0`, con texto de estado ("Sin conexión con el servidor · catálogo de hace X min" / "N por subir") y el botón **Actualizar** cuya única acción es `check()` (verifica conexión; sin sincronizar ni enviar datos) con estado "Verificando…"; en web el header queda como hoy. shared/contexts/auth.tsx: `logout` llama best-effort a DELETE /api/_local/cache (con el Authorization vigente) antes de `clearSession()`; el 401 por expiración NO borra la caché. Respetar estilo oscuro del POS y el tamaño de fuente existente.
  - Done when: En desktop el aviso aparece solo sin conexión o con pendientes y el botón solo verifica; en web el header no cambia; el logout llama al DELETE (verificado en T019 y T014).
  - Dependencies: T010
  - Files affected: web/src/app/pos/hooks/useConnectionStatus.ts, web/src/app/pos/components/ConnectionStatus.tsx, web/src/app/pos/page.tsx, web/src/shared/contexts/auth.tsx
  - Complexity: M

- [ ] **T013** — Empaquetado: standalone con better-sqlite3 + binarios + CI
  - Detail: prepare-frontend.mjs: además del standalone, asegurar que `resources/frontend/node_modules/better-sqlite3` (+ `bindings`, `file-uri-to-path` si son necesarios) esté presente y limpiar su carpeta `build/` (el binario que se usa es el de resources/native); verificar que existan los 3 binarios en resources/native. electron-builder.config.ts: extraResources suma `resources/native → native`. package.json: `prepare:app` encadena `fetch:native` y `verify:native`. installer.yml: pasos `npm run fetch:native` y `npm run verify:native` (Windows) antes de `build:win`. Confirmar que un standalone construido con Node del sistema carga el módulo usando `nativeBinding` bajo el ABI de Electron.
  - Done when: `npm run prepare:app` deja resources/frontend + resources/native completos; `verify:native` pasa; installer.yml válido y sin referencias rotas.
  - Dependencies: T002, T003, T004
  - Can parallelize with: T012
  - Files affected: scripts/prepare-frontend.mjs, electron-builder.config.ts, package.json, .github/workflows/installer.yml
  - Complexity: M

- [ ] **T014** — Smoke end-to-end local (Electron ABI + backend caído)
  - Detail: Con el backend devdata (`omero-start/dev.sh`): construir web/, `prepare:app`, y correr el standalone de resources/frontend con el Node de Electron (`ELECTRON_RUN_AS_NODE=1`) y OMERO_RUNTIME=desktop + OMERO_DATA_DIR + OMERO_SQLITE_BINDING. Verificar: login → GET /api/products crea `<tenant>.sqlite`; detener el backend → GET /api/products, /api/products/{code} y /api/promotions responden con X-Omero-Cache: hit; /api/_local/connectivity online=false; reactivar backend → vuelve a online y el syncer refresca; DELETE /api/_local/cache borra el archivo; sin OMERO_DATA_DIR no hay caché y todo sigue funcionando. Probar también `npm run dev` de Electron (teclado, aviso y botón). Registrar resultados en manual-checklist.md.
  - Done when: Los checks pasan y quedan anotados con fecha en manual-checklist.md.
  - Dependencies: T010, T011, T012, T013
  - Files affected: AiBuild/feature/pos-sqlite-catalog-cache/WIP/manual-checklist.md
  - Complexity: L

### Phase 4: Quality

- [ ] **T015** — Tests unit: cache-policy, tenant y runtime
  - Detail: cache-policy: aplica/no aplica (query, /search, /bulk-upload, métodos distintos a GET, code con caracteres raros). tenant: JWT válido, sin tenantId, UUID inválido, base64url malformado, header sin "Bearer", exp. runtime: getDataDir (dev/prod), getSqliteBinding, getSyncIntervalMs (inválidos → default).
  - Done when: `npx vitest run` de esos archivos pasa; cobertura ≥85 % en cada módulo.
  - Dependencies: T005, T007
  - Can parallelize with: T016
  - Files affected: web/src/lib/catalog/cache-policy.test.ts, web/src/lib/catalog/tenant.test.ts, web/src/lib/runtime.test.ts
  - Complexity: S

- [ ] **T016** — Tests unit: migraciones y SqliteCatalogStore (SQLite real)
  - Detail: Con archivos temporales (`// @vitest-environment node`): crear y migrar v0→v1; user_version mayor → recrea; archivo corrupto → recrea; snapshot transaccional (si falla a mitad queda el snapshot previo); hash-skip (no reescribe si el payload es igual); lookups por code/barcode/id; upsertProduct; getMeta; wipe (elimina .sqlite/-wal/-shm); path traversal (tenantId con `..` o fuera del dataDir → error); apertura con `nativeBinding` inexistente → error controlado.
  - Done when: `npx vitest run` del archivo pasa; cobertura de sqlite-store/migrations ≥85 %.
  - Dependencies: T006
  - Can parallelize with: T015
  - Files affected: web/src/lib/catalog/sqlite-store.test.ts, web/src/lib/catalog/migrations.test.ts
  - Complexity: M

- [ ] **T017** — Tests unit: syncer y connectivity (timers falsos)
  - Detail: syncer: primer ciclo a los 5 min, modo recuperación a 30 s tras fallo, sincroniza al volver el health, token vencido/401 detiene el tenant, `remember` reemplaza token, `stop()` limpia timers; nunca loguea el Authorization. connectivity: online, offline (ECONNREFUSED), timeout de 3 s.
  - Done when: `npx vitest run` de esos archivos pasa; cobertura ≥85 %.
  - Dependencies: T009, T010
  - Can parallelize with: T018
  - Files affected: web/src/lib/catalog/syncer.test.ts, web/src/lib/catalog/connectivity.test.ts
  - Complexity: M

- [ ] **T018** — Tests de integración: capa de datos con backend falso y SQLite real
  - Detail: Backend falso `http.createServer` + `handleApiRequest` + SQLite en directorio temporal. Casos: online 200 deja snapshot y el segundo idéntico no reescribe; backend caído (conexión rechazada, timeout, 502, 503, 504) sirve caché con X-Omero-Cache*; sin datos locales devuelve 502/504 original; 401/403/404/500 no activan caché; producto eliminado en backend desaparece tras el siguiente snapshot; lookup por code/barcode con backend caído; `/api/products/search` y `?categoryId=` no usan caché; dos tenants no se mezclan; DELETE /api/_local/cache borra solo el del tenant; modo web no crea base ni carga el módulo nativo; degradación sin OMERO_DATA_DIR / sin módulo / dir sin permisos → pass-through sin error.
  - Done when: `npx vitest run` pasa de forma estable (3 corridas seguidas sin flakiness).
  - Dependencies: T008, T010
  - Can parallelize with: T017
  - Files affected: web/src/lib/catalog/catalog-proxy.integration.test.ts
  - Complexity: L

- [ ] **T019** — Tests de UI: useConnectionStatus, ConnectionStatus y logout
  - Detail: Testing Library: en desktop con online=false o pendingCount>0 el aviso aparece; con online=true y sin pendientes no aparece; en web no aparece; el botón Actualizar llama solo a /api/_local/connectivity (nada más), muestra "Verificando…" y actualiza el estado; eventos online/offline disparan chequeo; el polling se limpia al desmontar. Logout llama a DELETE /api/_local/cache con el Authorization y sigue aunque falle; 401 por expiración no la llama.
  - Done when: `npx vitest run` de esos archivos pasa.
  - Dependencies: T012
  - Files affected: web/src/app/pos/hooks/useConnectionStatus.test.ts, web/src/app/pos/components/ConnectionStatus.test.tsx, web/src/shared/contexts/auth.test.tsx
  - Complexity: M

- [ ] **T020** — Umbrales de cobertura, gates y CI
  - Detail: vitest.config.mts (web): agregar `src/lib/catalog/**` y `src/lib/data-layer.ts` al `coverage.include` con umbral 85 %. Scripts `check` de web y raíz siguen siendo el gate; installer.yml corre `npm run check` (raíz y web) antes de fetch/verify-native y del build. Ejecutar toda la suite.
  - Done when: `npm run check` pasa en web y raíz; el workflow invoca los gates y `verify:native`.
  - Dependencies: T015, T016, T017, T018, T019, T013
  - Files affected: web/vitest.config.mts, package.json, .github/workflows/installer.yml
  - Complexity: S

### Phase 5: Polish

- [ ] **T021** — Documentación y spec ajustada
  - Detail: Actualizar CLAUDE.md (arquitectura de la capa de datos, env nuevas OMERO_DATA_DIR / OMERO_SQLITE_BINDING / CATALOG_SYNC_INTERVAL_MS, empaquetado nativo, Electron 40 y requisito macOS 12+), README.md y web/README.md, web/.env.example. Ajustar la technical-spec: el aviso se integra en el header existente (`ConnectionStatus`, no un banner nuevo) y el botón actual "Actualizar" (refreshProducts) queda solo en web.
  - Done when: Un desarrollador nuevo puede levantar el modo desktop con caché siguiendo el README; la spec refleja lo construido.
  - Dependencies: T012, T013
  - Can parallelize with: T022
  - Files affected: CLAUDE.md, README.md, web/README.md, web/.env.example, AiBuild/feature/pos-sqlite-catalog-cache/WIP/technical-spec.md
  - Complexity: M

- [ ] **T022** — Checklist manual, deuda técnica y pendientes
  - Detail: Completar manual-checklist.md: instalador Windows x64 y macOS (arm64 y x64) — se crea la base, sirve sin internet, el aviso y el botón, logout borra la base, sin procesos huérfanos; regresión de Electron 40 (numpad, F1, foco, fullscreen, splash, cierre limpio); requisito macOS 12+. Deuda: Node 20 EOL en Docker/CI, `middleware`→`proxy`, sesión de 1 h (fase 4), outbox (fase 3), H2→Railway, cifrado de la base.
  - Done when: Archivo completo y referenciado desde el PR; pendientes reflejados en la memoria del proyecto.
  - Dependencies: T014
  - Can parallelize with: T021
  - Files affected: AiBuild/feature/pos-sqlite-catalog-cache/WIP/manual-checklist.md
  - Complexity: S

## Dependency map
```
T001 ─┬─► T003 ─► T004 ─┐
      │                  ├─► T013 ─┐
      └─► T011 ──────────┘         │
T002 ─┬─► T006 ─► T007 ─┬─► T008 ─┬─► T010 ─┬─► T012 ─┬─► T014 ─► T022
T005 ─┘                 └─► T009 ─┘         │         └─► T019
                                            └─► T017/T018
T013 ─────────────────────────────────────────────────► T014
T015 (T005,T007) · T016 (T006) · T017 (T009,T010) · T018 (T008,T010) · T019 (T012)
T015–T019 + T013 ─► T020 ;  T012,T013 ─► T021 ;  T014 ─► T022
```

## Parallelizable groups
- **Wave 1** (sin dependencias): T001, T002, T005
- **Wave 2**: T003 y T011 (tras T001); T006 (tras T002 y T005)
- **Wave 3**: T004 (tras T003); T007 y T016 (tras T006)
- **Wave 4**: T008, T009 y T015 (tras T005/T007)
- **Wave 5**: T010 (tras T008 y T009); T013 (tras T002, T003, T004)
- **Wave 6**: T012, T017 y T018 (tras T010)
- **Wave 7**: T019, T014, T020, T021, T022

**Conflictos de archivos entre tareas paralelas:** `package.json` raíz lo tocan T001, T003, T004, T013 y T020; `web/package.json` y `web/vitest.config.mts` T002 y T020; `installer.yml` T013 y T020; `web/src/lib/runtime.ts` T007 y su test T015. Integrar en orden (T001 → T003 → T004 → T013 → T020) o asignarlos al mismo agente. **T001 va en un commit separado** aunque las demás tareas se agrupen.

## Ruta crítica
T001 → T003 → T004 → T013 → T014 → T022, y en paralelo T002 → T006 → T007 → T008 → T010 → T012 → T014.

## Risks and mitigations
| Risk | Probability | Mitigation |
|------|------------|------------|
| Binario nativo con ABI equivocado en el instalador | Alta | T003 (checksums) + T004 (`ELECTRON_RUN_AS_NODE` con ABI 143) + paso en CI (T013/T020); selección por `process.arch` |
| El standalone de Next no incluye `better-sqlite3` o sus dependencias | Media | `serverExternalPackages` (T002) + copia y verificación explícita en `prepare-frontend` (T013) + smoke con el standalone empaquetado (T014) |
| Regresiones por Electron 33 → 40 (teclado, foco, fullscreen, empaquetado) | Media | T001 aislado, smoke manual, checklist (T022); revertible sin tocar la caché |
| `electron-builder` 25 incompatible con Electron 40 | Baja | Subir a ^26 dentro de T001 si falla |
| macOS < 12 no puede usar Electron ≥ 38 | Baja | Documentado en T021/T022; confirmar con clientes antes del rollout |
| Tests de integración inestables (timers/SQLite) | Media | Directorios temporales, timers falsos, señales explícitas; criterio de 3 corridas seguidas (T018) |
| Modo web/Docker rompe por el módulo nativo | Media | `optionalDependencies` + `--omit=optional` + carga lazy solo en desktop + test de modo web (T002, T018) |
| Colisión de archivos al paralelizar | Media | Orden de integración documentado arriba |
| Servir datos viejos sin que el cajero lo note | Media | `ConnectionStatus` con antigüedad y headers `X-Omero-Cache-*` |
| Sesión de 1 h sin conexión impide reiniciar | Alta (conocida) | Limitación aceptada; fase 4 |

## Complexity summary
| Task | S/M/L/XL | Reason |
|------|----------|--------|
| T001 | M | Actualizar Electron 33 → 40 (commit aislado) |
| T002 | M | Dependencia better-sqlite3 en web/ (opcional) y config de build |
| T003 | M | scripts/fetch-native.mjs: binarios de Electron con checksum fijado |
| T004 | M | scripts/verify-native.mjs: carga con el ABI real de Electron |
| T005 | M | catalog: types, cache-policy y tenant |
| T006 | L | catalog: migraciones y SqliteCatalogStore |
| T007 | M | runtime: getDataDir/getSqliteBinding y store-registry |
| T008 | L | catalog-proxy y data-layer (read-through + fallback) |
| T009 | M | CatalogSyncer: refresco cada 5 min y sondeo de recuperación |
| T010 | M | Endpoints locales y route handler con la capa de datos |
| T011 | S | Electron: OMERO_DATA_DIR y OMERO_SQLITE_BINDING al Next |
| T012 | M | POS: estado de conexión en el header y logout que borra la caché |
| T013 | M | Empaquetado: standalone con better-sqlite3 + binarios + CI |
| T014 | L | Smoke end-to-end local (Electron ABI + backend caído) |
| T015 | S | Tests unit: cache-policy, tenant y runtime |
| T016 | M | Tests unit: migraciones y SqliteCatalogStore (SQLite real) |
| T017 | M | Tests unit: syncer y connectivity (timers falsos) |
| T018 | L | Tests de integración: capa de datos con backend falso y SQLite real |
| T019 | M | Tests de UI: useConnectionStatus, ConnectionStatus y logout |
| T020 | S | Umbrales de cobertura, gates y CI |
| T021 | M | Documentación y spec ajustada |
| T022 | S | Checklist manual, deuda técnica y pendientes |

## Notas de alcance
- **No** incluye escrituras offline, outbox, `mp_offline`, ventas a revisar, sesión larga de dispositivo, migración H2 → Railway ni cambios en `omero-backend`.
- Estimación gruesa: 4 a 6 jornadas de trabajo efectivo. Mayor riesgo de desvío: T006/T008/T018 (capa de datos), y T003/T004/T013 más el checklist en Windows y macOS (empaquetado nativo).
