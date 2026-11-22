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
| 5 | `notificaciones-motor` | omero, omero-electron | 1 | banner, bandeja, modal, preferencias, `/verificar-email` (admin) |
| 6 | `registro-onboarding` | omero-landing | 2 | rubro, celular, opt-ins, origen del alta, logo para emails (TyC ya hechos en esta branch) |
| 7 | `onboarding-guias` | omero-backend → omero → omero-electron | 1 | asistente, Primeros pasos, framework de guías + guías P1 |
| 8 | `retencion-datos` | omero-backend | 1, 2 | borrado a los 60 días (en dry-run hasta validar) |
| 9 | `metricas-negocio` | omero-backend | 1, 2 | schema analytics, snapshots, health score, tableros Grafana |
| 10 | `consola-omero` | omero-backend → omero | 1, 3, 9 | sección `/plataforma` dentro del admin (o `app.omero.ar/admin` por dominio en el mismo servicio de Railway) para plantillas, journeys, envíos, clientes, métricas |
| 11 | `notificaciones-whatsapp` | omero-backend | 1 | cuando se elija proveedor |
| — | Adaptador de email por API | omero-backend | 3 | cuando se elija proveedor (seguimiento de entregas/rebotes) |

## Decisiones tomadas
- Motor dentro de omero-backend; billing emite eventos.
- Proveedores de email/WhatsApp a definir; todo se construye con adaptadores intercambiables (email arranca por SMTP genérico).
- Plantillas de email: layout y bloques en el repo, contenido en base editable desde la consola, render propio (no del proveedor).
- Retención: datos del negocio 60 días después de la baja; contacto se conserva salvo supresión. TyC y privacidad actualizados.
- Suspensión por falta de pago: 30 días (configurable) antes de la baja.
- Consola interna **dentro de `omero`** (sin app nueva): `app.omero.ar/admin` como segundo dominio del mismo servicio, o `/plataforma` con acceso desde el menú; roles `OMERO_ADMIN` / `OMERO_OPERADOR` en el mismo login.
- Motivos de baja según `motivos-de-baja.md`.

## Migraciones reservadas (renumerar al mergear si chocan)
omero-backend: V43 notifications_core, V44 users_contact_fields, V45 notifications_seed, V46 email_verification, V47 seed_flow_receipt_welcome, V48 whatsapp, V49 onboarding, V50 tenant_retention, V51–V52 analytics, V53 platform_roles.
omero-billing: V6 subscription_history_and_events.
