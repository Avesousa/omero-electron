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
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico'
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
