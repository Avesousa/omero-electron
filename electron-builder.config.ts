import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.omero.pos',
  productName: 'Omero POS',
  directories: {
    output: 'release',
    buildResources: 'assets'
  },
  files: [
    'dist/**/*',
    'package.json'
  ],
  extraResources: [
    // Next standalone del POS (web/). Se arma con `npm run prepare:frontend`.
    {
      from: 'resources/frontend',
      to: 'frontend',
      filter: ['**/*'],
    },
    // Binarios de better-sqlite3 (ABI de Electron) por plataforma/arquitectura (npm run fetch:native).
    // El runtime elige uno con process.platform/arch (OMERO_SQLITE_BINDING); el DMG universal lleva los dos de macOS.
    {
      from: 'resources/native',
      to: 'native',
      filter: ['*.node'],
    },
    // build-config.json: URL del backend por defecto (npm run build:config).
    // betterstack.token (opcional): token de Better Stack para builds de producción.
    // Créalo local o en CI antes de compilar. Está en .gitignore — nunca lo commitees.
    {
      from: 'resources',
      to: '.',
      filter: ['build-config.json', 'betterstack.token'],
    },
  ],
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    artifactName: 'omero-pos-setup.exe'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    shortcutName: 'Omero POS'
  },
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['universal']
      }
    ],
    artifactName: 'omero-pos.dmg',
    category: 'public.app-category.business',
    // El DMG universal (x64+arm64) falla si encuentra un binario nativo idéntico en ambos árboles sin
    // una regla explícita — pasa con sharp (usa next/image, ver OmeroLogo.tsx): trae .node y .dylib
    // (libvips) solo para x64, así que salen iguales en las dos pasadas. Se permiten ambas extensiones
    // (incluye better-sqlite3 también) para que el merge no falle por esto.
    x64ArchFiles: '**/*.{node,dylib}'
  },
  dmg: {
    title: 'Omero POS',
    icon: 'assets/icon.icns'
  },
  // Provider del feed para electron-updater: SOLO sirve para que `autoUpdater.checkForUpdates()`
  // sepa dónde mirar (queda embebido como app-update.yml dentro del paquete) y para generar
  // latest.yml/latest-mac.yml junto al instalador. No dispara publicación automática: los scripts
  // `build:win`/`build:mac` corren con `--publish never`, así que `electron-builder` NUNCA sube nada
  // a GitHub por su cuenta — el único paso que publica es el Release manual/CI (softprops/action-gh-release).
  publish: {
    provider: 'github',
    owner: 'Avesousa',
    repo: 'omero-electron'
  }
}

export default config
