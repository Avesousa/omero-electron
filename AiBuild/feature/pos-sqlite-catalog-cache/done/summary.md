# Summary: pos-sqlite-catalog-cache

## What was built
Caché SQLite de solo lectura del catálogo (productos y promociones, una base por tenant) para el POS en modo desktop, más la actualización de Electron 33 → 40. Con conexión el Next hace read-through y actualiza SQLite; si el backend responde 502/503/504 sirve las lecturas desde SQLite con `X-Omero-Cache`. Un syncer refresca cada 5 min y al recuperar la conexión. El header del POS muestra "Sin conexión" / "N pendientes sin sync" con un botón "Actualizar" que solo verifica la conexión. El logout borra la base del tenant. El modo web no cambia.

## Timeline
- Started: 2026-09-21
- Completed: 2026-09-21
- Branch: feature/pos-sqlite-catalog-cache (base develop)
- Commits: cd60f99 (Electron 33 → 40, aislado) · dea94ac (feature) · docs/archivo

## Files created
- `web/src/lib/catalog/**` — política, tenant, migraciones, store SQLite, registro, proxy con caché, syncer, conectividad, snapshot (+ tests unit e integración)
- `web/src/lib/data-layer.ts`, `web/src/lib/localCache.ts` — capa de datos y borrado en logout
- `web/src/app/api/%5Flocal/{connectivity,cache}/route.ts` — endpoints locales
- `web/src/app/pos/{hooks/useConnectionStatus.ts,components/ConnectionStatus.tsx}` (+ tests)
- `main/paths.ts` — `RESOURCES_DIR` (Windows y macOS)
- `scripts/{fetch-native,verify-native}.mjs`, `scripts/native-checksums.json` — binarios de better-sqlite3 para Electron

## Files modified
- `package.json`/lock (Electron 40, tar, scripts), `electron-builder.config.ts`, `.github/workflows/installer.yml`, `scripts/prepare-frontend.mjs`
- `main/process-manager.ts`, `main/build-config.ts`, `main/logger.ts` — env de la caché y rutas de recursos
- `web/` (`package.json` opcional better-sqlite3, `next.config.ts`, `Dockerfile`, `vitest.config.mts`, `runtime.ts`, route catch-all, `pos/page.tsx`, `auth.tsx`)
- `CLAUDE.md`, `README.md`, `web/README.md`, `web/.env.example`

## Key decisions
1. Snapshot completo por sync: el backend no tiene `updatedSince` y borra físicamente.
2. `better-sqlite3` 12.11.1 exacta y opcional, cargada con `createRequire`; binarios de Electron (ABI 143) con checksum fijado y elegidos por `process.arch`.
3. Electron 40 en commit aislado (33 fuera de soporte; techo con binarios de better-sqlite3 12.x).
4. El aviso se integra en el header existente y su botón solo verifica la conexión.
5. La caché nunca rompe una request: cualquier fallo degrada a pass-through.

## Bugs encontrados y corregidos durante el build
- `INSERT OR REPLACE` reordenaba la lista del backend (ahora `ON CONFLICT DO UPDATE`).
- `npm ci --omit=optional` rompía el build (omite Tailwind/SWC); Turbopack no resolvía el módulo opcional en Docker (ahora `createRequire`).
- Bug de la fase 1: los recursos en macOS no estaban en `dirname(exe)/resources` (ahora `process.resourcesPath`).

## TODOs left for later
- Verificación manual: Electron 40, aviso en pantalla, instaladores Windows/macOS (arm64 e Intel).
- Fase 3 (outbox, `mp_offline`, ventas a revisar) y fase 4 (sesión de dispositivo).
- Node 20 fuera de soporte en Docker/CI; `electron-builder` 25 sin probar con Electron 40; base sin cifrar; migración H2 → Railway; borrar `/pos` de `omero`.

## Test results
- Tests added: ~300 (299 en web: unit + 41 de integración con backend HTTP y SQLite reales + UI; 16 en la raíz)
- All passing: yes (capa nueva 96,9 % de cobertura; smoke del standalone empaquetado con el Node de Electron: 0 fallos)
