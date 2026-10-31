# Checklist de verificación — Caché SQLite del catálogo (Fase 2)

## A. Smoke ejecutado durante el build (T014) — 2026-09-21
Servidor: `resources/frontend/server.js` (salida de `npm run prepare:app`, mismo layout que el instalador) corrido con el **Node de Electron 40** (`ELECTRON_RUN_AS_NODE=1`, ABI 143), `OMERO_RUNTIME=desktop`, `OMERO_SQLITE_BINDING=resources/native/better_sqlite3-darwin-x64.node` y una carpeta de datos limpia. Backend real (`devdata`) detrás de un **proxy intermitente** (`flaky-proxy`) que simula una caída (503) sin tocar el backend. Máquina: Mac Intel x64.

| # | Verificación | Resultado |
|---|---|---|
| 1 | El binario de Electron carga bajo el ABI 143 (`npm run verify:native`) | ✅ SQLite 3.53.2 |
| 2 | Un binario de ABI de Node (127) o de otra arquitectura **falla** con mensaje claro (`NODE_MODULE_VERSION 127… requires 143`) | ✅ |
| 3 | `fetch:native`: sin checksum falla; con hash alterado falla; `--update` registra; los 3 binarios tienen el formato correcto (PE32+ x64, Mach-O arm64, Mach-O x86_64) | ✅ |
| 4 | Login real por el proxy → `GET /api/products` 200 (25 productos), sin `X-Omero-Cache`; se crea `<tenantId>.sqlite` | ✅ |
| 5 | `GET /api/promotions` y `GET /api/products/{code}` online → 200 | ✅ |
| 6 | Backend caído (503): `/api/products`, `/api/products/{code}` y `/api/promotions` → **200 con `X-Omero-Cache: hit`** | ✅ |
| 7 | La respuesta desde caché es **idéntica** al JSON del backend (mismo contenido y **mismo orden**) | ✅ (encontró y corrigió un bug: `INSERT OR REPLACE` movía filas al final) |
| 8 | Código inexistente, `/api/products/search` y `?categoryId=` con backend caído → 503 original (no se sirve caché) | ✅ |
| 9 | `connectivity`: `online:false`, `runtime:desktop`, `cache.products=25`, antigüedad | ✅ |
| 10 | Sin token → 401 del backend; token inválido → 401 sin `X-Omero-Cache` | ✅ |
| 11 | El syncer refresca solo (cada 5 s en la prueba) y tras una caída recupera y sincroniza al volver el backend (3 s) | ✅ |
| 12 | `DELETE /api/_local/cache` → 204 y el `.sqlite` desaparece; sin `Authorization` → 401; sin caché y backend caído → 503 | ✅ |
| 13 | Modo **web** con `OMERO_DATA_DIR` definida: 0 archivos creados, `cache: null` | ✅ |
| 14 | Desktop **sin** `OMERO_DATA_DIR` (producción): avisa y el POS sigue (200) | ✅ |
| 15 | Desktop con binario de **ABI equivocado**: avisa y el POS sigue (200), sin archivos | ✅ |
| 16 | POS de desarrollo (`dev.sh`, Node del sistema) crea `web/.data/<tenant>.sqlite` | ✅ |
| 17 | Docker `web/` construye (sin `--omit=optional`, que rompía Tailwind/SWC) | ✅ |

## B. Pendiente de verificación manual (no automatizable aquí)

### B1. Electron 40 (regresión, commit aislado `cd60f99`)
- [ ] `npm run dev` con el POS: la ventana abre a pantalla completa sin marco; splash correcto.
- [ ] Numpad y atajos funcionan; **F1 sigue bloqueado**; teclas alfabéticas bloqueadas.
- [ ] En el instalador: la ventana recupera el foco al perderlo; cierre limpio (sin procesos huérfanos).
- [ ] Requisito de SO: Electron ≥ 38 exige **macOS 12+** (Windows 10+, sin cambio). Confirmar con los clientes.

### B2. Aviso de conexión en el POS (UI)
- [ ] Con conexión y sin pendientes: **no** se ve ningún aviso (desktop) y en web el header es el de siempre (botón "Actualizar" de productos).
- [ ] Apagar internet / backend: aparece "Sin conexión con el servidor · catálogo de hace X" y el botón **Actualizar**; al pulsarlo dice "Verificando…" y **solo** verifica la conexión (no cambia productos ni envía nada).
- [ ] Con ventas encoladas: aparece "N pendientes sin sync" aunque haya conexión.
- [ ] Sin conexión el POS sigue vendiendo con el catálogo cacheado (búsqueda por código y por prefijo).
- [ ] Cerrar sesión borra la caché (verificar que desaparece `<userData>/catalog-cache/<tenant>.sqlite`).

### B3. Instalador Windows x64
- [ ] `OMERO_DEFAULT_BACKEND_URL` definida; `npm run build:win` (o tag) genera el instalador; en CI corren `fetch:native` y `verify:native` (Electron real en Windows).
- [ ] La app instalada crea `%APPDATA%\Omero POS\catalog-cache\<tenant>.sqlite` tras iniciar sesión.
- [ ] Sin internet: el POS ya abierto sigue funcionando desde la caché.

### B4. Instalador macOS (DMG universal: arm64 e Intel)
- [ ] Los recursos están en `Contents/Resources` (se corrigió el uso de `process.resourcesPath`; **el instalador de macOS no se había probado en la fase 1**).
- [ ] En **Intel**: `npm run verify:native` pasa (probado). En **Apple Silicon**: ejecutar `npm run verify:native` en un Mac arm64 (el binario arm64 no se puede cargar en Intel).
- [ ] La caché se crea en `~/Library/Application Support/Omero POS/catalog-cache/`.

## C. Limitaciones aceptadas y deuda técnica
- **JWT de 1 h sin renovación** (`Sesión offline`): con el POS ya abierto la caché sirve sin conexión; si se reinicia/recarga pasada la hora se pide login y no se puede entrar sin internet. Lo resuelve la **fase 4** (token de dispositivo).
- **Stock y precios cacheados** pueden diferir del real (otras cajas venden). El manejo del stock por ventas offline es de la **fase 3**.
- **Node 20** (Docker/CI del POS web) ya está fuera de soporte; el desktop corre en Node 24 (Electron 40). Subir Docker/CI en otro cambio.
- `better-sqlite3` **13.x** aún no publica binarios (y exige Node ≥22): se usa la 12.11.1; `node:sqlite` sigue experimental. La interfaz `CatalogStore` permite cambiar el motor.
- Electron **41+** no tiene aún binarios de `better-sqlite3` 12.x (ABI ≥145): 40 es el techo.
- La base **no está cifrada** (SQLCipher fuera de alcance): contiene precios de costo y venta en el perfil del usuario del SO.
- `electron-builder` sigue en 25.1.8 (funciona con Electron 40 en typecheck; el empaquetado real en Windows/macOS queda para B3/B4).
- Pendientes de otras fases: outbox de ventas/gastos y `mp_offline` (fase 3), sesión de dispositivo (fase 4), migración H2 → Railway, borrar `/pos` de `omero`, `middleware` → `proxy` de Next 16.
