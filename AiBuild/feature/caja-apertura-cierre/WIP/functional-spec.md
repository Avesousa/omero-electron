# Spec funcional: Apertura y cierre de caja

## Metadata
- **Tipo:** feature
- **Rama:** `feature/caja-apertura-cierre` (en `omero-backend`, `omero` y `omero-electron`)
- **Worktrees:** `omeroShop/.wt/caja-backend`, `.wt/caja-admin`, `.wt/caja-pos` (desde `origin/develop`)
- **Tests requeridos:** sí
- **Fecha:** 2026-11-22
- **Estado:** WIP

## Resumen
El POS pasa a trabajar por **cajas**: una caja se abre (tecla `I` o automáticamente con la primera venta), acumula todo lo que pasa (ventas, gastos, compras, cobros de crédito) y se cierra con un asistente paso a paso que registra el conteo de efectivo, los gastos y compras pagados con plata de la caja, los retiros ("Casa" y apartados por negocio/categoría) y lo que queda para la próxima caja. Cada cierre genera un **asiento contable** con la fecha del cierre; los asientos del mismo día se suman. Cualquier diferencia entre lo esperado y lo contado queda registrada como **sobrante o faltante**.

## Contexto del proyecto
- `omero-backend` (Spring Boot 3.4 / Java 21, PostgreSQL + Flyway, multi-tenant con `@TenantId`).
- `omero-electron/web` = POS (Next.js), modo escritorio (outbox SQLite, sesión de dispositivo) y modo web (navegador).
- `omero` = admin (Next.js): dashboard, compras, configuración, cajas.
- Hoy el resumen del POS (TAB → `DailySummaryModal`) es **por día calendario y por usuario**, y tiene cableado el negocio "cigarrillo".

## Conceptos y glosario

| Término | Significado |
|---|---|
| **Caja (sesión de caja)** | Período entre una apertura y un cierre, de **un usuario en un dispositivo**. Puede durar horas o varios días. |
| **Fondo inicial** | Efectivo con el que arranca la caja. Es el **restante** del último cierre de ese dispositivo/usuario (o 0 si no hay). |
| **Corte** | Momento en que se inicia el cierre. Lo que se vende después ya va a una caja nueva. |
| **Efectivo esperado** | Lo que el sistema calcula que debería haber en el cajón al momento del corte. |
| **Efectivo contado** | Lo que el cajero cuenta físicamente ("dinero en caja completo"). |
| **Retiro** | Plata que sale de la caja al cerrar: **Casa** (nombre editable) y **apartados** configurables. |
| **Apartado** | Retiro asociado a un negocio o categoría, con un monto sugerido según una regla (venta total, costo o % de la venta). |
| **Restante** | Efectivo que queda en el cajón para la próxima caja. |
| **Asiento** | Registro contable de un cierre. Se agrupa por **día contable = fecha del cierre**. |
| **Diferencia** | Contado − esperado. Positivo = sobrante, negativo = faltante. |

## Reglas de negocio

### R1. Alcance de una caja
- Una caja pertenece a **tenant + dispositivo + usuario**. El mismo usuario puede tener cajas abiertas en dos dispositivos distintos (cada una con su asiento).
- En escritorio, el dispositivo es la caja registrada (`devices`). En el POS web (navegador), el dispositivo es una **terminal web** identificada por un id que el navegador guarda; se ve en el admin como "Terminal web" con nombre editable.
- Toda venta, gasto, cobro de crédito y compra pagada con caja queda **asociada a la caja** en la que ocurrió.

### R2. Apertura
- Tecla **`I` = Iniciar caja**: muestra el aviso "Caja iniciada" y deja una **marca visible en pantalla** ("Caja abierta · desde 08:12 · Fondo $ 10.000,00").
- Si no hay caja abierta y se tipea un código o se escanea un código de barras, **la caja se abre sola** y se muestra la notificación "Se inició la caja". La venta sigue sin frenarse.
- El fondo inicial es el **restante del último cierre** de ese dispositivo + usuario. Si ese cierre todavía está pendiente, el fondo queda "a definir" y se completa al confirmar el cierre pendiente.
- Con `I` el cajero puede **confirmar o corregir** el fondo inicial; en la apertura automática se toma sin preguntar.

### R3. Estados de una caja
`ABIERTA` → `EN_CIERRE` → `CERRADA`.
- **ABIERTA:** entran ventas, gastos, cobros.
- **EN_CIERRE:** al tocar "Finalizar caja" se hace el **corte**. Las ventas posteriores van a una caja nueva (se abre sola). El formulario de cierre queda como **borrador guardado en el POS** y se puede retomar en cualquier momento, aun sin conexión.
- **CERRADA:** confirmada; generó su asiento. Solo se modifica desde el admin con permiso de corrección (queda auditado).
- **Regla de bloqueo:** por dispositivo + usuario puede haber **un solo cierre pendiente**. Mientras exista, la caja nueva se puede usar para vender pero **no se puede pasar a cierre** hasta confirmar el anterior. El POS lo explica: "Primero terminá el cierre de la caja del 21/11 08:12".

### R4. Cierre (asistente paso a paso desde TAB)
TAB abre el resumen **de la caja actual** (no del día) con el botón **"Finalizar caja"**. El asistente:

1. **Resumen del sistema** (solo lectura): ventas por medio de pago, cobros de crédito, gastos y compras ya registrados en la caja, fondo inicial y, si el negocio lo permite, el **efectivo esperado**.
2. **Efectivo contado:** el cajero ingresa el total que hay en el cajón en ese momento. **Es el único medio de pago que se carga a mano**; MP y el resto salen del sistema.
3. **Gastos al cierre:** gastos pagados en este momento con plata de la caja (efectivo) y gastos pagados con MP u otro medio (si existen). Los gastos cargados durante el día (tecla `.`) aparecen precargados y no se vuelven a pedir.
4. **Compras con plata de la caja:** monto y descripción. Opcionalmente se vincula a una compra ya registrada; si la compra todavía no existe, queda **pendiente de vincular** (ver R8).
5. **Retiros:**
   - **Casa** (nombre configurable): monto libre.
   - **Apartados** configurados: cada uno muestra el **monto sugerido** según su regla y el cajero carga el **monto real** que separa (puede ser distinto).
6. **Restante:** lo calcula el sistema = contado − gastos al cierre en efectivo − compras al cierre − retiros. El cajero lo ve y puede ajustar los retiros. Si queda negativo, no se puede confirmar.
7. **Confirmación:** muestra el asiento resultante y la **diferencia** (sobrante/faltante).
   - Si el **control de diferencias** está activo y el faltante o el sobrante supera su umbral, aparece la pantalla "Hay una diferencia de $ X": el cajero **confirma que está ok** (con un comentario opcional) y el cierre queda **pendiente de revisión** en el admin.
   - Si el control de diferencias no está configurado o está apagado, **esa pantalla no aparece**: la diferencia igual queda registrada en el asiento, pero no genera revisión.

### R5. Esquema de cálculo (arqueo estándar)

```
Salidas previas     = gastos en efectivo + compras con caja registrados DURANTE la caja
Efectivo esperado   = fondo inicial
                    + ventas en efectivo
                    + cobros de crédito en efectivo
                    − salidas previas
Efectivo contado    = lo que cuenta el cajero ("dinero en caja completo")
Diferencia          = contado − esperado            (+ sobrante / − faltante)

Distribución del contado:
contado = gastos al cierre (efectivo) + compras al cierre + retiros (Casa + apartados) + restante
```

Así se reconcilian las dos fórmulas que planteaste:
- "**Dinero en caja completo** = gastos + negocio/categoría + casa + restante" → es la **distribución del contado**.
- "**Venta** = (caja + MP + gastos + compras) − restante anterior" → es el despeje de la venta: venta en efectivo calculada = contado + salidas previas − fondo inicial − cobros de crédito; sumándole MP y otros medios da la venta total. La venta del **sistema** se compara contra esa venta calculada y la diferencia es el sobrante/faltante.

**Ejemplo:** fondo $10.000 · ventas efectivo $50.000 · MP $30.000 · cobro de crédito en efectivo $2.000 · gasto previo en efectivo $5.000.
- Esperado = 10.000 + 50.000 + 2.000 − 5.000 = **$57.000**. Contado = **$56.500** → **faltante $500**.
- Distribución: gasto al cierre 1.500 + compra al cierre 4.000 + apartado Cigarrillos 20.000 + Casa 21.000 + restante 10.000 = 56.500 ✓.

### R6. Asiento contable
Por cada cierre se guarda, con las ventas y los gastos **abiertos por grupo de medio de pago**:

| Grupo | Ventas | Gastos |
|---|---|---|
| **Efectivo** | Venta en efectivo | Gasto en efectivo |
| **Transferencia** (Mercado Pago) | Venta por transferencia/MP | Gasto pagado por transferencia/MP |
| **Crédito** (fiado) | Venta a crédito | Gasto a crédito (si existiera) |
| **Otros** | Suma de todos los demás medios (personalizados) | Suma de gastos con los demás medios |

Columnas del asiento:

| Venta total | Venta efectivo | Venta transferencia | Venta crédito | Venta otros | Gasto efectivo | Gasto transferencia | Gasto crédito | Gasto otros | Compras con caja | Retiros (Casa + cada apartado por separado) | Restante | Fondo inicial | Cobros de crédito | Sobrante/Faltante |

- El detalle por cada medio de pago (por ejemplo, cada medio personalizado dentro de "Otros") se guarda igual y se ve al expandir la fila.

**Identidad que debe cerrar siempre** (los medios que no son efectivo aparecen de los dos lados, por eso el efectivo es el único que se arquea):
```
Fondo inicial + Venta total + Cobros de crédito + Diferencia
  = Ventas no efectivo (MP + otros + fiado) + Gastos en efectivo + Compras en efectivo + Retiros + Restante
```
Ejemplo: 10.000 + 80.000 + 2.000 − 500 = 30.000 + 6.500 + 4.000 + 41.000 + 10.000 = **91.500** ✓.
- Los **gastos pagados con MP** u otro medio se registran en la columna de gastos (separados), pero no entran en el arqueo de efectivo.
- La venta a crédito (fiado) cuenta como venta pero no como dinero; su cobro posterior en efectivo sí entra a la caja que lo cobra.

### R7. Día contable y agregación
- **El asiento se registra en la fecha del cierre** (zona horaria del negocio). Las ventas conservan su fecha real; el dashboard sigue usando la fecha de la venta.
- Varios cierres del mismo día **se suman** en el asiento del día.
- **Restante:** en la vista por caja, por usuario o por dispositivo se muestra (el del último cierre del día). En la vista **general no se muestra** (sumar restantes de cierres encadenados contaría la plata dos veces).
- Vistas del asiento diario: **general** (todo el tenant), **por dispositivo**, **por usuario**, **por caja**.

### R8. Compras con plata de la caja
- Toda compra pasa a tener **origen del dinero**: "Caja" (con la caja asociada) u "Otro origen".
- Una compra cargada en el cierre que todavía no está registrada en el módulo de compras genera una **alerta en Compras**: "Hay $4.000 usados de la caja del 21/11 para compras sin registrar".
- Al registrar la compra en el admin se elige "Pagada con dinero de caja" y se **referencia** ese monto disponible (se puede usar total o parcialmente; el saldo sigue disponible).

### R9. Apartados (configurables)
- En Configuración → Caja se definen los apartados: **nombre**, **alcance** (un negocio o una categoría), **base de cálculo** (precio de venta total · costo · % del precio de venta) y si se **muestra en el resumen** de TAB.
- Reemplaza el cableado actual de "cigarrillo": el resumen muestra los negocios/categorías que el negocio elija.
- Cada apartado se registra **por separado** en el asiento.
- **Casa** es un retiro por defecto con nombre configurable.

### R10. Configuración por negocio
| Clave | Default | Descripción |
|---|---|---|
| Control de caja activado | No | Activa todo el flujo. Apagado, el POS funciona como hoy. |
| Mostrar efectivo esperado al cajero | Sí | Si se apaga, el cierre es **a ciegas** (el cajero no ve el esperado antes de contar). |
| Control de diferencias activado | No | Si está apagado (o sin configurar), el cierre no muestra la pantalla de confirmación de diferencia ni genera revisión. |
| Umbral de faltante (−) | vacío | Un faltante **mayor** a este monto pide confirmación del cajero y queda pendiente de revisión. Vacío = no se controla el faltante. $0 = cualquier faltante. |
| Umbral de sobrante (+) | vacío | Lo mismo para el sobrante. Así cada negocio decide si le preocupa solo faltar, solo sobrar o las dos cosas. |
| Aviso de caja abierta hace más de | 24 h | Solo aviso, no bloquea. |
| Nombre del retiro "Casa" | Casa | Editable. |

### R11. Activación en un negocio con historia (compatibilidad)
- Con el control **apagado** nada cambia (cliente actual en master incluido).
- Al **activarlo**, el historial anterior se ordena en **cajas diarias automáticas** (00:00–24:00, zona del negocio) por usuario, marcadas como "Caja automática (histórico)", **cerradas sin arqueo** (sin conteo ni diferencia). Así la tabla de asientos y los filtros por caja muestran también el pasado.
- Después de activarlo, si llega una venta sin caja (POS viejo sin actualizar), el backend la asigna a una caja automática diaria de ese usuario; queda visible para que el admin la cierre o corrija.

**Desactivar después de haberlo usado:**
- **Los datos no se tocan:** las cajas, cierres y asientos quedan guardados y siguen visibles en Caja → Asientos como **historial** (solo lectura, salvo correcciones del admin).
- **El POS vuelve a funcionar como antes:** sin tecla `I`, sin apertura automática, TAB vuelve al resumen del día y las ventas nuevas no se asocian a ninguna caja.
- Las cajas que estaban **abiertas o con cierre pendiente** al desactivar quedan así; el admin las ve marcadas "Control desactivado" y puede cerrarlas desde ahí. El POS no las vuelve a pedir.
- **Dashboard y reportes no cambian** con el control prendido o apagado: siempre trabajan con la fecha real de la venta. El filtro por caja solo muestra lo que tenga caja.
- **Si se vuelve a activar:** los días sin caja del período en que estuvo apagado se completan con cajas diarias automáticas (como en la primera activación) y desde ahí sigue el flujo normal. El fondo inicial de la primera caja nueva es el restante del último cierre de ese dispositivo/usuario (se puede corregir con `I`).

### R12. Revisión de diferencias en el admin
- Los cierres que superaron un umbral quedan en **Caja → Cierres a revisar** (con contador en el menú, como "Ventas a revisar"), mostrando la diferencia y el comentario del cajero.
- El admin los cierra con **"Confirmar revisión"** + **observación** (obligatoria). Queda quién y cuándo. La revisión no cambia montos; si hay que cambiarlos se usa "Corregir" (R13).

### R13. Correcciones desde el admin
- Un cierre se puede **corregir** desde el admin (montos del conteo, retiros, gastos/compras al cierre, motivo). Se guarda **quién, cuándo y qué cambió** y el asiento se recalcula.
- Un cierre también se puede **cerrar desde el admin** si quedó pendiente (por ejemplo, un dispositivo que no se volvió a usar).

## Flujos principales

### Flujo 1: Apertura manual
1. El cajero presiona `I`.
2. El POS muestra el modal "Iniciar caja" con el fondo inicial propuesto (restante del último cierre). Enter confirma, se puede tipear otro monto.
3. Aparece la notificación "Caja iniciada" y la marca de caja abierta en pantalla.

### Flujo 2: Apertura automática
1. Sin caja abierta, el cajero tipea un código o escanea.
2. La caja se abre con el fondo propuesto; notificación "Se inició la caja"; el producto entra al carrito normalmente.

### Flujo 3: Cierre
1. TAB → resumen de la caja → "Finalizar caja".
2. Corte: la caja pasa a EN_CIERRE y se abre una nueva para seguir vendiendo.
3. Asistente (R4) con navegación por teclado; el borrador se guarda en cada paso.
4. Confirmar → asiento generado → el restante queda como fondo de la caja nueva.

### Flujo 4: Cierre retomado
1. Hay un cierre pendiente; el cajero sigue vendiendo en la caja nueva.
2. TAB muestra un aviso "Cierre pendiente de la caja del 21/11" con acceso directo; el borrador mantiene lo cargado.
3. Intentar cerrar la caja nueva antes → mensaje de bloqueo (R3).

### Flujo 5: Admin — asientos
1. Caja → Asientos: tabla tipo planilla agrupada por día, con selector **General / Por dispositivo / Por usuario / Por caja** y rango de fechas.
2. Columnas de R6; filas expandibles con el detalle por medio de pago y por apartado; exportar a CSV/Excel.
3. Click en un cierre → detalle con todos los movimientos, historial de correcciones y acción "Corregir".

### Flujo 6: Admin — cajas y dispositivos
1. Configuración → Cajas suma, por dispositivo: **caja actual** (id, usuario, abierta desde), **cierres pendientes** y aviso de caja abierta hace más de 24 h.
2. Desde ahí se puede ir al cierre pendiente y cerrarlo/corregirlo.

### Flujo 7: Dashboard y estadísticas
Nuevos filtros: **una caja**, **grupo de cajas**, **todas**; combinables con **un día** o **rango de fechas**. Sin filtro de caja se comporta como hoy (ventas por fecha real).

### Flujo 8: Compras con plata de la caja
1. En el cierre se carga una compra de $4.000 sin vincular.
2. En Compras aparece la alerta con el monto disponible.
3. Al registrar la compra se elige "Pagada con dinero de caja" → se selecciona el monto disponible → queda vinculada y la alerta se descuenta.

## Casos borde
- **Caja abierta más de 24 h:** aviso en POS y admin, no bloquea.
- **Sin conexión:** apertura, ventas, cierre y confirmación funcionan offline (igual que las ventas); se suben por el outbox. El esperado offline se calcula con lo que el POS conoce (ventas pendientes de subir incluidas).
- **Diferencia sobre el umbral:** el cajero confirma (comentario opcional) y el cierre queda pendiente de revisión en el admin. Sin control de diferencias configurado no se pide nada.
- **Control de caja desactivado con cajas abiertas:** quedan en el admin como "Control desactivado" para cerrarlas desde ahí.
- **Restante negativo:** no se puede confirmar.
- **Venta anulada o a revisar:** cuenta en la caja donde se registró.
- **Cambio de usuario en el mismo dispositivo con caja abierta:** la caja es del usuario anterior; el nuevo usuario abre la suya. La del anterior queda abierta y visible en el admin (aviso).
- **Logout con cierre pendiente:** se pregunta antes; el borrador no se pierde.
- **POS desactualizado contra un backend nuevo:** ventas sin caja → caja automática diaria (R11).
- **Correcciones posteriores:** recalculan el asiento; si el restante cambia, el fondo de la caja siguiente se ajusta y queda registrado.

## Criterios de aceptación
- [ ] Dado el control de caja activado y sin caja abierta, cuando el cajero presiona `I`, entonces se abre una caja con el fondo = restante del último cierre y se ve la marca "Caja abierta".
- [ ] Dado sin caja abierta, cuando se escanea un producto, entonces la caja se abre sola, se notifica y el producto entra al carrito.
- [ ] Dada una caja abierta, cuando se presiona TAB, entonces el resumen muestra solo lo de esa caja (aunque dure varios días).
- [ ] Dado un cierre iniciado, cuando se vende, entonces la venta va a una caja nueva.
- [ ] Dado un cierre pendiente, cuando se intenta finalizar la caja nueva, entonces se bloquea con el mensaje de R3.
- [ ] Dado el ejemplo de R5, cuando se confirma el cierre, entonces el asiento registra faltante $500 y la identidad de R6 cierra en $91.500.
- [ ] Dados dos cierres el mismo día, cuando se ve el asiento general, entonces venta/gastos/compras/retiros/diferencia se suman y el restante no se muestra.
- [ ] Dada una compra cargada en el cierre sin registrar, cuando se abre Compras, entonces aparece la alerta con el monto disponible y se puede vincular al registrar la compra.
- [ ] Dado un apartado "Cigarrillos" por % de venta = 100 %, cuando se cierra, entonces el sugerido = ventas de ese negocio en la caja y el cajero puede cargar otro monto.
- [ ] Dado el control de diferencias activo con umbral de faltante $1.000 y sin umbral de sobrante, cuando el cierre da faltante $1.500, entonces el cajero confirma y el cierre queda pendiente de revisión; con sobrante $5.000 no se pide nada.
- [ ] Dado el control de diferencias apagado, cuando hay diferencia, entonces no aparece la pantalla de confirmación y el asiento igual registra la diferencia.
- [ ] Dado un cierre pendiente de revisión, cuando el admin confirma con observación, entonces sale de la lista y queda quién/cuándo/observación.
- [ ] Dado un asiento, entonces muestra ventas y gastos en columnas Efectivo / Transferencia / Crédito / Otros, y "Otros" suma todos los medios personalizados.
- [ ] Dado el control activado y luego desactivado, entonces las cajas y asientos siguen visibles, el POS vuelve al comportamiento anterior y el dashboard no cambia.
- [ ] Dado "Mostrar efectivo esperado" apagado, cuando se cierra, entonces el cajero no ve el esperado hasta confirmar el conteo.
- [ ] Dado el control apagado, cuando se usa el POS, entonces todo funciona igual que hoy.
- [ ] Dado que se activa el control, cuando se abre la tabla de asientos, entonces el historial aparece en cajas diarias automáticas sin arqueo.
- [ ] Dado un cierre corregido desde el admin, entonces queda la auditoría y el asiento recalculado.
- [ ] Dado sin conexión, cuando se abre, vende y cierra, entonces todo se sube al volver la conexión sin duplicados.

## Fuera de alcance (primera entrega)
- Arqueo por denominación (billetes/monedas).
- Conciliación de saldo real de MP contra el cierre (se usa lo registrado por el sistema; la conciliación MP sigue en su pantalla).
- Exportación a sistemas contables externos / plan de cuentas.
- Impresión de ticket de cierre (se puede sumar después).

## Restricciones
- Compatibilidad total con el cliente actual (flag apagado por defecto; master con H2 local).
- Orden de despliegue: backend → admin → POS.
- El flujo de cierre debe ser 100 % operable con el teclado numérico del POS.

## Decisiones cerradas (2026-11-22)
- Diferencia sobre el umbral: confirma el cajero y el admin revisa después con confirmación + observación (R12).
- Umbrales separados de faltante y sobrante, opcionales, detrás de un switch; sin configurar no hay pantalla de confirmación (R10).
- Asiento en grupos Efectivo / Transferencia / Crédito / Otros para ventas y gastos (R6).
- Desactivar conserva el historial y devuelve el POS al comportamiento anterior (R11).

## Supuestos a validar
- "Transferencia" = el medio de sistema **Mercado Pago**. Si el negocio tiene un medio personalizado llamado "Transferencia", hoy caería en "Otros"; se puede sumar después una opción por medio de pago para elegir su columna.
