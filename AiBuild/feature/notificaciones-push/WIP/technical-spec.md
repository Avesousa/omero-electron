# Technical Spec: Canal push — omero-electron (notificación nativa de la caja)

## Metadata
- **Date:** 2026-11-25
- **Branch:** feature/comunicaciones-onboarding-metricas
- **Based on:** functional-spec.md
- **Depends on:** omero-electron `notificaciones-motor` (`usePosNotices`), omero-backend `notificaciones-push` (avisos `app = POS`)
- **Status:** WIP

## Changes
- `main/notifications.ts`: canal IPC `notify:show` → `new Notification({title, body, silent: false})` de Electron (proceso main); `click` → `mainWindow.show(); mainWindow.focus()` y envía `notify:clicked {noticeId, url}` al renderer, que navega dentro del POS o abre el admin con `shell.openExternal` (allowlist `*.omero.ar`).
- `usePosNotices`: cuando llega un aviso nuevo con severidad `CRITICO` o categoría operativa y la **ventana no tiene foco** (`document.hasFocus() === false`) → `window.omero.notify(…)` (preload). Con foco, solo banner (ya existe).
- **Nunca con venta en curso**: si el carrito tiene ítems, la notificación se encola y se muestra al cerrar la venta (misma regla que el modal).
- Pago QR acreditado (`mpEvents`): si la ventana está minimizada → notificación "Pago recibido: $ X" (tag `mp-payment`).
- Preferencia local "Notificaciones del sistema" en la configuración de la caja (`localCache`), activada por defecto; respeta también la preferencia del usuario en el backend (`/api/me/notification-preferences`).
- Windows: `app.setAppUserModelId('ar.omero.pos')` al iniciar (sin esto las notificaciones no se muestran en Windows 10/11).
- Modo web (navegador): no aplica; solo banner.

## Testing plan
- IPC `notify:show` con ventana sin foco → notificación; con foco → no.
- Encolado con carrito lleno.
- `setAppUserModelId` presente en Windows (test de arranque).
- Click en notificación enfoca la ventana y navega.
