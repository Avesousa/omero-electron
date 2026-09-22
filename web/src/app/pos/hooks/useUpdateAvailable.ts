import { useEffect, useState } from 'react'

/**
 * Escucha 'omero:update-available' desde Electron (autoUpdater en modo "solo avisar" — sin firma
 * de código no instalamos nada en silencio, ver omero-electron/main/main.ts). En modo web
 * `window.electronAPI` no existe: el hook queda inerte (info null).
 */

export interface UpdateAvailableInfo {
  version: string
  url: string
}

interface ElectronAPI {
  isElectron?: boolean
  onUpdateAvailable?: (callback: (info: UpdateAvailableInfo) => void) => () => void
}

function getElectronAPI(): ElectronAPI | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
}

export function useUpdateAvailable(): UpdateAvailableInfo | null {
  const [info, setInfo] = useState<UpdateAvailableInfo | null>(null)

  useEffect(() => {
    const api = getElectronAPI()
    if (!api?.onUpdateAvailable) return
    return api.onUpdateAvailable(setInfo)
  }, [])

  return info
}
