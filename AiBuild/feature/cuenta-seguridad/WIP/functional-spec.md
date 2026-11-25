# Functional Spec: Cuenta y seguridad — contraseña, dispositivos nuevos e invitaciones (spec C)

## Metadata
- **Date:** 2026-11-24
- **Branch:** feature/comunicaciones-onboarding-metricas
- **Type:** feature
- **Repos:** omero-backend (tokens, endpoints, eventos, plantillas), omero (pantallas públicas y de perfil, alta de usuarios por invitación), omero-electron (link "¿Olvidaste tu contraseña?" en el login del POS)
- **Depends on:** `notificaciones-motor`, `notificaciones-email`
- **Status:** WIP

## Summary
Lo mínimo de seguridad que hoy falta y que se resuelve con emails: **recuperar la contraseña** sin depender de soporte, **cambiar la propia contraseña**, **avisar cuando se inicia sesión desde un dispositivo nuevo**, e **invitar usuarios por email** para que cada uno cree su contraseña (hoy el dueño la inventa y se la pasa). Todos los emails son de categoría `SEGURIDAD`: no se pueden desactivar y salen aunque el email no esté verificado (excepto el de dispositivo nuevo, que requiere email verificado para no avisar a direcciones mal cargadas).

## Detailed description

### 1. Olvidé mi contraseña
- Link **"¿Olvidaste tu contraseña?"** en el login del admin (`/login`) y del POS (abre `{appUrl}/recuperar` en el navegador).
- `/recuperar`: campo email → siempre responde **"Si el email está registrado, te mandamos un link para crear una contraseña nueva"** (no revela si existe la cuenta).
- Email `auth.password_reset`: botón *Crear contraseña nueva*, link válido **30 minutos** y de **un solo uso**; "Si no lo pediste, ignorá este email: tu contraseña no cambia".
- `/restablecer?t=…`: nueva contraseña + confirmación (mismas reglas que el alta) → al guardar se **cierran todas las sesiones** del usuario (web y cajas) y se inicia sesión en el navegador actual.
- Email `auth.password_changed`: "Cambiaste tu contraseña el {fecha}. Si no fuiste vos, escribinos a soporte".
- Límite: 3 pedidos por hora por email y 10 por hora por IP.

### 2. Cambiar mi contraseña (con sesión)
- Menú de usuario → **Mi cuenta** → *Cambiar contraseña*: contraseña actual + nueva.
- Al guardar: cierra las **otras** sesiones (no la actual) y envía `auth.password_changed`.
- La clave rápida del POS no cambia (es otra credencial).

### 3. Aviso de inicio de sesión en un dispositivo nuevo
- Si alguien inicia sesión con email y contraseña desde un **navegador o caja que ese usuario no usó en los últimos 90 días**, el usuario recibe `auth.new_device_login`: fecha y hora, tipo (navegador/caja), sistema y navegador aproximados, y "Si no fuiste vos, cambiá tu contraseña ahora" (botón a `/recuperar`).
- No se avisa en el primer login de la cuenta, ni en los logins con clave rápida en una caja ya vinculada.
- Solo con email verificado.

### 4. Invitar usuarios
- En Configuración → Usuarios → *Nuevo usuario*: nombre, email, rol y la opción (por defecto) **"Enviarle una invitación por email para que cree su contraseña"**. La opción actual de fijar la contraseña a mano se mantiene (para cajeros sin email propio).
- Email `user.invited`: "{quien invita} te sumó a {negocio} en Omero como {rol}" + *Aceptar invitación*. Link válido **7 días**.
- `/invitacion?t=…`: muestra negocio y rol, pide nombre (precargado) y contraseña → crea la sesión → va al Inicio (y, si tiene permisos, al onboarding correspondiente).
- El usuario invitado aparece en la lista como **"Invitación pendiente"** con *Reenviar* y *Cancelar*; vencida, como "Invitación vencida" con *Reenviar*.
- Al aceptar: evento `user.invitation_accepted` (aviso in-app al que invitó: "{nombre} se sumó a tu equipo") y el paso del checklist "Sumá a tu equipo" se completa.

### 5. Verificación de email
- Ya definida en `flujo-cobro-exitoso-bienvenida` (token 72 h, `/verificar-email`); acá se agrega la plantilla corta `auth.verify_email` para los reenvíos y el banner "Confirmá tu email" del admin con *Reenviar*.

## Main flows
- **Recuperación:** login → ¿Olvidaste…? → email → link → nueva contraseña → sesiones cerradas → email de confirmación.
- **Invitación:** dueño invita → email → acepta y crea contraseña → entra → el dueño ve "se sumó a tu equipo".
- **Dispositivo nuevo:** login en una compu nueva → email de aviso → (si no fue él) recuperar contraseña → todas las sesiones cerradas.

## Edge cases
- Pedido de recuperación para un usuario **inactivo** → no se envía nada (misma respuesta genérica).
- Dos pedidos seguidos → el segundo invalida el primer link.
- Link vencido o usado → pantalla "Este link ya no sirve" con *Pedir uno nuevo*.
- Invitación a un email que ya tiene usuario en **otro** negocio → hoy un email = un usuario (`users.email` único): se rechaza con "Ese email ya usa Omero en otro negocio" (multi-negocio por usuario queda fuera).
- Invitación a un email que ya está en el **mismo** negocio → error "Ya es parte de tu equipo".
- El que invitó pierde el permiso de usuarios antes de que acepten → la invitación sigue válida (la creó alguien autorizado); se puede cancelar desde la lista.
- Cambio de contraseña con la actual incorrecta → error sin cerrar sesiones; 5 intentos fallidos en 15 min bloquean el cambio 15 min.

## Acceptance criteria
- [ ] `/recuperar` responde lo mismo exista o no el email, y respeta los límites.
- [ ] El link de recuperación sirve una sola vez y vence a los 30 minutos.
- [ ] Restablecer cierra todas las sesiones (web y cajas) y manda `auth.password_changed`.
- [ ] Cambiar la contraseña con sesión cierra las demás sesiones y no la actual.
- [ ] Login desde un dispositivo no usado en 90 días avisa por email (solo con email verificado); el primer login de la cuenta no avisa.
- [ ] Invitar crea un usuario "pendiente", manda el email y al aceptar queda activo con la contraseña elegida.
- [ ] El POS tiene el link "¿Olvidaste tu contraseña?" que abre la recuperación del admin.
- [ ] Ningún token se guarda en texto plano.

## Out of scope
- 2FA para usuarios de negocios.
- Un mismo email en varios negocios.
- Recuperación de la clave rápida del POS (la sigue gestionando el dueño).
