# Summary: cache-redis-multitenant (omero-electron, POS)

## What was built
El POS consume la caché Redis multi-tenant del backend: ETag/304 en catálogo, promociones, config y entitlement, y stock casi en vivo (evento SSE `stock` como disparador + delta `GET /api/products/stock?since=`).

## Timeline
- Started: 2026-11-20 (spec funcional)
- Completed: 2026-11-22
- Branch: feature/cache-redis-multitenant → develop (PR omero-electron#43)

## Files created
- `web/src/lib/catalog/etag.ts` — parseo/recomposición del ETag de productos `"<cat>-<stock>"`.
- `web/src/lib/stockDelta.ts` — validación y merge del delta en el navegador, `stockVersionOf`.
- `web/src/app/pos/hooks/useStockSync.ts` — debounce de eventos, respaldo 30 s sin SSE.
- Tests: `etag`, `stockDelta`, `useStockSync`, `catalog-etag.integration`.

## Files modified
- `lib/catalog/{migrations,sqlite-store,types,snapshot,cache-policy,catalog-proxy,syncer}.ts` — migración v3 (`etags`), ETag atómico, `touch`, `applyStockDelta`, ruta `stockDelta`, 304 desde SQLite, delta + condicional en el syncer.
- `lib/outbox/stock-adjust.ts` — ajuste con pendientes también para el delta.
- `lib/entitlement/{rule,store,entitlement-proxy}.ts` — ETag persistido y 304.
- `lib/{apiClient,mpEvents,useEntitlement}.ts`, `app/pos/hooks/{useProducts,useMercadoPagoEvents}.ts`, `app/pos/page.tsx` — headers en `apiFetch`, listener `stock`, `syncStock`, sin `no-store`.

## Key decisions
1. El evento SSE `stock` es un disparador; la versión local solo avanza con el delta (evita perder cambios por eventos fuera de orden).
2. En desktop el Next local posee el ETag; el del navegador se descarta y el `ETag` no sale (el body se ajusta con pendientes del outbox).
3. 304 servido desde SQLite con `X-Omero-Cache: fresh` (nunca `hit`).
4. SQLite se pone al día con el delta del syncer (sin cliente SSE en Node).
5. Cajeros sin permiso de MP: PR aparte en omero-backend (ticket con `PERM_PRODUCTOS_VER` + canales).

## TODOs left for later
Ver `notes.md` (riesgo de orden commit/versión, `isTransportError` por texto, límite 20 emisores SSE, omero#115).

## Test results
- `npm --prefix web run check`: 91 archivos, 1416 tests pasando.
- Verificación manual en beta pendiente: `manual-checklist.md`.
