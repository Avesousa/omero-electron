# Technical Spec (omero-electron): la caja respeta vigencia y escalones

**Rama:** `feature/promociones-v2` desde `develop`. Desplegar después del backend y **antes** de habilitar la carga en el admin.

## Motor (`web/src/app/pos/hooks/usePromotions.ts`)
1. **Vigencia:** extraer `isPromotionActiveNow(promo, now, timeZone)` (puro, en `web/src/lib/promotions/schedule.ts`): fechas (`startsAt`/`endsAt`), día (`days`, 1 = lunes, en la zona del negocio de `tenantTime`) y horario (`timeFrom`/`timeTo`). Promos sin esos campos → activas como hoy. Se evalúa al calcular el carrito (no se cachea por día).
2. **Escalones (VOLUME):** agrupar las filas del mismo producto; elegir la de mayor `minQuantity` alcanzada y aplicar su precio a todas las unidades. Hoy el bucle de VOLUME (línea ~109) aplicaría cada fila: cubrirlo con el agrupamiento.
3. Mismos casos que backend y admin: `web/src/lib/__fixtures__/promo-cases.json`; tests en `web/src/lib/promotions/*.test.ts` y `usePromotions.test.ts` (vigencia por zona, borde de horario, escalones 3/6, promos viejas sin cambios).

## Caché offline
El catálogo cacheado de promociones guarda el JSON crudo: los campos nuevos viajan solos. Sin cambios en SQLite.

## Allowlist
Sin rutas nuevas para la caja.
