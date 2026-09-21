# 🖥️ Omero POS — Electron Desktop App

Punto de venta de [Omero](https://github.com/Avesousa/omero) como proyecto independiente del admin. Un mismo Next (`web/`) corre en dos modos y en ambos habla con el `omero-backend` de Railway:

- **Web** (`OMERO_RUNTIME=web`): servicio propio en Railway, se usa desde el navegador.
- **Desktop** (`OMERO_RUNTIME=desktop`): instalador de Electron que levanta el Next local en `localhost:3000` (sin Java) y abre el POS en una ventana sin chrome de browser, con entrada restringida a teclado numérico para terminales de caja dedicadas.

En ambos modos el Next hace de **proxy** `/api/*` → backend (la URL se lee en runtime, `BACKEND_URL`). Si `omero` (admin) cae, el POS sigue funcionando.

## 🚀 Características

- **Sin chrome de browser** — ventana frameless, sin barra de URL ni menú
- **Entrada restringida a numpad** — solo dígitos, Enter, Backspace, operadores y Escape; teclas alfabéticas bloqueadas a nivel OS
- **Shortcodes configurables** — se agregan en `main/keyboard.ts` sin tocar el frontend
- **Detección automática** — el frontend detecta `window.electronAPI.isElectron` y adapta el hook de teclado
- **Sin Java** — el backend es el de Railway; el instalador solo trae Electron + el Next del POS
- **Caché offline del catálogo** — en desktop, productos y promociones se guardan en SQLite por tenant y se sirven si el backend no responde; el header avisa "Sin conexión" con un botón que solo verifica la conexión
- **Auto-updater preparado** — scaffold de `electron-updater` listo para activar cuando se configure code signing

## 🛠️ Tecnologías

- **Electron 40** + **TypeScript 5** (`main/`) — macOS 12+ / Windows 10+
- **Next.js 16 / React 18 / Tailwind 4** (`web/`, el POS)
- **electron-builder** — empaquetado para Windows y macOS
- **electron-updater** — stub de auto-actualización

## 🏗️ Estructura del proyecto

```
omero-electron/
├── main/                         # Electron (CommonJS)
│   ├── main.ts                   # Ciclo de vida: splash → Next local → ventana
│   ├── process-manager.ts        # Levanta/espera/detiene el Next (utilityProcess)
│   ├── config.ts                 # POS_URL, resolveBackendUrl() (BACKEND_URL > default del build)
│   ├── build-config.ts           # Lee resources/build-config.json
│   ├── keyboard.ts               # Filtro de teclas via before-input-event
│   ├── paths.ts                  # RESOURCES_DIR (Windows y macOS)
│   └── preload.ts                # contextBridge mínimo (isElectron, platform)
├── web/                          # Next.js del POS (ESM) — ver web/README.md
│   ├── src/app/pos, login/       # POS (copiado de omero; se rediseñará)
│   ├── src/app/api/[...path]/    # Proxy runtime /api/* → BACKEND_URL
│   ├── src/app/api/_local/health # Readiness local (Electron / Railway)
│   ├── src/lib/{runtime,backend-proxy,data-layer}.ts
│   ├── src/lib/catalog/          # caché SQLite del catálogo (solo desktop)
│   ├── Dockerfile, railway.toml  # Modo web en Railway (Root Directory = web/)
│   └── .env.example
├── scripts/
│   ├── prepare-frontend.mjs      # web/.next/standalone → resources/frontend
│   ├── fetch-native.mjs          # binarios de better-sqlite3 para el ABI de Electron (checksums fijados)
│   ├── verify-native.mjs         # los carga con el Electron real (ELECTRON_RUN_AS_NODE)
│   └── write-build-config.mjs    # OMERO_DEFAULT_BACKEND_URL → resources/build-config.json
├── electron-builder.config.ts    # Windows NSIS x64, macOS DMG universal
└── .github/workflows/installer.yml
```

## ⚙️ Requisitos previos

- Node.js 20+
- Un `omero-backend` accesible (local con `./dev.sh up` desde la raíz de omeroShop, o el de Railway)

## 🚀 Desarrollo

```bash
# 1) Dependencias (raíz = Electron, web/ = POS)
npm install
npm --prefix web install

# 2) Variables del POS
cp web/.env.example web/.env.local      # OMERO_RUNTIME + BACKEND_URL

# 3) POS en el navegador (modo web) → http://localhost:3000/pos
npm run dev:web

# 4) (opcional) Electron cargando ese POS
npm run dev
```

> `./dev.sh up` también levanta el Next de `omero` en `:3000`. Para no chocar: `PORT=3001 npm run dev:web` y
> `OMERO_POS_URL=http://localhost:3001/pos npm run dev`.

Usuarios de prueba del backend `devdata`: `cajero1@minegocio.com` / `123456789`.

### Calidad
```bash
npm run check              # Electron: typecheck + tests (100 % en resolveBackendUrl)
npm --prefix web run check # POS: typecheck + tests (umbral 85 % en runtime/backend-proxy)
```

## 🎮 Cómo usar el POS en Electron

El flujo de ventas es idéntico al web:

1. **Ingresar código** del producto con el teclado numérico
2. **Enter** para confirmar
3. **Ingresar cantidad** (default: 1)
4. **Enter** para agregar al carrito
5. Repetir para más productos
6. Finalizar venta con los atajos configurados

Las teclas alfabéticas están bloqueadas — toda la operación es con numpad.

## 📦 Build y distribución

```bash
# El instalador necesita la URL por defecto del backend de Railway (origen, sin path):
export OMERO_DEFAULT_BACKEND_URL=https://omero-backend.up.railway.app

npm run build:mac    # DMG universal (Intel + Apple Silicon)
npm run build:win    # Instalador NSIS x64
```

`build:*` encadena: `build:config` (escribe `resources/build-config.json`) → `fetch:native` (binarios de SQLite para el ABI de
Electron, con checksum) → `build:web` (Next standalone) → `prepare:frontend` (arma `resources/frontend`) → `verify:native` (carga el
binario con el Electron real) → `tsc` → `electron-builder`. No hay JRE ni JAR.

> En un Mac Intel `verify:native` solo puede cargar el binario `darwin-x64`; el `darwin-arm64` (DMG universal) se verifica en un Mac Apple Silicon.

Los artefactos se generan en `release/`:
- **macOS**: `omero-pos.dmg`
- **Windows**: `omero-pos-setup.exe`

CI: el workflow `installer.yml` se dispara con tags `v*.*.*` y requiere la **variable de repositorio**
`OMERO_DEFAULT_BACKEND_URL`.

> **Nota**: Los builds son sin firma de código (unsigned). Son aptos para distribución interna directa. Para distribución pública se requiere Apple notarization y Windows Authenticode — ver sección de code signing más abajo.

## ☁️ Modo web en Railway

Servicio nuevo con **Root Directory = `web/`** (usa `web/Dockerfile` y `web/railway.toml`). Variables:

| Variable | Valor |
|---|---|
| `OMERO_RUNTIME` | `web` |
| `BACKEND_URL` | Origen del `omero-backend` (ej. `https://omero-backend.up.railway.app`) |
| `PORT` | Lo inyecta Railway |

El healthcheck es `/api/_local/health`. Si falta `OMERO_RUNTIME` o `BACKEND_URL` el proceso termina con error (deploy fallido, no silencioso).
No se definen `NEXT_PUBLIC_*`. El backend **no** necesita agregar el dominio del POS a `CORS_ALLOWED_ORIGINS`: el proxy no reenvía `Origin`.

En `omero` (admin) definí `NEXT_PUBLIC_POS_URL` con la URL pública de este servicio para que "Abrir POS" apunte a él.

## 🔧 Variables de entorno

| Variable | Dónde | Descripción | Default |
|---|---|---|---|
| `OMERO_RUNTIME` | Next (`web/`) | `web` \| `desktop`. Obligatoria; Electron la inyecta como `desktop` | — |
| `BACKEND_URL` | Next y Electron | Origen del omero-backend. En desktop es el *override* del default del build | default de build (desktop) |
| `PROXY_TIMEOUT_MS` | Next | Tiempo máximo hasta recibir headers del backend | `30000` |
| `OMERO_DEFAULT_BACKEND_URL` | Build del instalador | Se embebe en `resources/build-config.json` | — (obligatoria) |
| `OMERO_DATA_DIR` | Next (desktop) | Carpeta de las bases SQLite (Electron: `<userData>/catalog-cache`). Dev sin definir: `web/.data`; producción sin definir: sin caché | — |
| `OMERO_SQLITE_BINDING` | Next (desktop) | Ruta al `.node` de Electron (Electron la inyecta empaquetado) | binding por defecto |
| `CATALOG_SYNC_INTERVAL_MS` | Next (desktop) | Refresco de la caché de catálogo | `300000` |
| `OMERO_POS_URL` | Electron (dev) | URL que carga la ventana | `http://localhost:3000/pos` |
| `BETTERSTACK_TOKEN` | Electron | Logs remotos opcionales (también `resources/betterstack.token`) | — |

## ⌨️ Configurar shortcodes

Editar `main/keyboard.ts` y agregar los keycodes deseados al set `SHORTCODE_KEYS`:

```typescript
const SHORTCODE_KEYS = new Set<string>([
  'F1',  // Finalizar venta
  'F2',  // Nueva venta
  // Agregar más según necesidad
])
```

Los keycodes siguen el estándar de la [KeyboardEvent.code API](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code).

## 🔄 Auto-updater

El auto-updater está incluido como stub no funcional. Para activarlo:

1. Configurar un proveedor de publicación en `electron-builder.config.ts` (GitHub Releases, S3, etc.)
2. Configurar certificados de code signing
3. En `main/main.ts`, remover `autoUpdater.logger = null` y agregar UI para notificar al usuario cuando hay una actualización lista

## 🔒 Code signing

| Plataforma | Requerimiento |
|---|---|
| macOS | Apple Developer ID + notarización via `electron-notarize` |
| Windows | Certificado Authenticode (EV recomendado para evitar SmartScreen) |

Para builds internos sin firmar, los usuarios deberán:
- **macOS**: Ctrl+click → Abrir → Confirmar en el diálogo de seguridad
- **Windows**: Hacer click en "Más información" → "Ejecutar de todas formas" en SmartScreen

## 🔗 Repositorios relacionados

| Repo | Descripción |
|---|---|
| [omero](https://github.com/Avesousa/omero) | Admin Next.js (origen del código del POS copiado; `NEXT_PUBLIC_POS_URL` apunta al POS de este repo) |
| [omero-backend](https://github.com/Avesousa/omero-backend) | API REST Java/Spring Boot |

---

🖥️ **Omero Electron** — *El POS en tu escritorio, sin distracciones*
