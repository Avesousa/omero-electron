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
    {
      from: 'resources/jre',
      to: 'jre',
      filter: ['**/*'],
    },
    {
      from: 'resources/backend',
      to: 'backend',
      filter: ['*.jar'],
    },
    {
      from: 'resources/frontend',
      to: 'frontend',
      filter: ['**/*'],
    },
    // Optional: bundled Better Stack token for production builds.
    // Create resources/betterstack.token locally or in CI before building.
    // This file is .gitignored — never commit the token.
    {
      from: 'resources',
      to: '.',
      filter: ['betterstack.token'],
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
