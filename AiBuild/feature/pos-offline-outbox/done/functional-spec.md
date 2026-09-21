# Functional Spec: Outbox de ventas y gastos offline (Fase 3)

## Metadata
- **Tipo:** feature (cruza 3 repos)
- **Ramas:** `feature/pos-offline-outbox` en `omero-electron` (POS), `omero-backend` y `omero` (admin), todas desde su `develop`, con PR contra `develop`
- **Ticket:** N/A
- **Tests requeridos:** sí
- **Fecha:** 2026-09-21
- **Estado:** WIP

## Resumen
En el POS **desktop**, cada venta y cada gasto se guarda **primero en SQLite local** y el cajero puede seguir trabajando; el envío al `omero-backend` de Railway es **asíncrono, idempotente y con reintentos**. El backend recibe los envíos por lotes, respeta el `createdAt` exacto de la caja, resuelve el costo al recibir la venta, mantiene el stock en 0 como mínimo y **marca para revisión** lo que no pueda guardar limpio (p. ej. producto eliminado). En el **admin** aparece una pantalla de "ventas a revisar" donde un administrador ve todo el detalle, marca como revisada o asigna un producto a un ítem huérfano. Se agrega la clave de negocio `mp_offline` para permitir o no el pago con MercadoPago sin conexión. El modo **web** no encola nada.

## Contexto del proyecto
- **Fases previas (mergeadas):** `web/` con proxy runtime y capa de datos `handleApiRequest`; caché SQLite de solo lectura del catálogo por tenant (`better-sqlite3` 12.11.1 en Electron 40, syncer, `ConnectionStatus` en el header del POS).
- **Ventas hoy:** `POST /api/sales` crea **una** venta por request (`SaleService.create`): calcula `total`, efectivo/MP/vuelto; el **costo ya lo resuelve el backend** (`unitCost` = `product.costPrice`; para el código `000` = precio) y **descuenta stock sin piso** (puede quedar negativo). Un producto inexistente lanza `EntityNotFoundException` y **falla toda la venta**. Si hay monto MP, la venta queda `mpStatus = PENDING` y se dispara la conciliación; además se crea un gasto automático de impuesto MP (`createMercadoPagoTax`). `SaleItem` exige `product`.
- **Gastos hoy:** `POST /api/expenses` (uno por request). Sin `clientId`.
- **Cola offline actual del POS** (`useSales` + `useOfflineQueue` + `purchaseQueueStorage`, en `localStorage`, clave `omero_purchase_queue`; los nombres dicen "purchase" por herencia pero son **ventas**): 1 intento, luego 3 reintentos en background (3/9/27 s) y guarda en la cola; `flushQueue` reenvía de a una. **No es idempotente**: un reintento tras un timeout con éxito duplicaría la venta. No hay cola para gastos.
- **Configuración de negocio:** `BusinessConfig` (key/value/type por tenant) con whitelist `BusinessConfigKey`; API `GET/PUT /api/business/config/{key}`.
- **Conciliación MP (admin `omero`):** estados `PENDING | MATCHED | VALIDATED`; el admin "valida" sin editar. Es el modelo de UX para las ventas a revisar.
- **JWT:** dura 1 h y el POS no lo renueva (limitación heredada; la fase 4 lo resuelve).

## Descripción detallada

### 1. Outbox local (POS desktop)
1. Toda venta y todo gasto creado en desktop se inserta en una **tabla outbox de SQLite** (con `clientId` UUID generado en la caja) y el POS recibe la confirmación **inmediatamente**, con conexión o sin ella (un solo camino, sin distinguir online/offline).
2. Un **sender** en el Next envía la cola al backend **por lotes**, del más viejo al más nuevo, de forma asíncrona. Con éxito, cada ítem se marca como enviado y no se reintenta.
3. **Reintentos:** ante un fallo de red/timeout/5xx reintenta a los **30 s → 90 s → 270 s → 810 s** y desde ahí **cada 810 s**; un éxito reinicia la secuencia. Una venta nueva o la recuperación de conexión disparan un intento inmediato.
4. El **outbox no se borra al cerrar sesión** (a diferencia de la caché del catálogo): las ventas pendientes pertenecen al tenant y se suben cuando ese tenant vuelva a tener sesión. El outbox vive separado de la caché.
5. **Stock mostrado:** al leer el catálogo cacheado, el POS muestra `stock del backend − cantidades vendidas aún sin subir` (piso en 0); al subirse deja de descontarse porque el backend ya lo incluye.
6. **Migración de la cola vieja:** al primer arranque con el outbox, los ítems de `localStorage` (`omero_purchase_queue`) del tenant se importan al outbox (asignándoles `clientId`) y se limpia la cola vieja para que no haya doble envío.

### 2. Backend (`omero-backend`)
1. **Endpoint por lotes idempotente** para ventas y gastos. Por cada ítem responde `CREATED`, `DUPLICATE` (mismo `clientId`: devuelve la venta/gasto existente, **sin duplicar ni tocar stock**) o `REJECTED(motivo)`. Un ítem malo no frena a los demás. `clientId` con restricción única por tenant.
2. **Fechas:** acepta el `createdAt` exacto de la caja; `updatedAt` es siempre la hora del servidor al guardar. Ventana válida: hasta **30 días hacia atrás** y una tolerancia mínima a futuro (unos minutos); fuera de rango la venta **se guarda igual pero marcada para revisión**.
3. **Costo:** el POS no envía costo; el backend lo resuelve **al recibir** la venta con el costo vigente en ese momento (comportamiento actual, ahora explícito).
4. **Stock:** se aceptan las ventas; el stock **nunca queda negativo** (queda en 0). La tabla de sobreventas queda como idea futura y **no se implementa**.
5. **Tolerancia a productos eliminados:** cada ítem trae un **snapshot** de código y nombre. Si el producto ya no existe, la venta **se guarda igual**: el ítem queda sin producto (con su snapshot y costo 0), no toca stock y la venta queda **marcada para revisión** con el motivo (`PRODUCT_NOT_FOUND`) y el detalle por ítem.
6. **Estado de revisión** en la venta: `sin revisión` / `requiere revisión` / `revisada`, con motivos, quién y cuándo revisó y una nota.
7. **Asignar producto** a un ítem huérfano (acción de admin): el ítem toma el **costo vigente** del producto asignado y se **descuenta su cantidad del stock (piso en 0)**; el snapshot original se conserva y queda registro de quién asignó y cuándo. Cuando todos los ítems huérfanos se resuelven, la venta puede marcarse como revisada.
8. **`mp_offline`:** nueva clave de `BusinessConfig` (booleana, por defecto desactivada) editable por el admin y legible por el POS.
9. **MercadoPago offline:** una venta con monto MP creada offline entra igual con `mpStatus = PENDING` y sigue el flujo de conciliación existente.
10. **Alcance del camino:** por este camino solo se aceptan **ventas y gastos**; la lectura del catálogo sigue por la caché de la fase 2. Cambios aditivos: el `POST /api/sales` actual sigue funcionando (compatibilidad con el modo web y con POS viejos).

### 3. Visibilidad y control en el POS
1. Se reutiliza el `ConnectionStatus` del header: el chip **"N pendientes sin sync"** ahora cuenta el outbox y el botón **Actualizar** sigue **solo verificando la conexión** (no fuerza envíos).
2. Una **lista de "requieren revisión / con error"** en el POS muestra lo que el backend rechazó o marcó (con motivo y todos los datos de la venta/gasto) y lo que quedó en fallo permanente; el cajero puede verla (no decide por el admin).
3. Con **`mp_offline` desactivado** y sin conexión, el botón de pago con MercadoPago se **deshabilita** con un mensaje claro; con `mp_offline` activado se permite y la venta entra como `PENDING`. El valor de `mp_offline` se cachea localmente para poder consultarlo sin conexión.
4. Cerrar sesión con ventas pendientes **avisa** que siguen guardadas y se subirán al volver a iniciar sesión con ese negocio.

### 4. Admin (`omero`)
1. Nueva pantalla **"Ventas a revisar"** (mismo estilo de la conciliación de MP): listado con contador y filtros; el detalle muestra **todos los ítems** (snapshot de código/nombre, cantidad, precios, costo, si tienen o no producto), pagos (efectivo/MP/vuelto), fechas de creación en caja y de recepción, motivos y estado.
2. Acciones: **marcar como revisada** (con nota) y **asignar un producto** a un ítem sin producto (con los efectos del punto 2.7). Sin anular ni editar precios/cantidades.
3. Configuración de **`mp_offline`** accesible al admin.
4. Indicador de cuántas ventas requieren revisión (p. ej. en el inicio/menú del admin).

## Flujos principales

### Flujo 1: Venta con conexión (desktop)
1. El cajero cobra → el Next inserta la venta en el outbox y responde de inmediato; el POS sigue.
2. El sender la envía al backend en el siguiente ciclo (segundos) → `CREATED` → se marca enviada.
3. El stock mostrado ya descontaba la venta; tras el próximo snapshot el backend lo incluye.

### Flujo 2: Venta sin conexión
1. Igual que el flujo 1 hasta el paso 1; el envío falla → reintentos 30/90/270/810 s y luego cada 810 s.
2. El header muestra "Sin conexión… · N pendientes sin sync".
3. Vuelve la conexión → intento inmediato → el lote se sube del más viejo al más nuevo → el chip se apaga.

### Flujo 3: Reintento tras un timeout con éxito (idempotencia)
1. El envío llegó al backend y guardó la venta pero la respuesta se perdió.
2. El reintento manda el mismo `clientId` → el backend responde `DUPLICATE` con la venta existente → se marca enviada, **sin duplicar** ni volver a descontar stock.

### Flujo 4: Producto eliminado mientras se estaba offline
1. Se sube la venta; un ítem apunta a un producto que ya no existe.
2. El backend guarda la venta con ese ítem sin producto (snapshot) y la marca **requiere revisión (`PRODUCT_NOT_FOUND`)**; el resto de los ítems descuenta stock normalmente.
3. En el admin, el administrador ve la venta, asigna un producto al ítem (costo vigente + stock) y la marca revisada con una nota.

### Flujo 5: Venta con MercadoPago sin conexión
1. Con `mp_offline` activo y sin conexión, el cajero registra pago MP; la venta queda en el outbox.
2. Al subir entra con `mpStatus = PENDING` y se concilia con la transacción de MP cuando llegue.
3. Con `mp_offline` desactivado el botón MP está deshabilitado offline.

### Flujo 6: Gasto offline
1. El cajero agrega un gasto sin conexión → outbox con `clientId` → se sube igual que una venta, idempotente.

### Flujo 7: Cerrar sesión con pendientes / sesión vencida
1. El JWT vence (1 h) con pendientes: el sender deja de intentar (401) sin perder nada; el chip sigue mostrando los pendientes.
2. Al volver a iniciar sesión con el mismo negocio, el outbox se reanuda solo. Cerrar sesión **no** borra el outbox.

### Flujo 8: Modo web
1. Sin cola: la venta se envía en el momento; si falla, se muestra el error y no se guarda nada localmente. (Los ítems que ya estuvieran en la cola vieja de `localStorage` se envían una última vez y no se vuelve a encolar.)

## Casos borde
- **Venta fuera de ventana de fechas** (más de ~30 días atrás o en el futuro): se guarda con `createdAt` recibido y queda marcada para revisión.
- **Lote con ítems malos:** el resto se procesa; los rechazados vuelven con motivo y quedan visibles en la lista del POS (datos conservados).
- **Rechazo por validación** (p. ej. sin ítems): no se reintenta indefinidamente; queda como "con error" en el POS con motivo.
- **Respuesta con error 4xx no recuperable** para un ítem: no se reintenta; se conserva para revisión.
- **Doble envío concurrente** (dos ciclos del sender): un solo lote en vuelo a la vez.
- **Reinicio de la app con pendientes:** el outbox persiste en SQLite y se retoma.
- **Otro negocio inicia sesión en la misma máquina:** cada tenant tiene su outbox; nunca se sube el de otro.
- **Código `000` (precio libre):** sigue agrupándose como hoy y su costo es el precio (comportamiento actual).
- **Stock ya en 0 o menor cantidad que la vendida:** el stock queda en 0; la venta no se marca para revisión por eso (la tabla de sobreventas queda para el futuro).
- **Producto con precio cambiado mientras estaba offline:** se respeta el precio de la venta tal como salió; el costo se toma al recibirse.
- **MP offline + conciliación:** una venta MP subida tarde se concilia con la transacción cuando exista; si la transacción no aparece, queda `PENDING` como hoy.
- **Backend viejo sin el endpoint por lotes** (POS nuevo contra backend sin desplegar): el sender detecta el 404 y usa el camino individual con `clientId` como cabecera/campo opcional, o pausa con aviso (definir en `sdd-tech`).

## Criterios de aceptación
- [ ] Dado el desktop con o sin conexión, cuando el cajero cobra, entonces la venta se guarda en SQLite y el POS confirma de inmediato sin esperar al backend.
- [ ] Dado el backend inaccesible, cuando el sender falla, entonces reintenta a los 30, 90, 270 y 810 s y luego cada 810 s; un éxito reinicia la secuencia.
- [ ] Dado el mismo `clientId` enviado dos veces, entonces el backend guarda **una sola** venta, la segunda respuesta es `DUPLICATE` y el stock se descuenta una sola vez.
- [ ] Dado un lote con un ítem inválido, entonces el resto se crea y el inválido vuelve como `REJECTED(motivo)`.
- [ ] Dada una venta con un producto eliminado, entonces se guarda con ese ítem sin producto (con snapshot), sin afectar su stock, y queda **requiere revisión** con el motivo y el detalle por ítem.
- [ ] Dado un `createdAt` dentro de la ventana, entonces se conserva exacto y `updatedAt` es la hora del servidor; fuera de la ventana se guarda y se marca para revisión.
- [ ] Dado el descuento de stock de una venta subida, entonces el stock resultante nunca es negativo (queda en 0).
- [ ] Dado el costo, entonces el POS no lo envía y el backend lo resuelve con el costo vigente al recibir la venta.
- [ ] Dadas ventas pendientes, entonces el catálogo cacheado muestra `stock − pendientes` (piso 0) y deja de descontarlas cuando se suben.
- [ ] Dado un cierre de sesión con pendientes, entonces el outbox se conserva, se avisa al usuario y se reanuda al volver a iniciar sesión con ese negocio; otro negocio no ve ni sube esas ventas.
- [ ] Dado `mp_offline` desactivado y sin conexión, entonces el botón de MercadoPago está deshabilitado; con `mp_offline` activo se permite y la venta sube como `PENDING`.
- [ ] Dado el admin, entonces ve la lista de "ventas a revisar" con todos los ítems y datos, puede marcarla como revisada con una nota y asignar un producto a un ítem huérfano (el ítem toma el costo vigente, se descuenta el stock con piso 0 y se registra quién y cuándo).
- [ ] Dado el modo web, entonces no se encola nada localmente: si falla el envío, se muestra el error; los ítems de la cola vieja se envían una última vez.
- [ ] Dada la cola vieja de `localStorage`, entonces al primer arranque con el outbox sus ventas se importan al outbox del tenant correspondiente y no se envían dos veces.
- [ ] Dado el POS actual (o el modo web) contra el backend nuevo, entonces `POST /api/sales` sigue funcionando sin cambios.
- [ ] Los gastos siguen el mismo camino que las ventas (outbox, idempotencia, reintentos).
- [ ] `tsc`, los tests y la cobertura mínima pasan en los tres repos.

## Fuera de alcance
- Fase 4: sesión de dispositivo de semanas, revocación, renovación del JWT (hoy: pendientes se reanudan al volver a iniciar sesión).
- Tabla de sobreventas y cualquier reporte de sobreventa (queda como idea).
- Anular/revertir ventas, editar precios o cantidades desde el admin.
- Migración de datos H2 → Railway; borrar `/pos` de `omero`; rediseño del POS.
- Cifrado de la base (SQLCipher).
- Escrituras offline de otras entidades (productos, compras, proveedores, promociones).

## Constraints
- Solo modo desktop (`OMERO_RUNTIME=desktop`); el modo web no puede depender de SQLite ni encolar.
- Cambios de backend **aditivos y compatibles hacia atrás** (migraciones Flyway; endpoint por lotes nuevo; `POST /api/sales` y `POST /api/expenses` intactos). El backend se despliega **antes** que el POS nuevo.
- Idempotencia garantizada por restricción única de `clientId` por tenant.
- El outbox debe ser **durable** (escrituras con `synchronous=FULL` o equivalente): una venta confirmada al cajero no se puede perder ante un corte de luz.
- Tres repos, tres PRs contra `develop`, en orden: backend → POS → admin. `master` no se toca.
- Seguridad: el tenant del outbox sale del JWT (solo para elegir archivo); el backend valida siempre el JWT y el tenant.
- Sin datos sensibles nuevos en logs (ni `Authorization`).

## Decisiones adoptadas por defecto (confirmar en la revisión)
- Los gastos usan el mismo outbox y el mismo endpoint por lotes que las ventas.
- La cola vieja de `localStorage` se importa al outbox en el primer arranque y luego se limpia.
- En modo web se deja de encolar; los pendientes viejos se envían una última vez.
- El outbox vive en un archivo SQLite separado de la caché y **no** se borra al cerrar sesión.
- Un intento inmediato al crear una venta nueva o al detectarse la recuperación de conexión, además de la secuencia 30/90/270/810 s.
- Orden de entrega: backend → POS → admin.

## Preguntas abiertas
- Nombre y forma exacta del endpoint por lotes (`/api/sales/batch` + `/api/expenses/batch`, o uno combinado) y del contrato de resultados (se define en `sdd-tech`).
- Compatibilidad del POS nuevo con un backend sin el endpoint por lotes (fallback vs. pausa con aviso).
- Dónde se edita `mp_offline` en el admin (pantalla de configuración existente o nueva).
- Ubicación exacta de la lista "requieren revisión" en la pantalla del POS y política de retención de ítems ya enviados en el outbox.
