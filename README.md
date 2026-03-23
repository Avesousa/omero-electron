# 🖥️ Omero POS — Electron Desktop App

Wrapper de escritorio para el sistema de punto de venta [Omero](https://github.com/Avesousa/omero). Envuelve la interfaz POS en una ventana Electron sin chrome de browser, con entrada restringida a teclado numérico para uso en terminales de caja dedicadas.

## 🚀 Características

- **Sin chrome de browser** — ventana frameless, sin barra de URL ni menú
- **Entrada restringida a numpad** — solo dígitos, Enter, Backspace, operadores y Escape; teclas alfabéticas bloqueadas a nivel OS
- **Shortcodes configurables** — se agregan en `main/keyboard.ts` sin tocar el frontend
- **Detección automática** — el frontend detecta `window.electronAPI.isElectron` y adapta el hook de teclado
- **Auto-updater preparado** — scaffold de `electron-updater` listo para activar cuando se configure code signing

## 🛠️ Tecnologías

- **Electron** (latest LTS)
- **TypeScript 5**
- **electron-builder** — empaquetado para Windows y macOS
- **electron-updater** — stub de auto-actualización

## 🏗️ Estructura del proyecto

```
omero-electron/
├── main/
│   ├── main.ts           # Main process: BrowserWindow, ciclo de vida de la app
│   ├── keyboard.ts       # Filtro de teclas via before-input-event
│   ├── preload.ts        # contextBridge mínimo (expone isElectron, platform)
│   └── config.ts         # POS_URL — configurable por variable de entorno
├── electron-builder.config.ts   # Targets: Windows NSIS x64, macOS DMG universal
├── package.json
└── tsconfig.json
```

## ⚙️ Requisitos previos

- Node.js 20+
- El servidor Next.js de [omero](https://github.com/Avesousa/omero) corriendo (local o deployed)

## 🚀 Desarrollo

```bash
# Instalar dependencias
npm install

# Compilar TypeScript
npx tsc

# Levantar en modo desarrollo (apunta a http://localhost:3000/pos por defecto)
npm run dev
```

Asegurate de tener el servidor Next.js corriendo en `localhost:3000` antes de ejecutar el app.

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
# Build para macOS (DMG universal — Intel + Apple Silicon)
npm run build:mac

# Build para Windows (instalador NSIS x64)
npm run build:win

# Build para ambas plataformas
npm run build
```

Los artefactos se generan en `release/`:
- **macOS**: `omero-pos.dmg`
- **Windows**: `omero-pos-setup.exe`

> **Nota**: Los builds son sin firma de código (unsigned). Son aptos para distribución interna directa. Para distribución pública se requiere Apple notarization y Windows Authenticode — ver sección de code signing más abajo.

## 🔧 Variables de entorno

| Variable | Descripción | Default |
|---|---|---|
| `OMERO_POS_URL` | URL del servidor Next.js a cargar | `http://localhost:3000/pos` |

Para apuntar a producción:

```bash
OMERO_POS_URL=https://omero.vercel.app/pos npm run dev
```

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
| [omero](https://github.com/Avesousa/omero) | Frontend Next.js (web + fuente del POS) |
| [omero-backend](https://github.com/Avesousa/omero-backend) | API REST Java/Spring Boot |

---

🖥️ **Omero Electron** — *El POS en tu escritorio, sin distracciones*
