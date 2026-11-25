# Functional Spec: Motor de avisos centralizado (eventos → reglas → mensajes → canales)

## Metadata
- **Date:** 2026-11-22
- **Branch:** feature/comunicaciones-onboarding-metricas
- **Type:** feature
- **Repos:** omero-backend (núcleo), omero-billing (productor de eventos, ver `ciclo-suscripcion-eventos`), omero (avisos in-app + preferencias), omero-electron (avisos in-app en el POS)
- **Status:** WIP
- **Doc de producto:** proyecto Omero → `claude/comunicaciones-onboarding-funcional.md`

## Summary
Un único motor que recibe **eventos** de negocio ("pago aprobado", "cobro rechazado", "no cargó productos en 24 h"), decide con **reglas** qué mensajes corresponden, los arma con **plantillas** por canal y los **despacha** por el canal adecuado (aviso in-app, email, push, WhatsApp), dejando registro de cada envío. Los canales son adaptadores intercambiables: el motor funciona completo aunque todavía no esté elegido el proveedor de email o de WhatsApp.

## Project context
- Hoy ninguna app manda emails ni avisos. Billing ya maneja el ciclo de la suscripción (TRIALING, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED, EXPIRED) y le avisa al backend por un outbox firmado con HMAC (`EntitlementOutbox` → `PUT /internal/billing/tenants/{id}/entitlement`).
- El backend tiene usuarios, tenants, roles y permisos, Redis y SSE hacia el POS.
- Decisión de costo: el motor vive **dentro de omero-backend** (paquete `com.omero.notifications`), no como un servicio nuevo.

## PRs previstos (orden)
1. **Motor** (este spec): eventos, reglas, plantillas, despacho, avisos in-app, preferencias, canal email/WhatsApp/push con adaptador "log" (no envía, registra).
2. **Conexión email** (`notificaciones-email`): render de plantillas HTML con marca + adaptador SMTP genérico + adaptadores por API.
3. **Conexión WhatsApp** (`notificaciones-whatsapp`).
4. **Primer flujo** (`flujo-cobro-exitoso-bienvenida`): recibo de cobro + bienvenida/onboarding.
5. **Consola Omero** (`consola-omero`): `panel.omero.ar` (dentro de la app omero) para editar plantillas, reglas y ver envíos; v1 solo correo.

## Detailed description

### Conceptos
| Concepto | Qué es |
|---|---|
| **Evento** | Algo que pasó, en pasado: `payment.approved`, `account.created`. Lo emite billing, el backend o un job. Inmutable e idempotente. |
| **Regla** | "Cuando pase el evento X (y se cumpla la condición Y), esperá Z y mandá la plantilla T por los canales C". Varias reglas por evento forman un **journey** (ej. dunning). |
| **Evento cancelador** | Un evento que corta los pasos pendientes de un journey (ej. `payment.approved` corta el dunning). |
| **Plantilla** | Texto de un mensaje para un canal, con variables (`{{negocio}}`, `{{monto}}`). Versionada. |
| **Mensaje** | Un envío concreto a una persona por un canal, con estado (programado, enviado, entregado, abierto, clic, falló, omitido). |
| **Canal** | `IN_APP`, `EMAIL`, `PUSH`, `WHATSAPP`. Cada uno es un adaptador. |
| **Categoría** | Agrupa mensajes por naturaleza y define si el usuario puede desactivarlos. |

### Categorías y preferencias
| Categoría | Ejemplos | ¿El usuario puede apagarla? |
|---|---|---|
| `SEGURIDAD` | verificar email, recuperar contraseña, login nuevo | No |
| `COBROS` | recibo, cobro rechazado, suspensión, baja | No (sí puede sumar canales) |
| `CUENTA` | fin de prueba, vencimientos, cancelación, borrado de datos | No por email/in-app; sí WhatsApp/push |
| `ONBOARDING` | primeros pasos, guías, consejos | Sí |
| `USO` | resumen semanal, inactividad, operativos | Sí |
| `MARKETING` | novedades, promos, win-back | Sí; requiere **opt-in explícito** |

### Reglas fijas del despacho
- **Idempotencia**: un mismo evento nunca genera dos mensajes iguales para la misma persona y canal.
- **Horario silencioso** (America/Argentina/Buenos_Aires): WhatsApp y push solo de 9:00 a 21:00; fuera de horario se reprograman a las 9:00. `SEGURIDAD` no espera. Email e in-app sin restricción.
- **Tope de frecuencia** para `ONBOARDING`, `USO`, `MARKETING`: máximo 1 por día y 3 por semana por usuario (configurable). Lo que excede se omite (`SKIPPED_FREQUENCY`), no se acumula.
- **Escalada por gravedad**: `INFO` → in-app; `IMPORTANTE` → in-app + email; `CRITICO` → in-app + email + WhatsApp (con opt-in) + push.
- **Destinatarios**: avisos de `COBROS`/`CUENTA` **solo a los dueños** del negocio (usuarios con el rol `omero-admin` del tenant, el que recibe quien crea la cuenta); operativos a quienes tienen el permiso de la herramienta; `SEGURIDAD` al usuario afectado.
- **Canal no disponible** (sin email verificado, sin opt-in de WhatsApp, sin suscripción push): ese canal se omite con motivo registrado; nunca bloquea los otros canales.
- **Email sin verificar**: recibe `SEGURIDAD`, `COBROS` y `CUENTA`; no recibe `ONBOARDING`/`USO`/`MARKETING` hasta verificar.

### Avisos in-app
- **Banner** fijo arriba del admin y del POS: cobros y cuenta. No se puede cerrar mientras la situación siga (ej. PAST_DUE); los informativos sí.
- **Bandeja** (campanita con contador) en el admin: todo lo demás, con "marcar como leído" y "marcar todo".
- **Modal**: solo suspensión de la cuenta (`SUSPENDED`), con botón "Reactivar".
- En el POS: solo banner; **nunca** interrumpe una venta en curso; el modal de suspensión aparece al terminar la venta actual.
- Cada aviso puede tener CTA (texto + link interno, ej. `/admin/suscripcion`) y vencimiento.

### Preferencias del usuario
Pantalla "Avisos" en Configuración del admin: por categoría, qué canales recibe (con los bloqueos de la tabla de arriba), número de WhatsApp con su opt-in, y suscripción push del navegador. Cada email de categorías apagables lleva link de "dejar de recibir estos avisos" (sin login, con token firmado).

### Datos de contacto
- Email (verificado o no), teléfono en formato internacional (+54 9 …), opt-in de WhatsApp con fecha, opt-in de marketing con fecha, suscripciones push por dispositivo.
- **Retención** (TyC 22/11/2026): los datos de contacto se conservan después de la baja de la suscripción hasta que la persona pida su supresión; los datos del negocio se borran a los 60 días de la baja.

## Main flows

### Flujo 1: Evento con aviso inmediato (pago aprobado)
1. Billing registra el cobro aprobado y encola el evento `payment.approved` en su outbox.
2. El worker de billing lo envía firmado al backend; el backend lo guarda en `event_log` (si ya existía por `idempotency_key`, responde OK y no hace nada).
3. El motor busca las reglas de `payment.approved`, evalúa condiciones y crea los mensajes: in-app (bandeja) + email (recibo).
4. El despachador envía por cada canal; el adaptador devuelve el id del proveedor; el mensaje queda `SENT`.
5. Los webhooks del proveedor actualizan `DELIVERED`/`OPENED`/`CLICKED`.

### Flujo 2: Journey con pasos diferidos y cancelador (dunning)
1. `payment.failed` → reglas con delays D0, D2, D5, D6 → se crean mensajes `SCHEDULED` con su `scheduled_at`.
2. El job de despacho (cada minuto) toma los vencidos y los envía.
3. Si antes llega `payment.approved` para la misma suscripción, todos los mensajes programados del journey pasan a `CANCELLED` y sale el aviso "¡Listo! Tu cuenta está activa de nuevo".

### Flujo 3: Evento por condición de tiempo (fin de prueba −3 días, inactividad)
1. Un job programado (cada hora) busca suscripciones/negocios que cumplen la condición (ej. `trial_ends_at` dentro de 72 h).
2. Emite el evento sintético (`trial.ending`) con `idempotency_key` determinística (`trial.ending:<subscriptionId>:3d`) para que no se repita.
3. Sigue igual que el flujo 1.

### Flujo 4: El usuario lee y descarta un aviso in-app
1. Admin/POS piden `GET /api/notices` al cargar y cada 60 s (o por SSE si está abierto).
2. El usuario hace clic en la CTA → se registra `CLICKED` y se navega.
3. Cierra un aviso descartable → `dismissed_at`; no vuelve a aparecer.

### Flujo 5: Cambio de preferencias
1. El usuario apaga `USO` por WhatsApp.
2. Los mensajes futuros de `USO` por WhatsApp se omiten con `SKIPPED_PREFERENCE`; los ya enviados no cambian.

## Catálogo de eventos (v1)
Convención `dominio.accion` en pasado. Cada evento declara fuente y payload mínimo. Nuevo evento = se agrega acá en el mismo PR.

| Evento | Fuente | Payload mínimo | Usos |
|---|---|---|---|
| `account.created` | backend | tenantId, userId, businessName, businessCategory | bienvenida, checklist |
| `auth.email_verification_requested` | backend | userId, token(ref) | verificación |
| `auth.email_verified` | backend | userId | checklist |
| `auth.password_reset_requested` | backend | userId, token(ref) | recuperar contraseña |
| `auth.password_changed` | backend | userId | seguridad |
| `user.invited` | backend | tenantId, invitedUserId, invitedBy, role | invitación |
| `subscription.transitioned` | billing | subscriptionId, tenantId, from, to, trigger, planCode, accessUntil, graceUntil | journeys de cuenta, métricas |
| `trial.started` | billing | subscriptionId, tenantId, trialEndsAt, planCode | onboarding |
| `trial.ending` | job billing | subscriptionId, tenantId, trialEndsAt, daysLeft, amount, cardLast4 | aviso fin de prueba |
| `subscription.renewal_upcoming` | job billing | subscriptionId, tenantId, nextPaymentDate, amount, planName, cardBrand, cardLast4 | aviso de renovación (−3 días, todos los planes) |
| `subscription.expiring` | job billing | subscriptionId, tenantId, expiresAt, daysLeft | aviso previo a la baja (−7/−3/−1) |
| `payment.approved` | billing | paymentId, subscriptionId, tenantId, amount, currency, planCode, planName, interval, periodStart, periodEnd, nextPaymentDate, paymentMethod, cardBrand, cardLast4, isFirstPayment, mpPaymentId | recibo, bienvenida como cliente |
| `payment.failed` | billing | paymentId, subscriptionId, tenantId, amount, retryAttempt, rejectionGroup, statusDetail, graceUntil | dunning |
| `subscription.suspended` | billing | subscriptionId, tenantId, suspendedAt, expiresAt | modal + avisos |
| `subscription.cancelled` | billing | subscriptionId, tenantId, accessUntil, reasonGroup, reasonDetail | confirmación, encuesta |
| `subscription.expired` | billing | subscriptionId, tenantId, dataDeletionAt | baja, retención |
| `retention.offer_accepted` | billing | subscriptionId, tenantId, reason, offerType | métricas de retención |
| `tenant.data_deletion_scheduled` | job backend | tenantId, deletionAt, daysLeft | aviso de borrado (−7 d) |
| `sale.first_created` | backend | tenantId, saleId, total | celebración, checklist |
| `product.created` / `bulk_upload.completed` | backend | tenantId, count | checklist |
| `device.linked` | backend | tenantId, deviceId, deviceName | checklist |
| `tool.not_used` | job backend | tenantId, toolId, daysSinceSignup | engagement |
| `tenant.inactive` | job backend | tenantId, daysWithoutSales | inactividad |
| `tenant.health_dropped` | job backend | tenantId, score, band | riesgo |
| `feature.released` | consola | toolId, version, changes[] | novedades |
| `feature.requested` | billing/admin | tenantId, feature, source (CANCELACION, SOPORTE) | avisar cuando salga |
| `payment_method.configured` | backend | tenantId, kinds[] | checklist |
| `purchase.first_created` | backend | tenantId, purchaseId | checklist |
| `pos.session_started` | backend | tenantId, userId, deviceId?, runtime (DESKTOP/WEB) | checklist (abrir la caja) |
| `user.logged_in` | backend | tenantId, userId, app (ADMIN/POS) | métricas (usuarios activos) |
| `tenant.data_deleted` | job backend | tenantId, deletedAt | cierre de la retención |
| `console.manual_notice` | consola | tenantId \| ALL, placement, severity, title, body, channels | aviso manual |
| `support.inbound_message` | canal WhatsApp | from, text, tenantId?, userId? | bandeja de soporte en la consola |
| `tool.opened` / `guide.started` / `guide.completed` / `guide.dismissed` | admin/POS | tenantId, userId, toolId, version | métricas y checklist (no disparan avisos salvo reglas explícitas) |

> `sale.created` **no** se emite por venta: las métricas leen `sales` agregadas en el job nocturno.

## Edge cases
- **Evento duplicado** (webhook de MP repetido, reintento del outbox): `idempotency_key` única → 200 sin efecto.
- **Evento fuera de orden** (`payment.approved` llega antes que `payment.failed` del mismo cobro): las reglas evalúan el **estado actual** de la suscripción al momento de despachar, no solo el payload; un aviso de dunning con la suscripción ya `ACTIVE` se omite (`SKIPPED_CONDITION`).
- **Proveedor caído**: reintentos con backoff (1, 5, 15, 60 min, 6 h); tras 5 fallos → `FAILED` y métrica de alerta. Los otros canales siguen.
- **Rebote duro de email** (dirección inexistente): se marca el email como no entregable; se deja de enviar por email y se muestra banner "Revisá tu email" en el admin.
- **Usuario dado de baja del negocio**: no recibe avisos; los mensajes programados para él se cancelan.
- **Tenant borrado a los 60 días**: se borran sus avisos in-app y mensajes; se conservan contactos y el registro mínimo de eventos de cobro (obligación legal).
- **Plantilla inexistente o con variable faltante**: el mensaje queda `FAILED` con `TEMPLATE_ERROR`, nunca se envía un texto con `{{variable}}` sin reemplazar.
- **Horario silencioso + evento crítico a las 23:00**: email e in-app salen ya; WhatsApp a las 9:00 salvo que el evento se cancele antes.

## Acceptance criteria
- [ ] Un evento recibido dos veces genera un solo conjunto de mensajes.
- [ ] `payment.approved` después de `payment.failed` cancela todos los mensajes programados del dunning de esa suscripción.
- [ ] Con todos los adaptadores en modo `log`, el flujo completo funciona y cada mensaje queda `SENT` con el contenido renderizado visible en la base.
- [ ] Un usuario con `USO` apagado no recibe mensajes de `USO` por ese canal; sí recibe `COBROS`.
- [ ] WhatsApp sin opt-in nunca se envía.
- [ ] El banner de `PAST_DUE` aparece en admin y POS y desaparece solo cuando la suscripción vuelve a `ACTIVE`.
- [ ] El modal de suspensión no aparece en el POS con una venta en curso.
- [ ] Ningún mensaje sale con variables sin reemplazar.
- [ ] Los mensajes de WhatsApp/push programados fuera de 9–21 h se envían a las 9:00.
- [ ] Todo evento nuevo está en el catálogo.

## Out of scope
- Elección del proveedor de email y WhatsApp (specs propios).
- Editor visual de plantillas (lo trae `consola-omero`; en este PR las plantillas se cargan por migración/seed).
- SMS.
- Push nativo de celular (no hay app móvil).

## Constraints
- Sin servicio nuevo en Railway: paquete dentro de omero-backend, workers livianos (`@Scheduled`), sin colas externas (Postgres como cola con `FOR UPDATE SKIP LOCKED`).
- Multi-tenant estricto: todo mensaje y aviso lleva `tenant_id`; un usuario nunca ve avisos de otro negocio.
- Sin datos sensibles en payloads (ni tarjetas completas, ni contraseñas, ni datos de los clientes finales del negocio).
- Español rioplatense con voseo en todo texto al usuario.

## Decisiones tomadas (2026-11-22)
- Motor dentro de omero-backend; billing solo emite eventos.
- Proveedores de email y WhatsApp a definir: el motor se construye completo con adaptadores intercambiables y modo `log`.
- Retención: datos del negocio 60 días después de la baja; contacto hasta pedido de supresión.
- Suspensión por falta de pago: 15 días antes de la baja.
- Avisos de `COBROS`/`CUENTA`: solo dueños.
- Remitente de respuestas: `soporte@omero.ar`.
- Configuración de plantillas/reglas desde la consola en `panel.omero.ar`, dentro de la app omero (roles `PLATAFORMA_ADMIN` y `PLATAFORMA_OPERADOR`).

## Open questions
- Ninguna abierta del motor (24/11: suspensión 15 días, avisos de cobro solo a dueños, aviso de renovación en todos los planes).
