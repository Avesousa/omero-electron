# Checklist de verificación — POS independiente (Fase 1)

## A. Smoke automatizable ejecutado durante el build (T014) — 2026-09-21
Servidor: `resources/frontend/server.js` (salida de `scripts/prepare-frontend.mjs`, mismo layout que el instalador),
lanzado con `OMERO_RUNTIME=desktop BACKEND_URL=http://localhost:8080` contra el backend local `devdata` (`./dev.sh`).

| # | Verificación | Resultado |
|---|---|---|
| 1 | `GET /api/_local/health` con backend real | 200 `{"ok":true,"runtime":"desktop","backendConfigured":true}` ✅ |
| 2 | `GET /pos` sin sesión | 307 → `/login?redirectTo=%2Fpos` ✅ |
| 3 | `GET /login` | 200 ✅ |
| 4 | Estáticos de `.next/static` servidos | 200 ✅ |
| 5 | Login real `POST /api/auth/login` por el proxy (con header `Origin` del navegador) | `success:true` + `accessToken` ✅ |
| 6 | Llamada autenticada `GET /api/products` | 200 con datos ✅ |
| 7 | Sin token → el 401 del backend pasa sin modificar | 401 ✅ |
| 8 | SSE `/api/mercadopago/events` a través del Next real | evento recibido; `cache-control: no-cache, no-transform`, `x-accel-buffering: no` ✅ |
| 9 | Cierre del cliente SSE: sin errores en el log del servidor y el servidor sigue vivo | ✅ |
| 10 | Sin `OMERO_RUNTIME`/`BACKEND_URL` el proceso **termina con código 1** y mensaje claro | ✅ (corregido durante el build: Next no salía solo) |
| 11 | Imagen Docker de `web/` (`docker build web/`): health 200, `/pos` redirige, proxy llega al backend | ✅ |

Tests automáticos: `web` 92 tests (proxy 100 % líneas / 93,75 % ramas; `runtime` 100 %), raíz 16 tests (100 %).

## B. Pendiente de verificación manual (no automatizable aquí)

### B1. Modo web en Railway
- [ ] Crear servicio nuevo con *Root Directory* `web/`; variables `OMERO_RUNTIME=web`, `BACKEND_URL=<url del omero-backend>`; sin `NEXT_PUBLIC_*`.
- [ ] El deploy pasa el healthcheck `/api/_local/health`.
- [ ] Login y una venta completa desde el navegador contra el backend de Railway.
- [ ] Con el backend apagado: el POS muestra error de conexión y **no** encola ventas.
- [ ] Sin `OMERO_RUNTIME` o `BACKEND_URL` el deploy falla de forma visible (crash + reinicio).
- [ ] El backend **no** necesita agregar el dominio del POS a `CORS_ALLOWED_ORIGINS` (el proxy no reenvía `Origin`).

### B2. Instalador desktop — Windows (x64)
- [ ] Definir la variable de repo `OMERO_DEFAULT_BACKEND_URL` y generar el instalador (tag `v*.*.*` o `npm run build:win` local con la variable).
- [ ] El instalador no contiene `resources/jre` ni `omero-backend.jar` (tamaño notablemente menor).
- [ ] Al abrir: splash → POS en `localhost:3000/pos`; **no** aparece ningún proceso `java`/`javaw` en el Administrador de tareas.
- [ ] Login y venta contra el backend de Railway.
- [ ] Con el puerto 3000 ocupado: diálogo "Puerto en uso" y la app se cierra.
- [ ] Sin `build-config.json` y sin `BACKEND_URL`: diálogo "Configuración incompleta".
- [ ] Override: abrir con `BACKEND_URL=https://otro-backend` apunta al backend indicado.
- [ ] Cerrar la app: no quedan procesos `Omero POS`/`node` huérfanos y el puerto 3000 se libera.
- [ ] Sin internet: el POS muestra error de conexión (sin caché en esta fase).
- [ ] F1 sigue bloqueado y el resto de atajos del POS funcionan (`useKeyboard.electron`).

### B3. Instalador desktop — macOS (universal)
- [ ] Mismos puntos que B2 (DMG universal Intel + Apple Silicon).

### B4. `omero` (admin) — PR aparte
- [ ] Con `NEXT_PUBLIC_POS_URL` definida, "Abrir POS" (menú, tarjetas de inicio y Ventas) abre esa URL.
- [ ] Sin la variable, sigue abriendo `/pos` interno.

### B5. Comportamiento a comunicar
- [ ] La sesión del admin ya **no** se comparte con el POS (orígenes distintos): el cajero inicia sesión en el POS.

## C. Deuda técnica y pendientes registrados
- **Código duplicado con `omero`** (~60 archivos, ver `web/README.md`). Las copias divergirán hasta el rediseño del POS.
- `globals.css` copiado completo (incluye estilos de admin que el POS no usa).
- `middleware.ts` usa la convención deprecada de Next 16 (`proxy`); mismo warning que `omero`.
- npm 10.9 falla con `Cannot read properties of null (reading 'edgesOut')`: se fijó `legacy-peer-deps=true` en `.npmrc` (raíz y `web/`). No hay peers inválidos (`npm ls` limpio). Revisar al actualizar npm.
- Timeout del proxy hasta headers = 30 s (`PROXY_TIMEOUT_MS`); una subida enorme por conexión lenta podría excederlo (el POS solo envía JSON pequeños; las cargas masivas son del admin).
- Sin CI de PR (solo el workflow de tags): conviene agregar uno que corra `npm run check` en ambos paquetes.
- **Eliminar `/pos` de `omero`** cuando este POS esté validado (PR aparte).
- **Migración de datos H2 → Railway** de las instalaciones actuales (rama `master`): pendiente antes de actualizarlas al instalador sin Java.
- Fases 2 (SQLite caché), 3 (outbox de ventas/gastos, `mp_offline`, ventas a revisar en admin) y 4 (sesión de dispositivo larga).
