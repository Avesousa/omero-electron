# Functional Spec: Canal push — notificaciones del navegador y de la caja (spec E)

## Metadata
- **Date:** 2026-11-25
- **Branch:** feature/comunicaciones-onboarding-metricas
- **Type:** feature
- **Repos:** omero-backend (adaptador Web Push, suscripciones), omero (admin: permiso, service worker, manifest), omero-electron (notificación nativa en la caja de escritorio)
- **Depends on:** `notificaciones-motor` (canal `PUSH`, preferencias, `contact_channel`)
- **Status:** WIP

## Summary
Avisos que aparecen **aunque Omero no esté abierto en pantalla**: en la compu o el celular del dueño (notificaciones del navegador) y en la caja de escritorio (notificación del sistema operativo). Se usan **solo para lo urgente u operativo**, nunca para marketing, para que la gente no las apague.

## Qué se manda por push
| Aviso | Para quién | Por qué push |
|---|---|---|
| Faltan 2 días para que se pause el POS (D5) | Dueño | Riesgo de corte |
| Cuenta pausada | Dueño | Corte en curso |
| Se acreditó un pago con QR de Mercado Pago | Caja (escritorio) — ya existe en pantalla; push solo si la ventana está minimizada | No perder la confirmación |
| Caja sin cerrar desde ayer (cuando exista apertura/cierre) | Dueño y quien tenga permiso de caja | Operativo |
| Ventas a revisar (offline con diferencias) | Usuarios con `VENTAS_REVISION_VER` | Operativo |
| Nuevo inicio de sesión desde un dispositivo nuevo | El usuario | Seguridad |
| Primera venta (celebración) | Dueño | Refuerzo positivo (una sola vez) |
Todo lo demás sigue por email y dentro de la app.

## Cómo se activa (sin molestar)
- **Nunca** se pide permiso al entrar. El navegador solo permite pedirlo una vez de verdad: si el usuario lo rechaza, no se puede volver a preguntar.
- Se ofrece con una **tarjeta propia** (no el cartel del navegador) en momentos con sentido:
  1. Después de la primera venta: "¿Querés que te avisemos en el celu o la compu si pasa algo importante con tu cuenta o tus cajas?"
  2. En Configuración → Avisos: switch "Notificaciones en este dispositivo".
  3. Cuando llega un aviso crítico y el usuario no tiene push activado (una vez).
- Recién si toca **"Activar"** se muestra el pedido del navegador.
- Por dispositivo: se puede tener activado en la compu y no en el celular; la lista de dispositivos está en Configuración → Avisos con *Quitar*.

### Celulares
- **Android (Chrome)**: funciona desde el navegador.
- **iPhone (Safari)**: Apple solo permite notificaciones si Omero se agrega a la pantalla de inicio (iOS 16.4 o superior). La tarjeta muestra los pasos ("Compartir → Agregar a inicio") en vez del botón cuando detecta iPhone sin instalar.

### Caja de escritorio (Electron)
- No necesita permiso del navegador: usa la notificación nativa de Windows/macOS.
- Solo para avisos críticos y operativos, y **nunca con una venta en curso** (se encolan hasta vaciar el carrito).
- Se pueden apagar desde la configuración de la caja.

## Reglas
- Respeta el horario silencioso (9 a 21 h) salvo seguridad y "cuenta pausada".
- Al tocar la notificación se abre Omero en la pantalla correspondiente (`/admin/suscripcion?accion=reactivar`, `/admin/sales/review`, etc.).
- Si una suscripción push deja de funcionar (el usuario borró permisos o el navegador la vence), se elimina sola.

## Acceptance criteria
- [ ] El permiso del navegador solo se pide después de tocar "Activar" en la tarjeta propia.
- [ ] Un aviso de D5 con push activado llega al navegador aunque Omero esté cerrado, y al tocarlo abre la suscripción.
- [ ] En iPhone sin instalar se muestran los pasos para agregar a inicio.
- [ ] La caja de escritorio muestra la notificación nativa de "cuenta pausada" sin interrumpir una venta.
- [ ] Una suscripción vencida (respuesta 404/410 del servicio de push) se borra.
- [ ] Ningún aviso de marketing u onboarding (salvo la primera venta) sale por push.

## Out of scope
- App móvil nativa (no existe).
- Push en el POS web (navegador) más allá del banner: queda para cuando haya un caso.
