# Summary: pos-offline-outbox (fase 3)

## What was built
Outbox offline de ventas y gastos del POS desktop: se guardan primero en SQLite local (`synchronous=FULL`) y un sender las sube por lotes idempotentes (`clientId`) con reintentos 30 s → 90 s → 270 s → 810 s (luego cada 810 s). El backend crea la venta con la hora de la caja, resuelve el costo, limita el stock a 0 y marca "a revisar" lo que no cierra (producto eliminado/inexistente, fecha fuera de rango) conservando snapshot de código/nombre. El admin la revisa en "Ventas a revisar"; `mp_offline` permite cobrar con MercadoPago sin conexión.

3 PRs mergeados el 2026-09-21: omero-backend #43, omero-electron #6, omero #77.

## Key decisions
1. Outbox SQLite por tenant (archivo aparte de la caché); el logout no lo borra; base corrupta se aparta, nunca se borra.
2. Idempotencia por `clientId` (índice único parcial por tenant); una transacción `REQUIRES_NEW` por ítem (`TransactionTemplate`).
3. El costo lo resuelve el backend; el payload del POS es lista blanca.
4. Ítem huérfano = `product_id NULL` + snapshot; FK `ON DELETE SET NULL` (antes CASCADE) + snapshot retroactivo; blindaje de dashboard/stats/reportes ("Sin identificar").
5. Stock mostrado = backend − pendientes (solo en la respuesta; la caché guarda el crudo).

## TODOs left for later
Ver `manual-checklist.md` secciones B (verificación manual UI/instaladores) y C (deuda): stock negativo en el camino legado, tabla de sobreventas, JWT 1 h (fase 4), tope de reintentos de `INTERNAL_ERROR`.

## Test results
Backend 122 · POS 526 · admin 163 · Electron 16 · smoke E2E local 34/34.
