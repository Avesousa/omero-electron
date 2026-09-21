# Functional Spec: Caché SQLite del catálogo para el POS desktop (Fase 2)

## Metadata
- **Tipo:** feature
- **Rama:** `feature/pos-sqlite-catalog-cache` (base: `develop`)
- **Ticket:** N/A
- **Tests requeridos:** sí
- **Fecha:** 2026-09-21
- **Estado:** WIP

## Resumen
En modo **desktop**, el Next local del POS mantiene una **caché SQLite de solo lectura del catálogo** (productos y promociones) por tenant. Con conexión, las lecturas van al backend de Railway y la caché se refresca con un snapshot completo; si el backend no responde (red caída, timeout, gateway 502/503/504), esas mismas lecturas se sirven desde SQLite para que el POS siga funcionando. El POS muestra un aviso con un botón **"Actualizar"** que solo verifica la conexión. El modo **web** no cambia.

## Contexto del proyecto
- Fase 1 (mergeada y validada): `web/` con proxy runtime `/api/*` → `omero-backend` (`lib/backend-proxy.ts`), `OMERO_RUNTIME=web|desktop`, Electron sin Java.
- Lecturas de catálogo del POS: `GET /api/products` (lista completa), `GET /api/products/{code}` (fallback por código), `GET /api/promotions` (el POS filtra las `ACTIVE`). El resto de lecturas del POS (`/api/sales`, `/api/expenses`, `/api/dashboard/daily-summary`, `/api/mercadopago/transactions`) **no** son catálogo.
- Hoy el POS ya cachea productos en `localStorage` (`pos_products_cache`, con revalidación en background, timeout 2 s y reintento cada 30 s) y tiene una cola de compras/ventas en `localStorage` (`useOfflineQueue`, `purchaseQueueStorage`). Esa lógica de cliente **se mantiene**; la caché SQLite aporta persistencia del lado del servidor local, lookups por código/código de barras sin depender del navegador, promociones en caché y la base sobre la que se apoyará la fase 3.
- Backend (`omero-backend`, **sin cambios en esta fase**): `GET /api/products` no soporta `updatedSince`; `Product` y `Promotion` tienen `updatedAt` pero el borrado de productos es **físico** (sin marca de eliminado); el tenant viaja en el claim `tenantId` del JWT; el JWT dura **1 hora** y el POS no lo renueva.
- Stack: Electron 33 (Node 20 en `utilityProcess`), Next.js 16 standalone, `web/src/lib/backend-proxy.ts`.

## Descripción detallada
1. **Almacenamiento:** SQLite embebido (`better-sqlite3`), una base **por tenant** (se identifica por el claim `tenantId` del JWT), en un directorio de datos de la app. Solo en modo desktop.
2. **Contenido de la caché (solo lectura):** lista de productos (con su categoría), promociones y metadatos de sincronización (`lastSyncAt` por recurso).
3. **Sincronización (snapshot completo):** cada sync exitoso baja la lista completa y **reemplaza la caché en una transacción** (así se detectan los productos eliminados sin cambios en el backend). Se dispara: al abrir el POS/después de un login, cada **5 minutos** con conexión y al **recuperar la conexión**.
4. **Lectura resiliente:** para `GET /api/products`, `GET /api/products/{code}` y `GET /api/promotions`, el Next intenta el backend; si falla por **error de red, timeout o 502/503/504**, responde desde SQLite. Un 401/403/404 o un 500 **no** activan la caché (son respuestas reales del backend). Las respuestas servidas desde caché llevan un header que lo indica y la fecha de la caché.
5. **Capa de datos:** en los route handlers de Next, el modo web usa proxy directo y el desktop usa offline-first, con un punto de extensión claro para que la fase 3 agregue escrituras (outbox) sin reescribir.
6. **Aviso "Actualizar" en el POS:** aparece cuando **no hay conexión con el backend** o **hay cosas por subir** (hoy: las ventas/compras encoladas en `localStorage`; en fase 3 el outbox). Muestra el estado (sin conexión / N por subir / datos de hace X min) y un botón **"Actualizar"** cuyo único efecto es **verificar la conexión con el backend** (nada más: no fuerza sincronizaciones ni envía datos). Si la conexión vuelve, el aviso desaparece y el refresco normal ocurre por el proceso automático.
7. **Ciclo de vida:** al **cerrar sesión** se borra la base del tenant. La base tiene **versión de esquema** y migraciones automáticas al abrir, desde la primera versión.
8. **Empaquetado:** el módulo nativo se compila para Electron 33 y el standalone lo incluye, en Windows x64 y macOS universal.

## Flujos principales
### Flujo 1: Con conexión (cajero abre el POS)
1. Login (contra Railway). El POS pide `GET /api/products` y `GET /api/promotions` por el proxy.
2. El Next reenvía al backend, devuelve la respuesta y **actualiza SQLite** (snapshot, transaccional).
3. Cada 5 minutos se repite el refresco. El POS opera normalmente.

### Flujo 2: Se cae la conexión con el POS abierto
1. El POS pide `/api/products` (revalidación) y el backend no responde (timeout/red/502-504).
2. El Next responde desde SQLite con el header de "servido desde caché" y la fecha.
3. El POS sigue vendiendo con el catálogo cacheado; aparece el aviso "Sin conexión · datos de hace X min" con el botón **Actualizar**.
4. Buscar por código/código de barras o prefijo sigue funcionando; `GET /api/products/{code}` se resuelve desde la caché.

### Flujo 3: Botón "Actualizar"
1. El cajero pulsa **Actualizar**.
2. El POS verifica la conexión con el backend (chequeo liviano con timeout corto).
3. Si responde: el aviso pasa a estado conectado y desaparece si no hay pendientes; si no: sigue el aviso con la hora del último chequeo. **No** se dispara ninguna sincronización desde el botón.

### Flujo 4: Recupera la conexión
1. El siguiente refresco (automático o por recuperación de conexión) tiene éxito, reemplaza la caché y limpia el aviso de "sin conexión".

### Flujo 5: Cierre de sesión
1. El POS cierra sesión → el Next borra la base SQLite de ese tenant → el siguiente login la reconstruye desde el backend.

### Flujo 6: Modo web
- Sin cambios: sin caché ni SQLite; si el backend no responde, el POS muestra el error de siempre.

## Casos borde
- **Primer uso sin conexión / caché vacía:** no hay nada que servir → se devuelve el error normal (502/504) y el aviso indica que no hay datos locales.
- **Producto eliminado en el backend:** desaparece de la caché en el siguiente snapshot exitoso; si se consulta por código y no existe (404 real con conexión) no se sirve de caché.
- **Cambio de tenant/usuario en la misma máquina:** cada tenant tiene su base; el logout borra la del tenant saliente.
- **JWT vencido (1 h) sin conexión:** limitación **aceptada** en esta fase: el POS ya abierto sigue operando; una recarga/reinicio pasada la hora pide login y no se puede entrar sin internet (lo resuelve la fase 4).
- **Snapshot interrumpido a medio camino:** la transacción hace que la caché anterior siga intacta (nunca queda una lista parcial).
- **Base corrupta o versión de esquema más nueva/incompatible:** se descarta y se reconstruye (es solo caché); se registra en logs.
- **Respuesta del backend con lista vacía:** se acepta como snapshot válido solo si el status fue 200 (un tenant puede no tener promociones).
- **Stock y precios desactualizados:** el stock cacheado puede diferir del real (otras cajas venden); el aviso muestra la antigüedad. El manejo del stock por ventas offline es de la fase 3.
- **Sin permisos de escritura en el directorio de datos:** el POS funciona sin caché (degrada a proxy directo) y lo loguea.
- **Modo web o `OMERO_RUNTIME` desktop sin módulo nativo disponible:** el arranque no debe romperse; se degrada a proxy directo.

## Criterios de aceptación
- [ ] Dado el modo desktop con conexión, cuando el POS pide `/api/products` y `/api/promotions`, entonces la respuesta es la del backend y SQLite queda con ese snapshot (transaccional).
- [ ] Dado el modo desktop y el backend inaccesible (red/timeout/502/503/504), cuando el POS pide `/api/products`, `/api/products/{code}` o `/api/promotions`, entonces recibe los datos desde SQLite con el header de "servido desde caché" y la fecha de la caché.
- [ ] Dado un 401, 403, 404 o 500 del backend, entonces **no** se sirve la caché y la respuesta del backend pasa sin modificar.
- [ ] Dado que un producto fue eliminado en el backend, cuando ocurre el siguiente sync exitoso, entonces deja de estar en la caché.
- [ ] Dado un sync que falla a mitad de camino, entonces la caché previa permanece intacta.
- [ ] Dado el modo web, entonces no se crea ninguna base SQLite y el comportamiento es idéntico al de la fase 1.
- [ ] Dado el POS desktop sin conexión con el backend, entonces se muestra el aviso con la antigüedad de la caché y el botón **Actualizar**; al pulsarlo solo se verifica la conexión (sin sincronizar ni enviar datos) y el estado se actualiza.
- [ ] Dado que hay ventas/compras encoladas por subir, entonces el aviso se muestra aunque haya conexión, indicando la cantidad.
- [ ] Dado el cierre de sesión, entonces se borra la base SQLite del tenant.
- [ ] Dadas dos sesiones de tenants distintos en la misma máquina, entonces cada una usa su propia base y no se mezclan datos.
- [ ] Dada una base con esquema de versión anterior, entonces se migra automáticamente al abrir sin perder la caché válida; con versión incompatible se reconstruye.
- [ ] El instalador de Windows x64 y el DMG universal incluyen el módulo nativo y la caché funciona en la app instalada (verificado con checklist manual).
- [ ] `tsc --noEmit` y los tests (unit + integración) pasan en `web/` y en la raíz; cobertura ≥85 % en la capa de caché.

## Fuera de alcance
- Escrituras offline: outbox de ventas y gastos, endpoint por lotes, idempotencia (`clientId`), reintentos 30/90/270/810 s (fase 3).
- `mp_offline` y la pantalla de ventas a revisar en el admin (fase 3).
- Sesión de dispositivo de semanas y revocación (fase 4); refresco del JWT.
- Cambios en `omero-backend` (`updatedSince`, soft delete, tombstones): el delta queda para una optimización futura si el catálogo crece.
- Caché de lecturas que no son catálogo (`/api/sales`, `/api/expenses`, `/api/dashboard/*`, `/api/mercadopago/*`).
- Migración de datos H2 → Railway; eliminar `/pos` de `omero`; rediseño del POS.
- Descuento local de stock por ventas hechas offline (fase 3).

## Constraints
- Solo modo desktop (`OMERO_RUNTIME=desktop`); el modo web no puede cargar ni requerir SQLite.
- El módulo nativo debe funcionar en el `utilityProcess` de Electron 33 (Node 20) para Windows x64 y macOS universal; el standalone de Next debe incluirlo.
- La caché es prescindible (se puede borrar y reconstruir); no debe bloquear el arranque si falla.
- Seguridad: la base vive en el directorio de datos de la app del usuario; se identifica el tenant por el claim `tenantId` (sin poder verificar la firma offline) y solo se usa para elegir la base local, nunca para autorizar acciones en el backend.
- Sin cambios de contrato en `/api/*` salvo headers adicionales en respuestas servidas desde caché y los endpoints locales nuevos (`/api/_local/*`).
- Todo va a `develop` (y luego `sandbox`) con PR; no tocar `master`.

## Preguntas abiertas
- **Semántica exacta del botón "Actualizar":** se interpretó como "solo verifica la conexión con el backend" (sin sincronizar). Confirmar en la revisión de la spec si, al recuperar conexión, prefieren que el propio botón dispare además un refresco (hoy no).
- Ubicación y diseño exacto del aviso en la pantalla del POS (se definirá en `sdd-tech`; debe respetar el estilo oscuro y numpad del POS).
- Directorio de datos y política de retención (se define en `sdd-tech`: `userData/data/<tenantId>.sqlite` inyectado por Electron).
