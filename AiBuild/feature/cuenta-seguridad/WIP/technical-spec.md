# Technical Spec: Cuenta y seguridad — omero-electron (POS)

## Metadata
- **Date:** 2026-11-24
- **Branch:** feature/comunicaciones-onboarding-metricas
- **Based on:** functional-spec.md
- **Depends on:** omero `cuenta-seguridad` (pantalla `/recuperar` del admin)
- **Status:** WIP

## Changes
- `web/src/app/login`: link **"¿Olvidaste tu contraseña?"** debajo del campo contraseña (solo en el login con email; no en el de clave rápida).
  - **Desktop (Electron)**: abre `{ADMIN_PUBLIC_URL}/recuperar` en el navegador del sistema (`shell.openExternal` vía IPC existente del `main`; agregar canal `open-external` con allowlist de dominio `*.omero.ar`).
  - **Web**: `window.open(…, '_blank', 'noopener')`.
- Config: `ADMIN_PUBLIC_URL` (runtime en desktop, ya hay variables de entorno de URLs; en web `NEXT_PUBLIC_ADMIN_URL`).
- Sesión revocada por cambio de contraseña: el POS ya maneja la pérdida de sesión (`sessionManager` / validación pasiva de la caja); verificar que el mensaje mostrado sea "Se cambió la contraseña de este usuario. Iniciá sesión de nuevo" cuando el backend devuelva el motivo `PASSWORD_CHANGED` en el 401 del refresh (sumar ese `revoked_reason` en el backend).
- **Nunca** con una venta en curso: si la sesión se revoca con carrito abierto, se mantiene el comportamiento actual de la caja (outbox offline) y el cartel aparece al cerrar la venta.

## Testing plan
- Link visible solo en login por email; abre la URL correcta en desktop (mock IPC) y web.
- Allowlist: `open-external` rechaza dominios fuera de `omero.ar`.
- Mensaje `PASSWORD_CHANGED` al perder la sesión.
