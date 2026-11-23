
## Build — línea base (T001, 2026-11-22)
- `npm --prefix web run check`: 1273 tests OK, 1 falla previa ajena (`ThemeProvider.test.tsx` › restaura el tema oscuro). No tocar.
- `web/node_modules` es un symlink al del repo principal (como en los demás worktrees; ignorado por git).
- La rama está 1 commit detrás de `origin/develop` (#42 mercadopago): se rebasea al cierre (sdd-finish), no ahora, para no commitear a mitad.

## Deuda técnica y riesgos (T024)
- Orden commit/versión de stock: dos ventas que confirman en orden inverso podrían dejar un cambio fuera de un delta. Mitigación: reconciliación completa cada 30 min en el navegador; el ETag de `products` incluye la versión de stock. Si aparece en beta, pedir al backend `since - margen`.
- `isTransportError` (lib/apiClient.ts) distingue error de red por el texto del mensaje porque `apiFetch` no propaga el status HTTP. Si cambian los mensajes de `apiFetch`, revisar `syncStock`.
- La primera apertura del SSE no dispara sincronización (el catálogo acaba de cargarse); solo las reaperturas.
- El backend limita a 20 emisores SSE por negocio; con todas las cajas conectadas puede haber reconexiones en negocios grandes.
- Pendientes de otros repos: omero#115 (admin con 304), eliminación futura de `/pos` en `omero`.
- Logs (T021): el syncer ya avisa cuando descarta el delta; no se agregó limitación a 1 aviso cada 10 min (un aviso por ciclo de 5 min por tenant, aceptable).
