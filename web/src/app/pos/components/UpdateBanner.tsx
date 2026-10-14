import { useState } from 'react'
import type { UpdateAvailableInfo } from '../hooks/useUpdateAvailable'

interface Props {
  update: UpdateAvailableInfo | null
}

/**
 * Aviso del header en DESKTOP cuando hay una versión nueva (ver useUpdateAvailable). Sin firma de
 * código no hay auto-instalación: el link abre la página del Release en GitHub para que el cajero
 * (o quien lo asista) baje el instalador nuevo a mano. Se puede cerrar; vuelve a aparecer si se
 * reinicia la app y la versión instalada sigue siendo vieja.
 */
export function UpdateBanner({ update }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (!update || dismissed) return null

  return (
    <div className="pos-chip is-mp" data-testid="update-banner">
      <a
        href={update.url}
        target="_blank"
        rel="noopener noreferrer"
        title="Abrir la página de descarga en GitHub"
        className="pos-btn is-mp !px-3 !py-1 !text-sm !rounded-full hover:brightness-105"
      >
        Nueva versión {update.version} disponible — descargala
      </a>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        title="Ocultar aviso"
        aria-label="Ocultar aviso de nueva versión"
        className="text-[var(--pos-muted)] hover:text-[var(--pos-ink)] text-sm px-1 cursor-pointer"
      >
        ✕
      </button>
    </div>
  )
}
