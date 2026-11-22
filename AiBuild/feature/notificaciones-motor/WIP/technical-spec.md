# Technical Spec: Avisos in-app en el POS — omero-electron

## Metadata
- **Date:** 2026-11-22
- **Branch:** feature/comunicaciones-onboarding-metricas
- **Based on:** functional-spec.md (motor)
- **Depends on:** omero-backend `notificaciones-motor`
- **Status:** WIP

## Architecture and patterns
```
web/src/app/pos/components/notices/
├── PosNoticeBanner.tsx     // solo BANNER y MODAL (no bandeja en el POS)
└── usePosNotices.ts        // GET /api/notices?app=POS vía backend-proxy con ETag; refresco 60 s + SSE "notice"
```
- El POS muestra **solo** avisos con `app IN (ALL, POS)` y placement `BANNER`/`MODAL`; la bandeja es del admin.
- **Nunca interrumpe una venta**: `MODAL` (suspensión) se encola hasta que el carrito esté vacío y no haya cobro en curso; el banner es una franja fina arriba que no tapa el teclado numérico ni el total.
- Desktop (Electron): para `CRITICO`, además notificación nativa del sistema (`new Notification(...)` desde el renderer, o IPC a `main` si el renderer no tiene permiso) una sola vez por aviso.
- Offline: si no hay conexión se muestran los últimos avisos cacheados (`localCache`), marcados como "puede estar desactualizado"; el bloqueo real de venta lo sigue decidiendo el entitlement (`useEntitlement`, `SubscriptionBlockedScreen`), no el aviso.
- Proxy: agregar `/api/notices` a la lista de rutas del `backend-proxy` en modo web y desktop.

## Testing plan
- Modal encolado con carrito lleno; aparece al vaciar.
- Notificación nativa una sola vez por aviso.
- Offline muestra caché.
