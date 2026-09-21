# Summary: pos-standalone-next-web-mode

## What was built
Fase 1 de la separación del POS: `omero-electron` contiene el Next del POS (`web/`) que corre en modo web (Railway) o desktop (Electron sin Java). En ambos, `/api/*` se reenvía al `omero-backend` de Railway con un proxy en runtime (`BACKEND_URL`), con streaming de SSE y multipart. Se elimina Java/JRE/JAR del instalador.

## Timeline
- Started: 2026-09-21
- Completed: 2026-09-21
- Branch: feature/pos-standalone-next-web-mode (base develop)
- Commit: b8f58be

## Files created
- `web/**` — app Next del POS (60 archivos copiados de omero `origin/develop` 7b99acb + propios), Dockerfile, railway.toml, .env.example, README
- `web/src/lib/{runtime,backend-proxy}.ts` (+ tests unit e integración) — núcleo del proxy y configuración
- `web/src/app/api/[...path]/route.ts`, `api/%5Flocal/health/route.ts` — proxy y readiness local
- `web/src/instrumentation-node.ts` — validación de entorno al arrancar
- `main/build-config.ts`, `main/config.test.ts`, `vitest.config.ts` — config del backend en Electron y sus tests
- `scripts/prepare-frontend.mjs`, `scripts/write-build-config.mjs` — empaquetado
- `.npmrc` — workaround de npm 10.9

## Files modified
- `main/{main,process-manager,config,logger}.ts` — sin Java; levanta solo el Next local
- `electron-builder.config.ts`, `package.json`, `tsconfig.json`, `.gitignore` — sin jre/backend; scripts nuevos
- `.github/workflows/installer.yml` — sin descargas de JAR/JRE/frontend.zip; gates y build del POS propio
- `README.md`, `CLAUDE.md` — nueva arquitectura y variables
- (repo omero, sin commitear) `navConfig.ts`, `HomeNavCards.tsx`, `admin/sales/page.tsx`, `env.example.txt`, `CLAUDE.md` — `NEXT_PUBLIC_POS_URL`

## Key decisions
1. Proxy como route handler en runtime (no `rewrites`): override de `BACKEND_URL` en desktop y base de fases 2-3.
2. No reenviar `Origin`/`Referer`: el backend aplica CORS por lista; así no hace falta tocarlo.
3. `web/` como segundo paquete (npm), POS duplicado de omero hasta el rediseño.
4. El servidor sale con código 1 si `OMERO_RUNTIME`/`BACKEND_URL` son inválidos (Next no lo hace solo).
5. `BACKEND_URL` solo origen, validado igual en Electron y Next.

## TODOs left for later
- Migración de datos H2 → Railway de instalaciones actuales (master).
- Eliminar `/pos` de omero tras validar; PR de `NEXT_PUBLIC_POS_URL` en omero.
- Verificación manual de instaladores Windows/macOS y deploy Railway (manual-checklist.md).
- CI de PR; migrar `middleware.ts` a `proxy`.
- Fases 2-4 (SQLite, outbox/mp_offline/ventas a revisar, sesión larga).

## Test results
- Tests added: 108 (92 en web: 61 unit + 12 integración + 19 migrados; 16 en la raíz)
- All passing: yes (proxy 100 % líneas / 93,75 % ramas; runtime y resolveBackendUrl 100 %)
