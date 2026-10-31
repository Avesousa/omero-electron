# Checklist de verificación — pos-offline-outbox (fase 3)

## A. Smoke end-to-end local (automatizado, 2026-09-21) — T026

Entorno: `omero-start/dev.sh up` (backend de la rama `feature/pos-offline-outbox` con **V17 aplicada sobre la base de dev ya sembrada**:
230 ítems de venta con snapshot retroactivo, sin pérdida), POS de la rama en **modo desktop** (`OMERO_RUNTIME=desktop`, SQLite real,
Next dev/Turbopack con el Node del sistema) apuntando a un **gateway intermitente** (`:8081` → `:8080`, modos ok / down 502 / reset /
lose = reenvía y corta la respuesta / 401 y 404 solo para `/api/sync/batch`). Script: 34 checks, corrida limpia **34/34 OK**.

| # | Escenario | Resultado |
|---|---|---|
| 1 | Venta online: `POST /api/sales` → 201 `queued:true` al instante, sube sola a `SENT`; en el backend `source=POS_OFFLINE`, `review=NONE`, stock −2 | ✅ |
| 2 | Backend caído (502): venta aceptada al instante y `PENDING`; el stock mostrado sale de la caché SQLite (`X-Omero-Cache: hit`) con la venta pendiente restada; estado `offline` + `nextAttemptAt`; al volver la conexión se sube sola (28 s) sin duplicar | ✅ |
| 3 | Respuesta perdida tras guardar: el backend la tiene, el POS la ve `PENDING`; el reintento devuelve `DUPLICATE` → `SENT`; 1 sola venta y stock descontado una vez | ✅ |
| 4 | Producto inexistente: `REVIEW` en el POS con motivo; aparece en `GET /api/sales/review` con todos los ítems y snapshot; contador; asignar producto → costo vigente + stock −qty + auditoría, snapshot intacto; marcar revisada | ✅ |
| 5 | Fecha fuera de ventana (cola vieja de localStorage importada con 45 días): importar dos veces no duplica; llega con `createdAt` exacto y `NEEDS_REVIEW` (`CREATED_AT_TOO_OLD`) | ✅ |
| 6 | MercadoPago: `mp_offline` legible desde el POS, editable por ADMIN, valores inválidos rechazados (400); venta MP → `mp_status=PENDING` + impuesto MP | ✅ |
| 7 | Reinicio del POS con una venta pendiente: tras el reinicio la primera request autenticada la sube (1 sola vez en el backend) | ✅ |
| 9 | Backend viejo sin `/api/sync/batch` (404): estado `unsupported`, nada se pierde; al volver el soporte se sube | ✅ |
| 10 | 401 del backend: envío detenido (`unauthorized`), la venta sigue `PENDING`; con un token nuevo se reanuda y sube todo | ✅ |
| 8 | Logout con pendientes: el aviso (`window.confirm`) y que el outbox sobrevive al logout están cubiertos por tests (`auth.test.tsx`, `outbox.integration.test.ts`); **la interacción real con el diálogo en Electron queda para la verificación manual (sección B)** | ⚠️ parcial |

Hallazgos durante la verificación (corregidos en la rama):
- **Reinicio con pendientes**: el sender solo se creaba al hacer la primera venta, así que tras reiniciar la caja los pendientes no subían hasta vender de nuevo. Ahora `rememberSession()` crea el sender antes de registrar el token (`lib/outbox/outbox-runtime.ts`).
- **`mp_offline` aceptaba cualquier texto** por `PUT` (p. ej. `"quizas"` se leía como apagado sin avisar): ahora las claves de tipo `boolean` exigen `true`/`false`.
- Con un snapshot de la caché tomado <2 s después de un envío, el stock mostrado puede restar esa venta dos veces (transitorio, hasta el próximo refresco de 5 min): es el margen de seguridad deliberado (`SNAPSHOT_MARGIN_MS`), prefiere mostrar de menos que de más.

## B. Verificación manual pendiente (requiere personas / instaladores) — T028

Marcar con fecha al ejecutar.

**Interfaz (no automatizable acá):**
- [ ] Admin `/admin/sales/review`: lista, detalle con ítems huérfanos, asignar producto, marcar revisada — en claro y oscuro, ancho móvil.
- [ ] Admin `/admin/sales`: insignia "A revisar" y "Sin producto"; menú lateral con el contador; aviso en Inicio.
- [ ] Admin `/admin/mercadopago`: switch `mp_offline` (ADMIN lo cambia; un OPERADOR lo ve deshabilitado).
- [ ] POS desktop (Electron): chip "N pendientes sin sync", "N para revisar" abre la lista (Esc/Tab cierra), "Entendido" descarta un rechazo; botón Actualizar solo verifica la conexión.
- [ ] POS desktop: botón MercadoPago deshabilitado sin conexión y `mp_offline` apagado; tecla `1` avisa; con `mp_offline` encendido se puede cobrar.
- [ ] POS desktop: cerrar sesión con pendientes muestra el aviso; cancelar no cierra; aceptar cierra y **el outbox sobrevive**; volver a iniciar sesión sube lo pendiente.
- [ ] POS web (Railway): el header queda como siempre, sin sesión offline: una venta sin conexión muestra error y no se encola.

**Entorno / instaladores:**
- [ ] Instalador Windows y macOS (arm64 e Intel): venta sin red → cerrar la app → abrir → iniciar sesión → se sube.
- [ ] Reloj de la caja desajustado (adelantado > 5 min / atrasado > 30 d): la venta entra y queda `NEEDS_REVIEW`.
- [ ] Corte de luz con el outbox lleno (`synchronous=FULL`): tras el corte no se pierde ninguna venta confirmada al cajero.
- [ ] Varias cajas del mismo negocio vendiendo el mismo producto offline: stock final en 0 (nunca negativo) y sin duplicados.
- [ ] Otro tenant en la misma máquina: cada uno ve solo su outbox y nunca sube con el token del otro.
- [ ] Despliegue: backend a Railway primero (V17 sobre la base real: revisar duración del `UPDATE ... product_name`), luego POS web/instaladores, luego admin.

## C. Deuda técnica registrada

- **Stock negativo en el camino legado**: `POST /api/sales` directo (POS web, admin) sigue permitiendo stock negativo; solo el camino del outbox aplica el piso en 0.
- **Tabla de sobreventas** (idea futura, no implementada): hoy el piso en 0 oculta cuánto se vendió de más.
- **JWT de 1 h sin renovar** (fase 4): pasada la hora el POS pide login para subir lo pendiente (el aviso "Sesión vencida: iniciá sesión" lo explica). La sesión de dispositivo de semanas, revocable, es la fase 4.
- **Historial ya perdido por el CASCADE anterior**: los ítems de ventas de productos que ya se habían borrado antes de V17 no se pueden recuperar; V17 evita que vuelva a pasar (`ON DELETE SET NULL` + snapshot).
- **Cobertura de `omero`** (`yarn test --coverage`): el umbral global de 85 % de `src/lib/**` ya fallaba antes de esta feature (`tenantTime.ts` 29 %, `...nValidation.ts` 0 %); los archivos nuevos están al 100 %.
- **`next lint` de `omero`** no corre (config de ESLint con referencia circular) — preexistente.
- **Outbox sin cifrar** (SQLCipher fuera de alcance) y sin métrica/alarma de "cola creciendo".
- **Un PENDING que el backend rechaza siempre con `INTERNAL_ERROR`** se reintenta cada 810 s indefinidamente (no hay tope de intentos): revisar si conviene un tope + aviso.

## D. Orden de PRs y despliegue

1. `omero-backend` → `develop` (V17 + `/api/sync/batch` + revisión + `mp_offline`). **Desplegar primero**: el POS nuevo contra un backend viejo queda en `unsupported` (sin pérdida), pero el admin nuevo necesita los endpoints de revisión.
2. `omero-electron` → `develop` (outbox, sender, intercepción, UI, instalador).
3. `omero` → `develop` (pantalla de revisión, contador, switch).
