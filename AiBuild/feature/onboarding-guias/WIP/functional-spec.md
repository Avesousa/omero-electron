# Functional Spec: Onboarding in-app — asistente, Primeros pasos y guías por herramienta

## Metadata
- **Date:** 2026-11-22
- **Branch:** feature/comunicaciones-onboarding-metricas
- **Type:** feature
- **Repos:** omero (admin: framework de guías, asistente, checklist), omero-electron (guías del POS), omero-backend (progreso, checklist, datos del alta), omero-landing (`registro-onboarding`: campos del alta)
- **Status:** WIP

## Summary
Que un negocio recién registrado entienda qué tiene que hacer para empezar a vender y lo haga en sus primeras horas: un **asistente** corto al primer ingreso, una lista **Primeros pasos** con avance, y una **guía visual por herramienta** que explica para qué sirve y muestra el paso a paso sobre la pantalla real la primera vez que el usuario entra. Cuando una herramienta cambia, el usuario ve solo lo nuevo.

## Detailed description

### 1. Datos del alta (vienen del registro)
Rubro (Kiosco/almacén, Ropa y calzado, Verdulería/carnicería/fiambrería, Gastronomía/rotisería, Otro), teléfono, opt-in de WhatsApp y de novedades, origen del alta. El rubro personaliza el asistente, el orden del checklist y qué guías se destacan.

### 2. Asistente del primer ingreso (máx. 3 pantallas, se puede saltear)
1. **Tu negocio**: confirmar nombre y rubro; dirección y logo opcionales.
2. **¿Cómo cobrás?**: tildar efectivo, débito, crédito, transferencia, QR de Mercado Pago (si tilda MP, queda como paso pendiente "Conectá Mercado Pago").
3. **Tus productos**: cargar a mano, subir CSV o empezar con la plantilla del rubro (lista de productos típicos sin precios para completar).
Al terminar o saltear, va a Inicio con el checklist. No vuelve a aparecer (se puede reabrir desde Ayuda).

### 3. Primeros pasos (en Inicio, persistente, con % de avance)
| # | Paso | Se completa con | Guía | Obligatorio |
|---|---|---|---|---|
| 1 | Confirmá tu email | `auth.email_verified` | — | Sí |
| 2 | Cargá tus productos (5 o más) | 5 × `product.created` o `bulk_upload.completed` | `productos` | Sí |
| 3 | Configurá cómo cobrás | `payment_method.configured` | `config-medios-pago` | Sí |
| 4 | Abrí la caja (instalá o usá el POS) | `device.linked` o primer login en POS web | `pos-instalacion` | Sí |
| 5 | Hacé tu primera venta | `sale.first_created` | `pos-venta` | Sí |
| 6 | Sumá a tu equipo | `user.invited` | `config-usuarios` | No |
| 7 | Registrá tu primera compra | `purchase.first_created` | `compras` | No |
- Al 100 % de los obligatorios: celebración ("¡Ya estás vendiendo con Omero!") y el checklist se colapsa a un botón "Ver primeros pasos".
- Lo ve el dueño y quien tenga permisos de configuración; los cajeros no.
- El estado vive en el servidor: se ve igual en cualquier dispositivo.

### 4. Guías por herramienta
- **Primera visita** a una herramienta: tarjeta lateral no bloqueante con **para qué sirve** (una frase), una animación corta (5–10 s) y "Ver paso a paso (1 min)" / "Ahora no".
- **Paso a paso**: resalta los elementos reales de la pantalla en orden (spotlight + globo), "Siguiente / Anterior / Salir", barra de progreso. Pasos interactivos opcionales (esperar a que el usuario haga la acción).
- **Estado vacío que enseña**: si la herramienta no tiene datos, en lugar de una tabla vacía muestra qué es, para qué sirve y el botón para crear el primero.
- **Botón "?"** en el encabezado de cada herramienta para repetir la guía; **Ayuda** con buscador de todas las guías.
- **Qué cambió**: si la herramienta cambió desde la última vez que el usuario vio su guía, ve una mini-guía solo con los pasos nuevos.
- **Deep link** `?guia=<id>`: abre la guía directamente (lo usan emails y avisos).
- **POS**: guías pensadas por teclado (tecla I abre caja, TAB cierra, 000 precio libre); **nunca** se disparan con una venta en curso; se ofrecen al abrir la caja o desde "?".
- Respeta permisos: no se ofrece la guía de una herramienta que el usuario no puede ver.

### 5. Guías iniciales
| Prioridad | Guías |
|---|---|
| P1 (activación) | `pos-venta`, `pos-cobro-mp-qr`, `productos`, `config-medios-pago`, `pos-instalacion`, `suscripcion` |
| P2 (diaria) | `caja-apertura-cierre`, `compras`, `proveedores`, `gastos`, `ventas-historial`, `ventas-revisar`, `clientes-fiado`, `pos-precio-libre`, `pos-offline` |
| P3 (avanzadas) | `categorias-margenes`, `promociones`, `mercadopago-movimientos`, `elaboraciones`, `mermas`, `consumibles`, `balanza-peso`, `config-usuarios-roles`, `dashboard` |

Este PR entrega el framework + P1. P2 y P3 se suman en PRs siguientes (y toda feature nueva trae la suya, regla de los CLAUDE.md).

## Main flows
### Flujo 1: Primer ingreso
Login → no completó asistente → asistente (3 pasos o saltear) → Inicio con checklist → clic en un paso → herramienta con `?guia=` → guía.
### Flujo 2: Primera visita a una herramienta
Entra a Compras → nunca vio `compras` v2 → tarjeta "¿Para qué sirve?" → "Ver paso a paso" → recorre → `guide.completed` → no vuelve a ofrecerse.
### Flujo 3: Herramienta actualizada
Compras pasa a v3 con `changes[3]` → usuario que completó v2 entra → aviso "Novedad en Compras" → mini-guía de los pasos nuevos.
### Flujo 4: Email → guía
Email de bienvenida "Cargá tus productos — Ver cómo" → `/admin/products?guia=productos` (login si hace falta) → guía abierta.

## Edge cases
- Usuario que ya usaba Omero antes de esta feature (cliente actual): **no** ve asistente ni checklist (se marcan completos por backfill) y las guías se ofrecen solo desde "?" y en "Qué cambió".
- Elemento de la guía que no está en pantalla (permiso, pantalla chica): el paso se saltea; si faltan todos, la guía no se ofrece.
- Pantalla de celular: la guía usa globos a lo ancho abajo; si el elemento no entra, se scrollea hasta él.
- El usuario cierra la pestaña a mitad de la guía: queda `STARTED`; la próxima vez se ofrece "Seguir donde dejaste".
- "Ahora no" 2 veces → la guía no se ofrece más automáticamente (solo "?").

## Acceptance criteria
- [ ] Un alta nueva ve el asistente una sola vez y luego el checklist con su avance real.
- [ ] Cada paso del checklist se tilda solo cuando ocurre el evento correspondiente, en cualquier dispositivo.
- [ ] La primera visita a cada herramienta P1 ofrece su guía; completada, no se vuelve a ofrecer.
- [ ] Subir la versión de una guía con `changes` muestra "Qué cambió" solo a quienes vieron la versión anterior.
- [ ] `?guia=<id>` abre la guía.
- [ ] En el POS ninguna guía aparece con una venta en curso.
- [ ] Los clientes existentes no ven el asistente ni el checklist.
- [ ] Se registran `tool.opened`, `guide.started/completed/dismissed` para métricas.

## Out of scope
- Videos largos/tutoriales (van a la serie de videos de marketing).
- Plantillas de productos por rubro con precios (v1 sin precios).
- Guías P2/P3 (PRs siguientes).

## Constraints
- Texto en español rioplatense con voseo, imperativo, sin jerga.
- La librería de guías se carga solo cuando hace falta (lazy) para no sumar peso al primer render del POS.
