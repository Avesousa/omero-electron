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
    category: 'public.app-category.business'
  },
  dmg: {
    title: 'Omero POS',
    icon: 'assets/icon.icns'
  },
  // No auto-publish — manual distribution only (unsigned builds for internal use)
  publish: null
}

export default config
