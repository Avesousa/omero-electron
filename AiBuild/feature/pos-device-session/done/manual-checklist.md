# Checklist de verificación — pos-device-session (fase 4)

## A. Smoke end-to-end local (automatizado, 2026-09-21) — T017

Entorno: `dev.sh up` con el backend de la rama (**V18 aplicada sobre la base de dev**), POS en **modo desktop** (SQLite real) con la
identidad y el secreto de la caja inyectados por env como los pasaría Electron (`OMERO_DEVICE_ID/NAME/SECRETS`), y el admin. Como el JWT
real dura 1 h, "el JWT vence" se simula mandando al POS un JWT **ya vencido**: el POS solo lo usa como pista de tenant y el sender debe
renovar con la caja. Script: 20 checks contra el backend real → **20/20 OK** (uno corregido en el propio script, ver abajo).

| # | Escenario | Resultado |
|---|---|---|
| 1 | `/api/_local/session/refresh` renueva con la caja: JWT `scope=pos` con `deviceId`, el **secreto rota** (hash distinto en la base) y el renderer no recibe el secreto | ✅ |
| 2 | Alcance real con un JWT `pos` de ADMIN: `GET /api/products` 200; `GET /api/devices`, `POST /api/products`, `GET /api/sales/review` → **403 `SCOPE_FORBIDDEN`** | ✅ |
| 3 | Venta con el JWT **vencido**: 201 al instante y sube sola (el sender renovó con la caja, sin login); el backend la guarda | ✅ |
| 4 | El admin ve la caja ACTIVA (último uso, cajero, versión) y la renombra | ✅ |
| 5 | Revocar: la renovación → 403 `DEVICE_REVOKED`; el login con esa caja → 403 `DEVICE_REVOKED`; **la venta pendiente igual sube** con el token `scope=sync` | ✅ |
| 6 | Caja revocada hace > 30 días (POS recién iniciado): sender `unauthorized`, la venta sigue `PENDING` (nada se pierde) | ✅ |
| 7 | En la base solo está el hash (64 hex); nunca el secreto | ✅ |
| 8 | Compatibilidad: login sin `device` (web) intacto (sin `deviceSecret`, JWT sin `scope`); el JWT normal de ADMIN sí administra | ✅ |

Notas del smoke:
- Un token `sync` ya emitido sigue valiendo hasta que vence (≤ 1 h): la ventana de 30 días gobierna la **emisión**, no invalida tokens vigentes. El primer intento del script (misma caja que en 5) lo vio subir y se corrigió usando una caja nueva para el escenario 6.
- Persistencia del secreto rotado con Electron: cubierta por `main/device-store.test.ts` (100 %), el test de integración del POS (reinicio con el env descifrado) y `npm run verify:safestorage` (**`safeStorage` real de Electron 40 en macOS: cifra, descifra, el archivo no contiene el secreto y un archivo alterado se aparta**).

Hallazgos durante el build (corregidos):
- Hibernate `validate` no acepta `CHAR(64)` como `VARCHAR`: los hashes son `VARCHAR(64)`.
- Carrera latente del sender: un "volvió la conexión" durante un envío en vuelo que fallaba esperaba el backoff de 30 s; ahora reintenta ya (`forceAgain`).
- Un test de fase 3 (`OrphanItemHardeningTest`) usaba la fecha UTC y fallaba de noche (la zona del tenant es Buenos Aires): ahora usa la del tenant.

## B. Verificación manual pendiente (requiere personas / instaladores) — T019

Marcar con fecha al ejecutar.

- [ ] **Instaladores Windows y macOS (arm64 e Intel)**: primer login registra la caja (nombre = hostname); cerrar la app, abrirla pasada más de 1 h **sin conexión y sin pedir login**; al volver la red sube lo pendiente.
- [ ] **Secreto en disco**: en `userData/device/` existe `device-session.bin` cifrado (no legible) y `device-id`; borrar `userData` = caja nueva (la anterior queda inactiva y vence).
- [ ] **Linux sin keyring / `safeStorage` no disponible**: el POS funciona, aparece el aviso en el log y la sesión larga vive solo en memoria (tras reiniciar hay que iniciar sesión).
- [ ] **Admin `/admin/devices`**: lista, renombrar, revocar (confirmación con los efectos), aviso de uso sospechoso; en claro/oscuro y móvil; un OPERADOR no ve el ítem "Cajas" útil (403).
- [ ] **Revocar con la caja abierta y con una venta pendiente**: en ≤ 1 h el POS vuelve al login con el mensaje de caja revocada; lo pendiente sube; iniciar sesión en esa caja da "revocada".
- [ ] **Logout con pendientes**: sigue avisando; tras cerrar sesión lo pendiente se sube (token de solo subida) y para operar hay que iniciar sesión.
- [ ] **Varias cajas / otro tenant en la misma máquina**: cada uno con su secreto, sin cruces.
- [ ] **Reloj de la caja desajustado**: la validez la decide el backend (renovación normal).
- [ ] **Actualización de la app**: la caja conserva identidad y secreto (mismo `userData`).
- [ ] **Despliegue**: backend a Railway primero (V18 es una tabla nueva, sin riesgo de duración), luego POS/instaladores, luego admin.

## C. Deuda técnica registrada

- **Endpoint local sin guardia** (`/api/_local/session/refresh`): cualquier proceso de la máquina que llegue a `127.0.0.1` puede pedir un JWT `scope=pos`. Mitigación futura: nonce por arranque (Electron → env + preload).
- **Revocación con latencia ≤ 1 h**: el JWT ya emitido vive hasta 1 h (no se consulta `devices` en cada request). Un token `sync` emitido también.
- **Sin auto-revocación por reuso** del secreto: solo se marca `reuse_detected_at` y se avisa en el admin.
- **Reactivar una caja revocada desde el admin** no existe (se registra una caja nueva iniciando sesión); tampoco hay código de activación ni aprobación previa.
- **Sin tope de cajas por negocio**.
- **Rate limit** de `/api/auth/device/*`: el limitador existente es solo de registro; el secreto de 256 bits hace inviable la fuerza bruta, pero conviene un límite por IP.
- **Lista blanca duplicada** (backend `DeviceScopeFilter` y `allowlist.contract.test.ts` del POS): un test del POS falla si el POS llama a una ruta fuera de la lista, pero mantener ambas sincronizadas es manual.
- **Cobertura global de `omero`** ya fallaba antes (`tenantTime.ts`); `next lint` de `omero` no corre (preexistentes).
- Dispositivos revocados/vencidos no se purgan (filas mínimas).

## D. Orden de PRs y despliegue

1. `omero-backend` → `develop` (V18 + JWT con `scope` + `DeviceScopeFilter` + endpoints de caja). **Desplegar primero.** Un POS viejo contra el backend nuevo sigue con el login de siempre.
2. `omero-electron` → `develop` (`device-store`/`safeStorage`, sesión de caja, token-provider, renovación silenciosa). Un POS nuevo contra un backend viejo queda sin sesión larga (sin `deviceSecret`), como hoy.
3. `omero` → `develop` (pantalla de cajas).
