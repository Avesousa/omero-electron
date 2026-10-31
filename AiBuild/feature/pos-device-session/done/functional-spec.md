# Functional Spec: Sesión de dispositivo del POS (fase 4)

## Metadata
- **Type:** feature
- **Branch:** feature/pos-device-session (en omero-backend, omero-electron y omero, cada uno desde su `develop`)
- **Ticket:** N/A
- **Tests required:** yes
- **Date:** 2026-09-21
- **Status:** WIP

## Summary
Hoy el JWT del POS dura 1 h y no se renueva: pasada la hora el POS pide login y el sender del outbox se detiene (401). Esta fase agrega **cajas (dispositivos) registradas** con una **sesión larga de 14 días deslizante**, renovada en silencio, **revocable desde el admin**, con alcance limitado al POS, y que sigue pudiendo **subir lo pendiente** aunque la caja esté revocada o vencida (ventana de 30 días).

## Project context
- `omero-backend` (Spring Boot 3, multi-tenant `@TenantId`, Flyway hasta V17). Ya existe `refresh_tokens` (7 d, **uno por usuario**: cada login lo borra; no rota; el POS nunca lo usa) y JWT de acceso de 1 h. Roles `SUPERADMIN|ADMIN|OPERADOR`.
- `omero-electron`: Next local del POS (desktop, `OMERO_RUNTIME=desktop`) con proxy `/api/*`, caché SQLite, outbox y sender; Electron (`main/`) lo lanza como `utilityProcess`.
- `omero` (admin Next): panel de administración.
- El `CatalogSyncer` guarda el `Authorization` solo en memoria; el sender se detiene con 401/403 hasta un token nuevo.

## Detailed description
- **Dispositivo (caja)**: pertenece al **negocio (tenant)**. Se **activa con el login normal** del cajero en desktop: el backend registra la caja (nombre por defecto = hostname, editable por el admin) y entrega una credencial de dispositivo de larga duración. No hay pasos extra para el cajero.
- **Credencial**: secreto opaco por caja, **rotativo** en cada renovación, guardado por Electron con **`safeStorage`** (Keychain / DPAPI) en `userData`; nunca en `localStorage` ni texto plano. Electron se la pasa al Next local al arrancar; el Next renueva en silencio el JWT de acceso de 1 h con ella.
- **Sesión**: **14 días deslizante** (cada renovación extiende 14 d). Inactiva > 14 d → vencida: hay que volver a activar con login.
- **Alcance**: el JWT emitido a una caja lleva `scope=pos` y el backend **solo acepta rutas del POS** (lectura de productos, promociones, config, resumen del día y MercadoPago; crear ventas y gastos; `/api/sync/batch`; `/api/auth/device/*`). Todo lo demás da 403 **aunque el usuario sea ADMIN**.
- **Cajeros**: la caja es del negocio y la sesión es por cajero: cada login vincula al cajero actual; al cerrar sesión la caja sigue registrada. `sourceUserId` conserva quién vendió.
- **Revocación** (admin): la caja no puede renovar ni iniciar sesión ni usar el POS. Puede pedir un token `scope=sync` (**solo `/api/sync/batch`**) durante **30 días** desde la revocación o el vencimiento para vaciar el outbox. Pasada la ventana, lo pendiente queda visible en el outbox local y se resuelve reactivando la caja.
- **Admin**: pantalla de cajas con nombre, estado (activa / revocada / vencida), último uso, último cajero, versión de la app y fecha de alta; acciones **renombrar** y **revocar** (con confirmación); contador de cajas activas.
- **Solo desktop**: el POS web sigue con el login de siempre (JWT de 1 h + refresh actual de la web sin cambios).

## Main flows
### Flow 1: Activación (primer login en una caja)
1. El cajero inicia sesión en el POS desktop (email + clave).
2. El Next local llama al login con un `deviceId` (UUID generado por la caja) y su nombre (hostname).
3. El backend valida al usuario, registra la caja (o la reconoce) y devuelve JWT de acceso + secreto de dispositivo.
4. Electron guarda el secreto con `safeStorage`; el Next lo mantiene en memoria para renovar.

### Flow 2: Renovación silenciosa
1. El JWT de acceso está por vencer / el backend responde 401 por vencimiento.
2. El Next local llama `/api/auth/device/refresh` con el secreto; el backend valida (no revocada, no vencida), **rota el secreto**, devuelve nuevo JWT y extiende 14 d.
3. Electron persiste el secreto nuevo. El cajero no ve nada; el outbox no se detiene.

### Flow 3: Revocación
1. El admin revoca la caja en la pantalla de cajas.
2. En la próxima renovación la caja recibe "revocada": el POS pasa a pantalla de login/aviso "caja revocada" y no permite operar.
3. El sender sigue subiendo lo pendiente con un token `scope=sync` (ventana de 30 d).

### Flow 4: Caja vencida (inactiva > 14 d)
Igual que revocada en cuanto a subir pendientes (30 d desde el vencimiento); para operar hay que iniciar sesión de nuevo (reactiva la misma caja).

## Edge cases
- Secreto rotado pero el POS se cae antes de persistir el nuevo → el backend acepta el secreto **anterior una vez** (ventana corta/gracia) para no perder la caja.
- Robo del secreto (dos usos del mismo secreto viejo) → se revoca la caja y se avisa en el admin.
- Reloj de la caja desajustado: la validez la decide siempre el backend.
- Sin conexión el JWT vence: el POS sigue operando y encolando (outbox); al volver la red renueva y sube.
- `safeStorage` no disponible (Linux sin keyring): la caja funciona sin sesión larga (comportamiento actual: login por hora) y avisa.
- Dos cajas en la misma máquina/otro tenant: cada `deviceId`/tenant tiene su secreto; nunca se cruzan.
- Reinstalación / userData borrado: nueva caja (la anterior queda inactiva y vence).
- Cambio de cajero en la misma caja con pendientes del anterior: se suben con la credencial de la caja.
- Un OPERADOR no puede ver ni tocar las cajas (solo ADMIN).

## Acceptance criteria
- [ ] Given una caja activada, when pasa 1 h sin conexión y vuelve la red, then el JWT se renueva solo y el outbox sube sin pedir login.
- [ ] Given una caja con actividad, when pasan 13 días sin usar y luego se usa, then sigue activa (deslizante 14 d); when pasan 15 días, then requiere login.
- [ ] Given una caja revocada, when intenta renovar o usar el POS, then recibe rechazo y el POS lo indica; when tiene ventas pendientes y está dentro de los 30 días, then el sender las sube con `scope=sync`.
- [ ] Given una caja revocada fuera de la ventana de 30 d, when intenta subir, then rechazo y el outbox conserva todo visible.
- [ ] Given un JWT `scope=pos` de un usuario ADMIN, when llama a una ruta fuera de la lista blanca, then 403.
- [ ] Given un JWT `scope=sync`, when llama a cualquier ruta que no sea `/api/sync/batch`, then 403.
- [ ] Given el secreto guardado con `safeStorage`, when se inspecciona `userData`, then no hay secreto en texto plano.
- [ ] Given el admin, when renombra o revoca una caja, then el cambio se ve en la lista y la revocación surte efecto en la próxima renovación (≤ 1 h).
- [ ] Given un OPERADOR, when llama a los endpoints de administración de cajas, then 403; y otro tenant nunca ve ni revoca cajas ajenas.
- [ ] Given el POS web, when se usa, then el login y la sesión no cambian.

## Out of scope
- Migración H2 → Railway; eliminar `/pos` de `omero`; tabla de sobreventas.
- Reactivar una caja revocada desde el admin (queda revocada; se registra una nueva iniciando sesión, o se decide en una fase posterior).
- Código de activación del admin / aprobación previa de cajas.
- Cambiar el refresh token de la web ni la duración del JWT de 1 h.
- Cifrado del SQLite (SQLCipher).

## Constraints
- Secreto de dispositivo: alta entropía, guardado **hasheado** en el backend (nunca en claro), rotativo.
- Toda ruta nueva es tenant-scoped; la revocación debe surtir efecto en ≤ 1 h (vida del JWT) o al siguiente refresh.
- Backend se despliega primero; un POS viejo contra el backend nuevo sigue funcionando con el login de siempre (compatibilidad hacia atrás).
- Orden de PRs: backend → POS → admin.

## Open questions
- Ventana de gracia del secreto anterior tras rotar (propuesta: el inmediato anterior, una vez, 5 min).
- Detección de reuso del secreto viejo → ¿revocar automáticamente la caja?
- Límite de cajas activas por negocio (¿hay plan/tope?).
