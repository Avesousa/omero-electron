/** Escalón de una promo VOLUME: el mismo producto repetido con distinto `minQuantity` y precio decreciente. */
export interface Tier {
  minQuantity: number
  promotionalPrice: number
}

/** El escalón más alto con `minQuantity <= quantity` (rige para todas las unidades); null si no alcanza el primero. */
export function pickTier<T extends Tier>(tiers: T[], quantity: number): T | null {
  let best: T | null = null
  for (const t of tiers) {
    if (t.minQuantity <= quantity && (!best || t.minQuantity > best.minQuantity)) best = t
  }
  return best
}
