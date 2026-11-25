# Technical Spec: Onboarding in-app — omero-electron (POS)

## Metadata
- **Date:** 2026-11-22
- **Branch:** feature/comunicaciones-onboarding-metricas
- **Based on:** functional-spec.md
- **Depends on:** omero-backend `onboarding-guias`; omero `onboarding-guias` (mismo contrato `ToolGuide`)
- **Status:** WIP

## Architecture and patterns
### Decision: mismo contrato y runner que el admin, con reglas de POS
```
web/src/guides/
├── types.ts            // copia del contrato ToolGuide (mismo shape que omero/src/guides/types.ts)
├── index.ts
├── pos-venta.guide.ts  pos-cobro-mp-qr.guide.ts  (P1)  pos-precio-libre  pos-offline  caja-apertura-cierre  balanza-peso (P2)
├── PosGuideProvider.tsx
└── PosGuideRunner.ts   // driver.js lazy + navegación por teclado
```
- **Nunca con venta en curso**: `PosGuideProvider` lee el estado del carrito (`useCart`); si `items.length > 0` o hay un cobro en proceso, posterga la oferta hasta que el carrito quede vacío. Una guía en curso se pausa si entra un ítem por escáner.
- **Teclado**: `GuideStep.key` (ej. `"I"`, `"Tab"`, `"Enter"`, `"000"`) → el globo muestra la tecla como "tecla" de la marca (`key` component de DESIGN.md) y `waitFor: 'key'` avanza cuando se presiona. `Esc` sale de la guía y **no** debe disparar el `Esc` del POS (stopPropagation mientras la guía está activa).
- **Cuándo se ofrece**: al iniciar sesión en la caja si nunca vio `pos-venta`; las demás desde el botón "?" del encabezado del POS o con `?guia=`.
- **Offline**: el progreso se guarda local (`localCache`) y se sincroniza cuando vuelve la conexión (mismo patrón outbox liviano); nunca bloquea.
- `pos.session_started` lo emite el backend al login (ya contemplado en el spec del backend); el POS no emite nada extra salvo `tool.opened` para `pos` una vez por día.

### Guías P1 del POS
- `pos-venta`: buscar/escanear producto → cantidad → total → elegir medio de pago → confirmar → ver stock descontado.
- `pos-cobro-mp-qr`: elegir "QR Mercado Pago" → mostrar QR al cliente → esperar confirmación → venta registrada.

## Dependencies
- `driver.js` en `web/package.json` (lazy).

## Testing plan
- `PosGuideProvider`: no ofrece con carrito con ítems; pausa al escanear; reanuda.
- Teclas: `waitFor: 'key'` avanza; `Esc` no llega al handler del POS durante la guía.
- Anclas de `pos-venta` existen en el render del POS (smoke test).
- Progreso offline se sincroniza.
