# Plan: la caja respeta vigencia y escalones (omero-electron)

1. T1 Copiar `promo-cases.json` del backend a `web/src/lib/__fixtures__/`.
2. T2 `lib/promotions/schedule.ts`: `isPromotionActiveNow(promo, now, timeZone)` puro (Intl, sin dependencias).
3. T3 `lib/promotions/tiers.ts`: `pickTier` (escalón más alto alcanzado).
4. T4 `usePromotions`: filtrar por vigencia en `detectApplicablePromotions` (hora y zona al calcular) y agrupar escalones VOLUME por producto en `applyPromotions`; tipos nuevos (`normalPrice`, `costPrice`, vigencia).
5. T5 Tests: `schedule.test.ts` y `tiers.test.ts` con los casos compartidos; `hooks/__tests__/usePromotions.test.ts` (zona, borde, re-evaluación, escalones 3/6, promo vieja, `schedule` ignorado).
6. T6 Verificar caché offline (JSON crudo, sin cambios) y allowlist (sin rutas nuevas).
7. T7 typecheck + tests de `web/` y raíz; sección en `CLAUDE.md`; archivar a `done/`; commit.
