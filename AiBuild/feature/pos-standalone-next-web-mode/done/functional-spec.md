# Functional Spec: POS independiente con Next y modo web (Fase 1)

## Metadata
- **Tipo:** feature
- **Rama:** `feature/pos-standalone-next-web-mode` (base: `develop`)
- **Ticket:** N/A
- **Tests requeridos:** sí
- **Fecha:** 2026-09-21
- **Estado:** WIP

## Resumen
Separar el POS del admin: `omero` queda como admin y `omero-electron` pasa a ser el proyecto del POS, con su propio Next. Un mismo código corre en dos modos —**web** (servicio en Railway, abierto desde el navegador) y **desktop** (Electron con Next local en `localhost:3000`)— y en ambos habla con el `omero-backend` de Railway. Se elimina Java/JRE/JAR del instalador de escritorio. Esta fase solo entrega la separación y los dos modos con **proxy directo**; la capa offline es de fases posteriores.

## Contexto del proyecto
- `omero` (Next 16, admin + POS actual en `src/app/pos`): habla con el backend vía `rewrites` de `/api/*` → `BACKEND_URL`; sesión con JWT en cookie `omero_session` (middleware + `sessionManager` + `apiClient`).
- `omero-electron` (Electron 33, `main/*.ts`): hoy empaqueta el Next de `omero` + `omero-backend.jar` + JRE 21 (perfil Spring `local`, H2). `process-manager.ts` levanta Java y Node; `main.ts` orquesta splash/ventana.
- `omero-backend` (Spring Boot en Railway) es el único backend de esta arquitectura.
- El POS actual ya tiene teclado con variantes `web` / `electron` / `legacy` y una cola offline en `localStorage` (`useOfflineQueue`) que **no** se toca en esta fase.
- Git: todo va a `develop` (luego `sandbox`) con PR. No tocar `master`/`main`: las instalaciones de escritorio actuales siguen en `master`.

## Visión completa (contexto de fases; solo la Fase 1 está en alcance)
| Fase | Contenido |
|---|---|
| **1 (esta)** | POS a `omero-electron` con Next propio, modo web (Railway) y desktop (Electron, sin Java) con proxy directo |
| 2 | SQLite embebido como caché de solo lectura (catálogo/precios); empaquetado de módulo nativo para Electron |
| 3 | Outbox de ventas y gastos con sincronización asíncrona, idempotencia (`clientId`), endpoint por lotes, pantalla de "ventas a revisar" en el admin, `mp_offline` |
| 4 | Sesión de dispositivo de larga duración (semanas), revocable, con permisos solo de POS |

Decisiones ya acordadas para fases futuras (registradas para no perderlas): stock nunca negativo (queda en 0; tabla de sobreventas queda como idea); la venta conserva su precio pero el **costo se resuelve al sincronizar**; `createdAt` lo envía la caja (límite ~30 días pasado, tolerancia mínima a futuro; fuera de rango va a "revisión") y `updatedAt` lo pone el servidor; reintentos a 30s → 90s → 270s → 810s y luego cada 810s; errores de venta visibles en el admin con detalle de todos los ítems.

## Descripción detallada
1. **`omero-electron` pasa a contener una app Next con el POS**, copiado de `omero` (pantalla `/pos`, sus hooks, componentes, constantes, tipos, layout) junto con lo mínimo que necesita para funcionar solo: login, sesión, `apiClient`, `Modal`, tema, logo y tipos compartidos. **Se duplica** lo compartido con `omero`; el rediseño del POS y la deduplicación quedan para más adelante.
2. **Modo de ejecución explícito** mediante `OMERO_RUNTIME=web|desktop` (no se deduce del entorno de Railway).
3. **Modo web:** el POS se despliega como tercer servicio en Railway y se usa desde el navegador. Todas las llamadas `/api/*` se reenvían al `omero-backend` (URL por `BACKEND_URL`), igual que `omero` hoy. Sin caché ni cola: si no hay conexión el POS muestra error.
4. **Modo desktop:** Electron levanta el Next local (standalone) en `localhost:3000` y abre la ventana contra él. Ese Next reenvía `/api/*` al backend de Railway. **No hay Java, JRE, JAR ni H2** en el instalador ni en el arranque.
5. **URL del backend en desktop:** default embebido en el build (URL de producción de Railway) con override por variable de entorno `BACKEND_URL` (para develop/sandbox).
6. **`omero` (admin):** el acceso al POS pasa a ser un link "Abrir POS" hacia la URL del POS en Railway, configurada con `NEXT_PUBLIC_POS_URL`. El `/pos` interno de `omero` **se mantiene** hasta validar el POS nuevo y se elimina en un PR aparte (fuera de esta fase).
7. **Instalador/CI:** el workflow del instalador deja de descargar JAR y JRE; construye el POS propio y lo empaqueta con Electron.

## Flujos principales
### Flujo 1: Cajero usa el POS desde el navegador (modo web)
1. Abre la URL del POS en Railway → si no tiene sesión, ve el login del POS.
2. Inicia sesión contra `omero-backend`; se guarda el JWT como en `omero`.
3. Opera el POS normalmente (productos, carrito, pago, gastos, resumen). Todas las llamadas van al backend a través del proxy del Next.
4. Sin conexión: el POS muestra error claro y no encola nada.

### Flujo 2: Cajero usa el POS instalado (modo desktop)
1. Abre la app → splash mientras arranca el Next local.
2. Se verifica que el puerto 3000 esté libre; se levanta el Next local; se espera su readiness.
3. Se muestra la ventana (pantalla completa, sin marco) cargando `localhost:3000/pos`.
4. Login y operación idénticos al modo web; `/api/*` se proxea al backend de Railway.
5. Al cerrar, se detiene el Next local sin dejar procesos huérfanos.

### Flujo 3: Admin abre el POS desde `omero`
1. En `omero`, el acceso "Abrir POS" apunta a `NEXT_PUBLIC_POS_URL`.
2. Si la variable no está definida, el acceso cae al `/pos` interno mientras dure la transición.

### Flujo 4: Desarrollo local
- `npm run dev` levanta el Next del POS y Electron cargando `localhost:3000/pos` (o `OMERO_POS_URL`), sin procesos Java.

## Casos borde
- Puerto 3000 ocupado al iniciar el desktop → diálogo de error y salida (como hoy). El puerto 8080 **ya no se verifica**.
- Next local no arranca en el tiempo límite → diálogo de error, se cierra la app.
- Backend de Railway inaccesible en desktop → el POS muestra error de conexión (sin caché en esta fase).
- `BACKEND_URL` inválida o ausente en modo web → el servicio falla de forma visible al arrancar (no silenciosa).
- `OMERO_RUNTIME` ausente o con valor inválido → error explícito al arrancar; no se asume un modo.
- Sesión expirada (401) → redirige al login del POS, igual que `omero`.
- Doble instancia de la app desktop → se respeta el chequeo de puerto ocupado.
- Variantes de teclado: en Electron sigue aplicando `useKeyboard.electron`; en navegador la variante web.

## Criterios de aceptación
- [ ] Dado el repo `omero-electron` en `develop`, cuando se ejecuta el POS con `OMERO_RUNTIME=web` y `BACKEND_URL` apuntando a un backend válido, entonces se puede iniciar sesión y operar el POS desde el navegador.
- [ ] Dado `OMERO_RUNTIME=web` y el backend inaccesible, cuando el cajero opera, entonces ve un error de conexión y no se encola ninguna venta.
- [ ] Dado el instalador desktop, cuando se instala y abre, entonces se levanta un Next local en `localhost:3000` **sin** iniciar ningún proceso Java, y la ventana muestra el POS.
- [ ] Dado el desktop en ejecución, cuando el POS hace una llamada `/api/*`, entonces llega al backend de Railway configurado (default de build u override `BACKEND_URL`).
- [ ] Dado que el puerto 3000 está ocupado, cuando se abre el desktop, entonces se muestra el diálogo de error y la app se cierra.
- [ ] Dado el instalador, entonces no contiene `resources/jre` ni `omero-backend.jar`, y su workflow de CI no los descarga.
- [ ] Dado `omero` con `NEXT_PUBLIC_POS_URL` definida, cuando el admin pulsa "Abrir POS", entonces navega a esa URL; sin la variable, cae al `/pos` interno.
- [ ] Dado el POS nuevo, entonces el login, la sesión (JWT en cookie), el refresco por 401 y el layout del POS funcionan sin depender del código de `omero`.
- [ ] Al cerrar la app desktop no quedan procesos huérfanos (Next local detenido).
- [ ] `tsc --noEmit` y los tests del POS migrado pasan en `omero-electron`.
- [ ] El POS desplegado como servicio en Railway arranca con la configuración documentada (variables, comando de build/start).

## Fuera de alcance
- SQLite, caché de catálogo, outbox, sincronización, reintentos, `clientId`/idempotencia, endpoint por lotes (fases 2–3).
- Sesión larga de dispositivo y revocación (fase 4).
- `mp_offline` y la pantalla de "ventas a revisar" en el admin (fase 3).
- Eliminación del `/pos` dentro de `omero` (PR aparte, tras validar).
- Rediseño del POS y deduplicación de componentes compartidos.
- Auto-updater de Electron (sigue inactivo) y firma de código.
- Cambios en `omero-backend`.
- **Migración de datos H2 → Railway** de las instalaciones actuales (ver pendientes).

## Restricciones
- Base `develop`; PR contra `develop` y luego a `sandbox`. No tocar `master`.
- El modo web no puede depender de nada específico de Electron; el desktop no puede depender de Java.
- Mantener compatibilidad de build para Windows (x64) y macOS (universal), como hoy.
- No exponer secretos en el bundle del cliente (`BACKEND_URL` es de servidor).
- La dependencia con `omero-backend` es solo por su API REST existente.

## Pendientes registrados (fuera de esta fase)
- **Migración H2 → Railway para instalaciones actuales (rama `master`):** las cajas instaladas hoy operan sobre su propia H2 local con ventas propias. Antes de actualizar a esos clientes con el instalador sin Java hay que definir cómo exportar esos datos y subirlos al backend de Railway. Hasta entonces, esas instalaciones **siguen en `master`**.
- Eliminación de `/pos` en `omero` tras validar el POS nuevo.
- Fases 2, 3 y 4 según la tabla de arriba.

## Preguntas abiertas
- Ninguna bloqueante para arrancar. Se definirán en `sdd-tech`: estructura de carpetas del repo (Next + Electron), forma de servir el standalone dentro del instalador y variables exactas del servicio en Railway.
