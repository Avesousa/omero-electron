import { SYSTEL } from './profiles/systel'
import type { ScaleBrandId, ScaleProfile } from './types'

/** Marcas disponibles. Para sumar una: su archivo en `profiles/` y una línea acá. */
export const SCALE_PROFILES: Record<ScaleBrandId, ScaleProfile> = {
  SYSTEL,
}

export const DEFAULT_SCALE_BRAND: ScaleBrandId = 'SYSTEL'

/** Perfil de una marca; `null` si no hay perfil para ese nombre (la plantilla sigue funcionando igual). */
export function getScaleProfile(brand: string | null | undefined): ScaleProfile | null {
  const key = (brand ?? '').trim().toUpperCase()
  return (SCALE_PROFILES as Record<string, ScaleProfile>)[key] ?? null
}
