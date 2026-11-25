# Programa: comunicaciones, onboarding y métricas

> Branch de specs: `feature/comunicaciones-onboarding-metricas` (desde `develop`, 22/11/2026), en omero-backend, omero-billing, omero, omero-electron y omero-landing.
> Docs de producto en el proyecto Omero: `claude/comunicaciones-onboarding-funcional.md`, `claude/metricas-negocio-funcional.md`, `claude/motivos-de-baja.md`.

Cada feature tiene su carpeta `AiBuild/feature/<feature>/WIP/` con `functional-spec.md`, `technical-spec.md` y `meta.json` (`status: specs-ready`). El siguiente paso de cada una es `sdd-plan` → `sdd-build` en una branch propia desde `develop` (un PR por feature y por repo).

## Orden sugerido de PRs

| # | Feature | Repo(s) | Depende de | Qué entrega |
|---|---|---|---|---|
| 1 | `notificaciones-motor` | omero-backend | — | event_log, reglas, plantillas, despacho, in-app, preferencias, `/internal/events`, adaptadores `log` |
| 2 | `ciclo-suscripcion-eventos` | omero-billing | 1 (endpoint) | historial, eventos con datos del recibo, grupos de rechazo, suspensión → baja, encuesta de baja, datos del registro |
| 3 | `notificaciones-email` | omero-backend | 1 | layout de marca + bloques + SMTP genérico (proveedor se conecta con credenciales) |
| 4 | `flujo-cobro-exitoso-bienvenida` | omero-backend | 1, 2, 3 | **primer flujo real**: recibo de cobro + bienvenida/onboarding + verificación de email |
| 4b | `cuenta-seguridad` (spec C) | omero-backend → omero → omero-electron | 1, 3 | recuperar/cambiar contraseña, aviso de dispositivo nuevo, invitaciones por email |
| 4c | `flujo-cuenta-cobros` (spec A) | omero-backend → omero | 1, 2, 3, 4 | fin de prueba, renovación, dunning, suspensión, baja, borrado, cancelación |
| 4d | `encuesta-baja-retencion` (spec B) | omero-billing → omero-backend → omero | 2, 4c, 8 | encuesta de baja, oferta por motivo (bajar de plan, 30 % × 2 cobros, +7 días, ayuda), pedidos de funciones, aviso a soporte |
| 5 | `notificaciones-motor` | omero, omero-electron | 1 | banner, bandeja, modal, preferencias, `/verificar-email` (admin) |
| 6 | `registro-onboarding` | omero-landing | 2 | rubro, celular, opt-ins, origen del alta, logo para emails, `/registro/listo` con "revisá tu email" (spec G) (TyC ya hechos en esta branch) |
| 7 | `onboarding-guias` | omero-backend → omero → omero-electron | 1 | asistente, Primeros pasos, framework de guías + guías P1 |
| 7b | `journey-activacion` (spec D) | omero-backend | 1, 3, 4, 7 | emails condicionados: +24 h sin productos (consejo por rubro), +48 h sin ventas, +5 días sin POS, primera venta, mitad de prueba |
| 8 | `retencion-datos` | omero-backend | 1, 2 | borrado a los 60 días (en dry-run hasta validar) |
| 9 | `metricas-negocio` | omero-backend | 1, 2 | schema analytics, snapshots, health score, tableros Grafana |
| 10 | `consola-omero` | omero-backend → omero | 1, 3 | **v1 solo correo** en `panel.omero.ar` (sección `/plataforma` del admin, mismo servicio de Railway): plantillas de email, journeys, envíos, estado del canal. v2: clientes, métricas, otros canales |
| 11 | `notificaciones-whatsapp` | omero-backend | 1 | cuando se elija proveedor |
| — | Adaptador de email por API | omero-backend | 3 | cuando se elija proveedor (seguimiento de entregas/rebotes) |

## Decisiones tomadas
- Motor dentro de omero-backend; billing emite eventos.
- Proveedores con adaptadores intercambiables. Email: **Resend** por API HTTPS (confirmado 24/11; Railway Hobby bloquea SMTP); SMTP queda para local/Railway Pro. WhatsApp: a definir.
- Plantillas de email: layout y bloques en el repo, contenido en base editable desde la consola, render propio (no del proveedor).
- Retención: datos del negocio 60 días después de la baja; contacto se conserva salvo supresión. TyC y privacidad actualizados.
- Suspensión por falta de pago: **15 días** (configurable) antes de la baja.
- Avisos de cobros y de cuenta: **solo a los dueños** del negocio (rol `omero-admin` del tenant).
- Aviso de renovación 3 días antes de cada cobro: **todos los planes**.
- Respuestas de los emails: **`soporte@omero.ar`**. Remitente: **`Omero <hola@mail.omero.ar>`** (confirmado 24/11).
- Roles de la consola: **`PLATAFORMA_ADMIN` / `PLATAFORMA_OPERADOR`** (no `omero-admin`/`omero-operador`, que ya son roles de los negocios), con permisos `platformOnly`.
- Consola interna **dentro de `omero`** (sin app nueva) en **`panel.omero.ar`**, dominio extra del mismo servicio de Railway que entra directo a la consola (respaldo: `/plataforma` + acceso en el menú); roles `PLATAFORMA_ADMIN` / `PLATAFORMA_OPERADOR` en el mismo login. **v1 solo correo.**
- Motivos de baja según `motivos-de-baja.md`.

## Migraciones reservadas (renumerar al mergear si chocan)
omero-backend: V43 notifications_core, V44 users_contact_fields, V45 notifications_seed, V46 email_verification, V47 seed_flow_receipt_welcome, V48 whatsapp, V49 onboarding, V50 tenant_retention, V51–V52 analytics, V53 platform_roles.
omero-billing: V6 subscription_history_and_events, V7 retention_offers.
omero-backend (spec B): V57 retention_support. (spec D): V58 seed_activation_journey.
