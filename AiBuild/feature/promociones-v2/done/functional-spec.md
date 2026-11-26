# Functional Spec: Promociones v2 — nueva en 3 pasos, edición con Rendimiento, vigencia y escalones

- **Repos:** omero (pantallas), omero-backend (vigencia, escalones, rendimiento, costos), omero-electron (la caja respeta vigencia y escalones)
- **Programa:** `AiBuild/redisenio-altas-compras.md`
- **Diseño:** canvas, página Altas y edición → «Promoción · nueva (3 pasos)» y «Promoción · editar (productos según el tipo + resumen)».

## Contexto
Hoy la promoción se arma con un `select` de tipos con jerga («Por asociación», «Volumen de asociación»), sin ver cómo queda en el ticket ni cuánto se gana. No hay forma de limitarla a ciertos días u horarios ni de saber si funcionó.

## Tipos (nombres nuevos, mismo modelo)
| Interno | Nombre | Descripción | Ejemplo |
|---|---|---|---|
| ASSOCIATION | **Combo** | Llevando estos productos juntos, cada uno sale más barato. | Pancho + Coca |
| ASSOCIATION_VOLUME | **Combo con cantidades** | Un combo donde cada producto pide una cantidad. | 2 alfajores + 1 café |
| VOLUME | **Por cantidad** | Llevando X o más del mismo producto, precio especial. | 3 Coca a $ 1.200 c/u |
| VOLUME_ASSOCIATION | **Mezclá y llevá** | Llevando X de cualquiera del grupo, precio especial. | 3 alfajores, el que quieras |

## Nueva promoción (3 pasos, mismo esqueleto que la ficha)
Pasos numerados a la izquierda (✓ al completar): **1 Cómo funciona** · **2 Productos y precios** · **3 Cuándo aplica**. Pie: Cancelar/Atrás · «Paso N de 3» · Siguiente; en el último, **Crear y cargar otra** y **Crear promoción**.
1. **Cómo funciona:** 4 tarjetas con nombre, descripción y ejemplo; **Nombre** (sugerido según los productos; así aparece en el ticket).
2. **Productos y precios** — cambia según el tipo:
   - Combo: tabla Producto · Normal · En promo.
   - Combo con cantidades: tabla Producto · Cant. · Normal · En promo.
   - Por cantidad: un producto («Cambiar»), «Llevando [3] o más, cada una a [$ 1.200]» y **«+ Sumar otro escalón»** (por ejemplo «llevando 6, a $ 1.100»).
   - Mezclá y llevá: «Llevando [3] o más entre cualquiera de estos productos:» + tabla Producto · Normal · En promo; consejo para sumar todos los sabores.
   - En todos, «Buscá o escaneá un producto…» y «Cambiar tipo».
3. **Cuándo aplica:** Desde (Hoy) · Hasta (opcional) · Días (opcional, chips Lun…Dom) · Horario (opcional, desde–hasta). Sin fechas: corre siempre mientras esté activa.

**Columna derecha (siempre):**
- **Así queda en el ticket:** líneas con precio normal, la línea de la promo en verde con el descuento y el total.
- **Resumen:** Paga **$ X** en vez de $ Y · Ahorra **$ Z (P %)** · **Tu ganancia** $ G · Sin la promo $ H · Margen M % de la venta. Debajo, una línea de cómo se aplica en la caja.

## Editar promoción
Mismo esqueleto con secciones (no pasos), estado **Activa/Pausada** al lado del nombre, pestañas **Datos · Rendimiento**, pie con **Pausar promo** · Cancelar · **Guardar cambios**.

**Rendimiento** (desde que se activó): veces que se aplicó (y por día), vendido con la promo (y ticket promedio), descuento dado (y % del precio normal), y la variación de unidades del producto principal contra el mismo período anterior; gráfico por semana **antes y con la promo**.

## Reglas
- Vigencia: la caja aplica la promo solo dentro de fechas, días y horario (zona del negocio). Fuera de vigencia, la promo no aparece en la caja pero sigue «Activa» en el admin con la leyenda «Fuera de horario» o «Programada».
- Escalones (solo Por cantidad): cada escalón es «desde N unidades, precio P»; la caja aplica el escalón más alto alcanzado a **todas** las unidades.
- Ganancia y margen del resumen se calculan con el costo vigente de cada producto; si algún producto no tiene costo, se muestra «Falta el costo de X» en lugar de la ganancia.
- Promos existentes: sin vigencia (corren siempre) y sin escalones; se ven con los nombres nuevos.

## Criterios de aceptación
- [ ] Nueva promo en 3 pasos con los 4 tipos y su editor propio.
- [ ] Ticket y resumen cambian con el tipo y los precios cargados.
- [ ] Rendimiento muestra datos reales por promo.
- [ ] La caja respeta vigencia (fechas, días, horario) y escalones; promos viejas siguen igual.
- [ ] Pausar y reactivar desde la edición.

## Paso a paso para el usuario (guía `promociones`)
1. Elegí cómo funciona la promo.
2. Sumá los productos y poné el precio en promo.
3. Mirá en el ticket cuánto ahorra el cliente y cuánto ganás.
4. Si querés, limitala a ciertos días u horarios.
5. Creala y, en unas semanas, mirá en Rendimiento si funcionó.
