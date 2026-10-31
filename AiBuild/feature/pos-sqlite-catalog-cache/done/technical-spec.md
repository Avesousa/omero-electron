# Technical Spec: Caché SQLite del catálogo para el POS desktop (Fase 2)

## Metadata
- **Fecha:** 2026-09-21
- **Rama:** `feature/pos-sqlite-catalog-cache` (base `develop`)
- **Basado en:** functional-spec.md
- **Estado:** WIP

## Resumen técnico
Se agrega una **capa de datos** entre el route handler `/api/*` y `proxyToBackend`. En modo `web` es un pass-through (sin cambios). En modo `desktop`, para tres lecturas de catálogo (`GET /api/products`, `GET /api/products/{code}`, `GET /api/promotions`) hace *read-through*: llama al backend, actualiza SQLite (`better-sqlite3`, una base por tenant) y, si el backend falla por red/timeout/502/503/504, responde desde SQLite. Un **syncer** en el propio Next refresca la caché cada 5 min y al recuperar conexión. El POS suma un aviso con botón "Actualizar" que solo consulta `/api/_local/connectivity`. Como primera tarea se **actualiza Electron 33 → 40** en un commit aislado.

## Decisiones de plataforma (acordadas)
| Tema | Decisión | Por qué |
|---|---|---|
| Electron | **33 → 40** (40.10.6), en **commit propio al inicio** | 33 está fuera de soporte (vigentes 42-44). 40 es el techo con binarios de `better-sqlite3` (ABI 143). Aislado para revertir sin tocar la caché |
| Motor | **`better-sqlite3` 12.11.1** (fijado exacto) | La 13.x no publicó binarios (0 assets) y exige Node ≥22; la 12.x cubre Electron hasta ABI 143 en win-x64, mac-arm64, mac-x64 |
| Runtime del Next en desktop | Node 24 (el de Electron 40) | El build se hace con Node 20/22; el standalone corre en Node 24 (verificado en el checklist) |

## Estructura (nuevo y modificado)

```
web/src/lib/
├── runtime.ts                    + getDataDir(), getSqliteBinding()
├── backend-proxy.ts              (sin cambios; lo reutiliza la capa de datos)
├── data-layer.ts                 handleApiRequest(request): web → proxyToBackend; desktop → proxyWithCatalog
└── catalog/
    ├── types.ts                  CatalogStore, SnapshotResult, CatalogMeta
    ├── cache-policy.ts           matchCatalogRoute(method, pathname, search) → route | null
    ├── tenant.ts                 tenantFromAuthHeader(), tokenExp() — decodifica el JWT (sin verificar firma)
    ├── migrations.ts             migraciones ordenadas (PRAGMA user_version)
    ├── sqlite-store.ts           SqliteCatalogStore (una base por tenant)
    ├── store-registry.ts         getCatalogStore(tenantId): abre lazy, cachea handles, degrada a null
    ├── catalog-proxy.ts          proxyWithCatalog(request): read-through + fallback
    ├── syncer.ts                 CatalogSyncer: timer 5 min + sondeo de recuperación
    └── connectivity.ts           checkBackend(): ping a {BACKEND_URL}/api/health
web/src/app/api/
├── [...path]/route.ts            ahora delega en handleApiRequest
└── %5Flocal/
    ├── connectivity/route.ts     GET  → estado backend + estado de caché
    └── cache/route.ts            DELETE → borra la base del tenant (logout)
web/src/app/pos/
├── hooks/useConnectionStatus.ts  polling + eventos online/offline + botón
└── components/ConnectionBanner.tsx  aviso "Actualizar" (solo desktop)
web/src/shared/contexts/auth.tsx  logout → DELETE /api/_local/cache (best effort)
main/process-manager.ts           + OMERO_DATA_DIR, OMERO_SQLITE_BINDING
scripts/fetch-native.mjs          descarga binarios de Electron (checksums fijados)
scripts/verify-native.mjs         carga el módulo con ELECTRON_RUN_AS_NODE (ABI real)
scripts/prepare-frontend.mjs      + copia resources/native y verifica
```

## Arquitectura y patrones

### Decisión 1: Intercepción por *política de caché* en la capa de datos (no rutas dedicadas)
`handleApiRequest` decide con `matchCatalogRoute`. Rutas dedicadas (`api/products/[code]/route.ts`) chocarían con `/api/products/search` y `/api/products/bulk-upload` (el segmento dinámico las capturaría). La política es una tabla explícita:

| Método + ruta | Recurso | Con caché |
|---|---|---|
| `GET /api/products` **sin query** | `products` (lista) | read-through + snapshot |
| `GET /api/products/{code}` (code ≠ `search`, ni palabras reservadas) | `product` | read-through + upsert; fallback por código, barcode o id |
| `GET /api/promotions` **sin query** | `promotions` | read-through + snapshot |
| cualquier otra | — | pass-through |

Con query (`?categoryId=`) **no** se usa la caché (el POS no la envía; evita servir listas incorrectas). El punto de extensión para la fase 3 es la misma tabla (agregar reglas de escritura) sin tocar el route handler.

### Decisión 2: `CatalogStore` como interfaz, `SqliteCatalogStore` como implementación
Permite cambiar de motor (p. ej. `node:sqlite` cuando madure) sin tocar el proxy. El módulo nativo se carga **de forma lazy y solo en `desktop`**; cualquier fallo de carga/apertura degrada a pass-through y se loguea (nunca rompe una request).

### Decisión 3: Snapshot completo transaccional
Cada respuesta 200 de la lista reemplaza el recurso en una transacción (`DELETE` + `INSERT` con sentencia preparada + `sync_meta`). Detecta eliminados sin cambios de backend y una falla a mitad deja la versión previa. Se calcula `sha256` del payload y **si no cambió se omite la escritura** (solo se actualiza `last_sync_at`).

### Decisión 4: Sincronización en el Next (no en el navegador)
`CatalogSyncer` (singleton en `globalThis`, seguro ante recargas de dev) guarda **en memoria** el último `Authorization` por tenant (nunca en disco ni logs) y su `exp`. Cada 5 min descarga `products` y `promotions` directo al backend y aplica snapshot. Si falla, entra en **modo recuperación**: sondea `/api/health` cada 30 s y, al responder, sincroniza de inmediato. Si el token venció o el backend responde 401, olvida el token hasta la siguiente request autenticada (limitación aceptada: JWT de 1 h, fase 4).

### Decisión 5: Aviso en el cliente que solo verifica conexión
`GET /api/_local/connectivity` hace un ping con timeout de 3 s y devuelve el estado; **no** dispara sincronización ni envía datos (semántica acordada). El estado que registra es pasivo (el syncer lo usa para decidir el sondeo).

## Modelo de datos (SQLite, por tenant)
Archivo: `<OMERO_DATA_DIR>/<tenantId>.sqlite` (UUID validado). `PRAGMA journal_mode=WAL; synchronous=NORMAL; busy_timeout=3000` (es una caché prescindible; la fase 3 usará otra política de durabilidad para el outbox).

### Migración 1 (`user_version = 1`)
```sql
CREATE TABLE products (
  id      TEXT PRIMARY KEY,          -- String(product.id)
  code    TEXT NOT NULL,
  barcode TEXT,                      -- String(product.barcode) o NULL
  json    TEXT NOT NULL              -- ProductResponseDto tal como lo devolvió el backend
);
CREATE INDEX idx_products_code    ON products(code);
CREATE INDEX idx_products_barcode ON products(barcode);

CREATE TABLE promotions (
  id   TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE sync_meta (
  resource     TEXT PRIMARY KEY,     -- 'products' | 'promotions'
  last_sync_at TEXT NOT NULL,        -- ISO-8601 (UTC)
  payload_hash TEXT NOT NULL,        -- sha256 del último snapshot
  item_count   INTEGER NOT NULL
);
```
Se guarda el JSON crudo por ítem para servir **exactamente** el mismo DTO que el backend (sin mapeos que se desincronicen). Las columnas `code`/`barcode` existen solo para los lookups.

### Versionado y recuperación
- Al abrir: `PRAGMA user_version` → ejecuta migraciones pendientes en una transacción.
- `user_version` **mayor** que la conocida (downgrade) o base corrupta (`SQLITE_CORRUPT`/`SQLITE_NOTADB`) → se **elimina y recrea** (es solo caché) y se loguea.
- Cada migración futura es un elemento nuevo del array (nunca se edita una publicada).

## API / Contratos

### Respuestas servidas desde caché (mismo contrato que el backend)
```
200 { "success": true, "data": [ ...ProductResponseDto ] }          // lista
200 { "success": true, "data": { ...ProductResponseDto } }          // por código
200 { "success": true, "data": [ ...Promotion ] }                   // promociones
Headers: X-Omero-Cache: hit
         X-Omero-Cache-At: 2026-09-21T14:03:00.000Z
         X-Omero-Cache-Age: 742            (segundos)
```
- **Cuándo se sirve la caché:** el proxy devolvió 502/503/504 (incluye red caída y timeout, que `proxyToBackend` ya mapea a 502/504) **y** hay datos locales. Si no hay datos (`sync_meta` sin fila) o el código no existe en caché, se devuelve la respuesta original (502/504).
- **No se sirve la caché:** 2xx (se actualiza), 401, 403, 404, 400, 500 y demás → pasan sin modificar.
- Búsqueda por código en caché: `code = ?` → `barcode = ?` → `id = ?` (mismo orden que `findProductByCode` del POS).

### `GET /api/_local/connectivity` (nuevo, local — no se proxea)
```
200 {
  "online": true|false,
  "checkedAt": "2026-09-21T14:05:10.000Z",
  "latencyMs": 84,                 // null si offline
  "runtime": "desktop"|"web",
  "cache": null | {                // null en web, sin Authorization o sin base
    "lastSyncAt": "...", "ageSeconds": 742, "products": 1543, "promotions": 4
  }
}
```
El chequeo es `GET {BACKEND_URL}/api/health` con `AbortSignal.timeout(3000)`. Siempre responde 200 (el resultado va en `online`).

### `DELETE /api/_local/cache` (nuevo, local)
Requiere `Authorization` (para derivar el tenant). Cierra el handle, borra `<tenant>.sqlite`, `-wal` y `-shm`, y olvida el token del syncer. `204` siempre que no haya error de I/O (en `web` es no-op `204`). Lo invoca el logout del POS; el 401 por expiración **no** borra la caché.

### Variables de entorno nuevas
| Variable | Dónde | Descripción |
|---|---|---|
| `OMERO_DATA_DIR` | Next (desktop) | Directorio de las bases. Electron lo inyecta: `<userData>/catalog-cache` (distinto de `<userData>/data`, que usaba la H2 legacy). En dev sin definir: `web/.data` (solo si `NODE_ENV !== 'production'`); en producción sin definir → sin caché |
| `OMERO_SQLITE_BINDING` | Next (desktop) | Ruta al `.node` de Electron para la plataforma/arquitectura. Si falta se usa el binding por defecto (dev con Node del sistema) |
| `CATALOG_SYNC_INTERVAL_MS` | Next (desktop) | Opcional, default `300000` |

## Seguridad
- **Tenant desde el JWT sin verificar la firma** (no es posible offline): se usa **solo** para elegir el archivo local, nunca para autorizar nada en el backend (que siempre valida el JWT). Se valida `tenantId` contra regex UUID y se comprueba que la ruta resuelta quede dentro de `OMERO_DATA_DIR` (anti path traversal).
- El `Authorization` vive solo en memoria (Map), no se persiste ni se loguea.
- La base contiene precios de costo y venta: queda en el perfil del usuario del SO (mismo nivel de exposición que el `localStorage` actual). Cifrado (SQLCipher) queda **fuera de alcance**.
- Los errores de la caché no exponen rutas ni SQL al cliente; se loguean en servidor.
- Los binarios nativos se descargan de GitHub Releases con **checksum SHA-256 fijado** en `scripts/native-checksums.json` (el build falla si no coincide).

## Dependencias
| Paquete | Versión | Alcance | Propósito | Alternativa considerada |
|---|---|---|---|---|
| better-sqlite3 | 12.11.1 (exacta) | `web` — `optionalDependencies` | SQLite síncrono y durable | sql.js (débil para outbox), node:sqlite (experimental), 13.x (sin binarios) |
| @types/better-sqlite3 | última | `web` dev | Tipos | — |
| tar | ^7 | raíz dev | Extraer los binarios en `fetch-native` | `tar` del sistema (no siempre en Windows) |
| electron | ^40.10.6 | raíz dev | Runtime (**upgrade desde 33.4**) | quedarse en 33 |
| electron-builder | ^26 (si 25 falla con Electron 40) | raíz dev | Empaquetado | — |
| @types/node | ^24 | raíz dev | Alinear con el Node de Electron 40 | — |

`optionalDependencies` para que `npm ci --omit=optional` en el Dockerfile del modo web **no compile ni descargue** nada nativo (Alpine/musl).

## Empaquetado del módulo nativo (riesgo principal)

**Problema:** tres ABIs distintos — desarrollo local (Node del sistema), Docker/CI (Node 20 → ABI 115) y **Electron 40 (ABI 143)**. Un `.node` compilado para el ABI equivocado falla al cargar.

**Solución:**
1. `web/package.json`: `serverExternalPackages: ['better-sqlite3']` en `next.config.ts` (no se bundlea) y se carga con `require` lazy dentro de un `try/catch` solo si `runtime === 'desktop'`.
2. **`scripts/fetch-native.mjs`**: descarga `better-sqlite3-v12.11.1-electron-v143-{win32-x64|darwin-arm64|darwin-x64}.tar.gz`, verifica SHA-256, extrae `build/Release/better_sqlite3.node` y lo guarda como `resources/native/better_sqlite3-<platform>-<arch>.node`.
3. **`prepare-frontend.mjs`**: además de copiar el standalone, copia el JS de `better-sqlite3` que traza Next (`node_modules/better-sqlite3`, `bindings`, `file-uri-to-path`) y **verifica** que existan los binarios de `resources/native`.
4. **Elección del binario en runtime:** Electron pasa `OMERO_SQLITE_BINDING=<resources>/native/better_sqlite3-${process.platform}-${process.arch}.node`; el store abre con `new Database(file, { nativeBinding })`. Así el DMG **universal** funciona sin `lipo` sobre extraResources: ambos binarios viajan y se elige por `process.arch`.
5. **`scripts/verify-native.mjs`**: ejecuta el Electron instalado con `ELECTRON_RUN_AS_NODE=1` (ABI real 143) y carga el binding de la plataforma actual → abre `:memory:` y ejecuta `SELECT sqlite_version()`. Falla con ABI equivocado. Se corre en el workflow del instalador (Windows) y localmente en macOS.
6. `electron-builder.config.ts`: `extraResources` suma `resources/native → native`.
7. **Dockerfile web**: `npm ci --omit=optional`.

## Cambios en Electron (`main/`)
- `package.json`: `electron` a `^40.10.6` (commit **T-Electron**, aislado). Verificar: `before-input-event` (`keyboard.ts`), `fullscreen/frame:false`, re-foco al `blur`, `contextBridge`, `utilityProcess.fork`, `electron-log`/`logtail`, `electron-updater` (stub).
- `process-manager.ts`: agrega `OMERO_DATA_DIR = path.join(app.getPath('userData'), 'catalog-cache')` y `OMERO_SQLITE_BINDING` (empaquetado) al `env` del Next.
- Requisito de SO: Electron ≥38 exige **macOS 12+** (Windows 10+, sin cambio). Se documenta.

## Performance
- Snapshot de ~5 000 productos en una transacción con sentencia preparada: decenas de ms; el `sha256` evita reescrituras cuando no hay cambios (lo normal cada 5 min).
- Las listas se **bufferizan** (el body se lee completo para poder guardarlo); son respuestas de cientos de KB a pocos MB. El resto del proxy sigue en streaming.
- `better-sqlite3` es síncrono: operaciones de ms; se evita bloquear con lecturas pesadas (la lista se arma con un solo `SELECT json`).
- Un solo timer por proceso (`unref`), sin trabajo si no hay token vigente.
- Índices en `products(code)` y `products(barcode)` para los lookups.

## Testing plan (`tests_required = true`, Unit + Integration + ABI de Electron)

### Cobertura obligatoria
- `web/src/lib/catalog/**` y `data-layer.ts`: **≥85 %** (líneas/funciones/branches), sumados al umbral existente de `runtime`/`backend-proxy`.
- `main/config.ts` mantiene 100 %.

### Unit
- `cache-policy`: rutas que aplican/no (con query, `/search`, `/bulk-upload`, otros métodos).
- `tenant`: JWT válido, sin `tenantId`, UUID inválido, base64url mal formado, `exp`.
- `migrations`/`sqlite-store` (SQLite real en archivo temporal): crear, migrar de v0→v1, downgrade (`user_version` mayor → recrea), base corrupta → recrea, snapshot transaccional (rollback si falla a mitad), hash-skip, lookups por code/barcode/id, borrado por tenant, path traversal.
- `syncer` con timers falsos: ciclo de 5 min, modo recuperación 30 s, token vencido, 401.
- `connectivity`: online/offline/timeout.

### Integration (backend falso + SQLite real + `handleApiRequest`)
- Online: 200 pasa y deja snapshot; el segundo idéntico no reescribe.
- Backend caído (red/timeout/502/503/504): sirve caché con headers `X-Omero-Cache*`; sin caché → 502/504 original.
- 401/403/404/500 **no** activan caché.
- Producto eliminado en el backend desaparece tras el siguiente snapshot.
- Lookup por código/barcode con backend caído; `/api/products/search` y `?categoryId=` no usan caché.
- Dos tenants no se mezclan; `DELETE /api/_local/cache` borra solo el suyo.
- Modo web: no se crea ninguna base ni se carga el módulo nativo.
- Degradación: sin `OMERO_DATA_DIR`, módulo nativo ausente o directorio sin permisos → pass-through sin error.

### UI (Testing Library)
- `ConnectionBanner`/`useConnectionStatus`: aparece sin conexión o con pendientes, oculto en web, el botón solo llama a connectivity y muestra estado de verificación.

### Verificación con el ABI real de Electron
- `scripts/verify-native.mjs` en CI (Windows) y local (macOS).

### Checklist manual (en el plan)
- Instalador Windows y macOS (arm64 y x64): la caché se crea, sirve sin internet, el logout la borra; sin procesos huérfanos.
- Electron 40: teclado/numpad, foco, pantalla completa, splash, cierre limpio.

## Explorado y descartado
| Alternativa | Por qué se descarta |
|---|---|
| `sql.js` (WASM) | Persistencia exportando el archivo completo; débil para el outbox de la fase 3 |
| `node:sqlite` (Electron 40 / Node 24) | Sigue marcado experimental (`ExperimentalWarning`); riesgo para la base de las ventas. Queda abierta detrás de `CatalogStore` |
| `better-sqlite3` 13.x | Sin binarios publicados y exige Node ≥22 |
| Electron 41+ | `better-sqlite3` 12.x aún no tiene binarios para ABI ≥145 |
| Quedarse en Electron 33 | Sin soporte; no permite las versiones nuevas de Node/SQLite |
| Rutas dedicadas `api/products/[code]/route.ts` | El segmento dinámico captura `/search` y `/bulk-upload` |
| Delta con `updatedSince` | El backend no lo soporta y borra físicamente; requeriría cambios en `omero-backend` (fuera de alcance) |
| Sincronizar desde el navegador | Depende de que el POS esté abierto y del `localStorage`; el syncer en el Next es independiente de la UI |
| Persistir el token para sincronizar tras reiniciar | Superficie de seguridad que la fase 4 (token de dispositivo) resuelve de forma correcta |
| Guardar tablas normalizadas por columna del DTO | Se desincroniza cuando el backend agrega campos; el JSON crudo sirve el DTO exacto |
| SQLCipher | Fuera de alcance |

## Flujo técnico

```
POS (navegador/Electron) ── GET /api/products (Authorization: Bearer JWT) ──┐
                                                                            ▼
                                            [...path]/route.ts → handleApiRequest()
                                                 │ runtime=web ──────────────► proxyToBackend ──► backend
                                                 │ runtime=desktop
                                                 ▼
                                    matchCatalogRoute(GET /api/products)?  ── no ─► proxyToBackend
                                                 │ sí
                                    tenant = JWT.tenantId ; store = getCatalogStore(tenant)
                                    syncer.remember(tenant, Authorization)
                                                 ▼
                                    res = proxyToBackend(request)
                        ┌────────────────────────┼─────────────────────────┐
                    200 OK                502/503/504                  otro (401/404/500…)
                        │                        │                          │
             texto → snapshot (tx)     store.read() ── hay datos ─► 200 + X-Omero-Cache   pass-through
             (hash-skip si igual)               └── sin datos ─────► respuesta original
                        │
                  devuelve la respuesta

CatalogSyncer (Next, in-process):  cada 5 min → GET backend /api/products + /api/promotions → snapshot
                                   si falla → modo recuperación: /api/health cada 30 s → al responder, sync

POS: useConnectionStatus → GET /api/_local/connectivity (30 s, eventos online/offline, botón "Actualizar")
     ConnectionBanner visible si desktop && (!online || pendientes > 0)
Logout → DELETE /api/_local/cache → borra <tenant>.sqlite
```

## Riesgos y mitigaciones
| Riesgo | Prob. | Mitigación |
|---|---|---|
| Binario nativo con ABI equivocado en el instalador | Alta | `fetch-native` con checksum + `verify-native` con `ELECTRON_RUN_AS_NODE` en CI y local; binarios por plataforma elegidos por `process.arch` |
| Standalone de Next no incluye `better-sqlite3`/`bindings` | Media | `serverExternalPackages` + copia explícita y verificación en `prepare-frontend` |
| Regresiones por Electron 33 → 40 (teclado, foco, fullscreen) | Media | Commit aislado, checklist manual, se puede revertir sin afectar la caché |
| macOS <12 no puede actualizar (Electron ≥38) | Baja | Documentado; se confirma con los clientes antes del rollout |
| Servir datos viejos sin que el cajero lo note | Media | Aviso con antigüedad; headers `X-Omero-Cache-*` |
| El módulo nativo rompe el modo web/Docker | Media | `optionalDependencies` + `--omit=optional` + carga lazy solo en desktop + test de modo web |
| Caché corrupta bloquea el POS | Baja | Se elimina y recrea; cualquier error degrada a pass-through |
| Sesión vencida (1 h) sin conexión impide entrar | Alta (conocida) | Limitación aceptada; resuelve la fase 4 |
| Node 20 (Docker/CI) ya está fuera de soporte | Media | Anotado como deuda (subir a 22/24 en otro cambio); el desktop corre en Node 24 |

## Ajustes y decisiones tomadas durante el build (2026-09-21)
| Tema | Decisión | Motivo |
|---|---|---|
| Dockerfile web | `npm ci` **sin** `--omit=optional` (la spec decía lo contrario) | `--omit=optional` omite TODAS las optionals, incluidas `lightningcss-*` (Tailwind 4) y SWC de Next: el build fallaba (`Cannot find module lightningcss.linux-x64-musl.node`). `better-sqlite3` publica binarios musl y, si fallara, npm tolera una optional. La imagen web no lo incluye (no se traza sin `require`) |
| Aviso en el POS | `ConnectionStatus` integrado **en el header existente** (no un banner nuevo) | El header ya tenía el botón "Actualizar" (refresca productos) y el chip de pendientes: en desktop pasan a un solo componente, visible solo sin conexión o con pendientes; en web no cambia |
| Rutas de recursos | `main/paths.ts` con `process.resourcesPath` | `dirname(exe)/resources` solo era válido en Windows; en macOS los recursos están en `Contents/Resources` (bug latente de la fase 1) |
| Orden de la lista | `upsert` con `ON CONFLICT DO UPDATE` | `INSERT OR REPLACE` movía la fila al final y alteraba el orden del backend (lo detectó el smoke) |
| Archivos extra | `catalog/snapshot.ts` (parseo defensivo del envelope) y `catalog/connectivity.ts` (movido antes: el syncer lo usa para sondear) | Compartir la lógica entre el proxy y el syncer |
| verify-native | Acepta `--module` (para validar la copia empaquetada dentro de `resources/frontend`) y `--binding` | La cadena `prepare:app` verifica lo que realmente se empaqueta |
| Timeout del hook | `AbortController` + `setTimeout` en vez de `AbortSignal.timeout` | Compatibilidad con navegadores viejos (modo web) y con timers falsos en tests |
| Workflow | Sin pasos separados de `fetch:native`/`verify:native` | `build:win` ya los encadena vía `prepare:app` |
| Máquina de desarrollo | Mac Intel (x64) | `verify:native` solo puede cargar el binario `darwin-x64`; el `arm64` requiere un Mac Apple Silicon |
| Tests | 299 en `web` (incl. 41 de integración con backend HTTP real + SQLite real) y 16 en la raíz | Cobertura de la capa nueva: 96,9 % (umbral 85 %) |
| Carga de better-sqlite3 | `createRequire(cwd/noop.js)` en `store-registry.ts`; se quitó `serverExternalPackages`; `prepare-frontend` **copia** `lib/` + `package.json` (la spec decía: `serverExternalPackages` + que Next lo trace) | Con `require` estático Turbopack falló en el build de Docker (`Module not found: better-sqlite3`, el módulo opcional no se instala en Alpine). Así el build web no depende del módulo; nft ya no lo traza, de ahí la copia explícita (~60 KB). Verificado: Docker web, `prepare:app` + `verify:native` sobre la copia empaquetada y el smoke completo |
