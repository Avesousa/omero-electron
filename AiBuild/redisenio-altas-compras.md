# Programa: rediseño de altas, ediciones y compras

**Diseño aprobado:** canvas «Omero — Modales de alta» → https://claude.ai/artifact/STxp7XLM8ie2adNRFfaxMq
- Página **Altas y edición**: producto (alta rápida, ficha, celular), promoción (nueva y editar), categoría.
- Página **Compras**: lista con detalle, nueva compra (desktop, pantalla chica y celular), compra registrada.
- La idea del botón global «Ir a…» queda en el canvas como **idea a futuro**: no entra en este programa.

**Rama de specs:** `feature/redisenio-altas-compras` (omero, omero-backend, omero-electron). Cada feature se construye en su propia rama desde `develop` con `sdd-plan` → `sdd-build` sobre `AiBuild/feature/<feature>`.

## Contrato de todo modal o pantalla de alta (vale para todo lo nuevo)

1. **Dos velocidades.** Alta rápida (una columna, lo justo para usar el objeto) y ficha completa (secciones a la izquierda, contenido al centro, resumen a la derecha). En el alta, lo que no siempre se usa va en **bloques plegables** con un resumen en una línea cuando están cerrados.
2. **Encabezado:** título y una línea de para qué sirve. Cerrar arriba a la derecha. En la ficha, el nombre se edita tocándolo.
3. **Pie fijo:** Cancelar · «Crear y cargar otro» (solo en altas) · acción principal con el nombre del objeto. Cada botón muestra su atajo en el mismo botón (`Enter`, `⇧ Enter`). Nunca texto de atajos suelto en el pie.
4. **Opcional se marca «· opcional»**, sin asteriscos.
5. **Lo dependiente se crea en el lugar** (categoría desde el selector, producto nuevo desde la compra). Nunca un modal encima de otro.
6. **Selecciones cortas:** control segmentado, tarjetas con ejemplo o interruptor. Nunca un `select` con jerga.
7. **Cálculos y explicaciones largas van en un tooltip ⓘ**, no en texto fijo debajo del campo.
8. **Errores** al lado del campo y resumidos en el pie con «Ir».
9. **Elegir negocio:** 1 negocio → no se muestra; 2 o 3 → botones; 4 o más → buscador con «Usados hace poco». Siempre viene elegido el negocio que se está filtrando.
10. **Celular:** pantalla completa, botones grandes abajo; los resúmenes que no entran van en un pie con «Ver resumen».
11. **Pantallas que no entran:** el resumen lateral baja a un pie fijo con «Ver resumen» que se despliega en **una fila** de datos.
12. **Borrador automático** como hoy (`useDraft`).
13. **Letra:** cuerpo 13–14 px, aclaraciones 11–12 px; tablas con encabezados de 10–11 px en mayúsculas.

## Features y orden de PRs

| # | Feature | Repos | Depende de |
|---|---|---|---|
| 1 | `ui-kit-altas` — componentes base y contrato | omero | — |
| 2 | `etiquetas-producto` — etiqueta por producto y etiquetas pendientes | omero-backend → omero | 1 |
| 3 | `producto-alta-rapida` — nuevo producto | omero | 1 |
| 4 | `producto-ficha` — editar producto (secciones según tipo, Ventas, Historial, Etiqueta) | omero | 1, 2 |
| 5 | `categoria-alta` — categoría con buscador de negocio y márgenes sugeridos | omero | 1 |
| 6 | `compras-v2` — lista con detalle, nueva compra, compra registrada, celular | omero-backend → omero | 1, 2 |
| 7 | `promociones-v2` — nueva (3 pasos) y editar (secciones, Rendimiento), vigencia y escalones | omero-backend → omero-electron → omero | 1 |

Las features 3, 4 y 5 se pueden construir en paralelo una vez mergeado el kit (1).

## Migraciones (omero-backend)

No se reservan números. Cada feature toma **el siguiente libre al crear la migración** (develop hoy llega a V47; el programa de comunicaciones también va tomando números). Las dos migraciones de este programa:
- `etiquetas-producto`: tabla `product_label`.
- `promociones-v2`: columnas de vigencia en `promotions`.

## Permisos

No hay permisos nuevos. Se reutilizan: `PRODUCTOS_VER/CREAR/EDITAR`, `PRODUCTOS_HISTORIAL_VER`, `PROMOCIONES_*`, `CATEGORIAS_*`, `COMPRAS_VER/CREAR`, `ETIQUETAS_*` si existe (si no, `PRODUCTOS_VER` para ver y `PRODUCTOS_EDITAR` para guardar la etiqueta). Confirmar los códigos exactos contra `Permission.java` al construir.

## Guías y eventos (obligatorio por CLAUDE.md)

- Cada pantalla nueva o cambiada actualiza su guía (`src/guides/` o `docs/guias/`) y sube `version` con `changes`.
- Eventos al catálogo del motor: `purchase.created` ya existe o se agrega con `labelsPending`; `labels.printed`; `promotion.created`. Ver cada spec.

## Preguntas abiertas (decisiones del producto, ya tomadas salvo donde se indica)

- **Vigencia de promociones (fechas, días, horario) y escalones**: se diseñaron y entran en `promociones-v2` como fase 2 de esa feature; requieren cambios en el motor de promociones del POS.
- **«Repetir compra» y «Sumar lo de la última vez»**: entran en `compras-v2`, se resuelven en el front con los endpoints existentes.
- **Sugerencia de elaboración en la compra**: entra en `compras-v2` con un endpoint chico nuevo.
