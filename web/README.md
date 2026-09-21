# omero-pos-web

App Next.js del POS de Omero. Un mismo build corre en dos modos (`OMERO_RUNTIME`):

- **`web`** — servicio en Railway (Root Directory = `web/`), se usa desde el navegador.
- **`desktop`** — lo levanta Electron (`utilityProcess`) en `127.0.0.1:3000` dentro del instalador.

En ambos, `/api/*` se reenvía al `omero-backend` de Railway mediante el proxy en runtime
(`src/app/api/[...path]/route.ts` → `src/lib/backend-proxy.ts`). Ver `AiBuild/feature/pos-standalone-next-web-mode/`.

## Variables (servidor)

| Variable | Descripción |
|---|---|
| `OMERO_RUNTIME` | `web` \| `desktop`. Obligatoria; el servidor no arranca sin ella |
| `BACKEND_URL` | Origen del `omero-backend` (sin path). Obligatoria |
| `PROXY_TIMEOUT_MS` | Timeout hasta recibir headers del backend (default 30000) |

`web/.env.example` tiene una plantilla. **No** definir `NEXT_PUBLIC_API_URL`: el POS llama a `/api/*` del mismo origen.

## Comandos

```bash
npm run dev            # next dev (Turbopack)
npm run build          # standalone → .next/standalone/server.js
npm start              # next start
npm run check          # typecheck + tests con cobertura (umbral 85 % en runtime / backend-proxy)
```

`GET /api/_local/health` → `{ ok, runtime, backendConfigured }` (local, no toca el backend).

## Código copiado de `omero` (duplicado a propósito)

El POS se copió del repo `omero` (rama `origin/develop`, commit `7b99acb`, 2026-09-21) sin cambiar lógica.
Se duplica por ahora porque el POS se rediseñará con otra estrategia; hasta entonces **las dos copias divergen**.
Para auditar diferencias: `diff -r <omero>/src/<ruta> web/src/<ruta>`.

| Origen en `omero` | Destino en `web/` |
|---|---|
| `src/app/components/OmeroLogo.tsx` | `src/app/components/OmeroLogo.tsx` |
| `src/app/components/ProtectedRoute.module.css` | `src/app/components/ProtectedRoute.module.css` |
| `src/app/components/ProtectedRoute.tsx` | `src/app/components/ProtectedRoute.tsx` |
| `src/app/components/ThemeProvider.tsx` | `src/app/components/ThemeProvider.tsx` |
| `src/app/components/ThemeToggle.tsx` | `src/app/components/ThemeToggle.tsx` |
| `src/app/components/ui/Modal.tsx` | `src/app/components/ui/Modal.tsx` |
| `src/app/globals.css` | `src/app/globals.css` |
| `src/app/layout.tsx` | `src/app/layout.tsx` |
| `src/app/login/components/LoginForm.module.css` | `src/app/login/components/LoginForm.module.css` |
| `src/app/login/components/LoginForm.tsx` | `src/app/login/components/LoginForm.tsx` |
| `src/app/login/page.tsx` | `src/app/login/page.tsx` |
| `src/app/login/types/index.ts` | `src/app/login/types/index.ts` |
| `src/app/pos/components/cart/CartItem.tsx` | `src/app/pos/components/cart/CartItem.tsx` |
| `src/app/pos/components/cart/CartList.tsx` | `src/app/pos/components/cart/CartList.tsx` |
| `src/app/pos/components/cart/CartSummary.tsx` | `src/app/pos/components/cart/CartSummary.tsx` |
| `src/app/pos/components/index.ts` | `src/app/pos/components/index.ts` |
| `src/app/pos/components/input/InputDisplay.tsx` | `src/app/pos/components/input/InputDisplay.tsx` |
| `src/app/pos/components/keyboard/KeyboardGuide.tsx` | `src/app/pos/components/keyboard/KeyboardGuide.tsx` |
| `src/app/pos/components/modals/DailySummaryModal.tsx` | `src/app/pos/components/modals/DailySummaryModal.tsx` |
| `src/app/pos/components/modals/DeleteModal.tsx` | `src/app/pos/components/modals/DeleteModal.tsx` |
| `src/app/pos/components/modals/ExpenseModal.tsx` | `src/app/pos/components/modals/ExpenseModal.tsx` |
| `src/app/pos/components/modals/FreePriceModal.tsx` | `src/app/pos/components/modals/FreePriceModal.tsx` |
| `src/app/pos/components/modals/MpTransactionsModal.tsx` | `src/app/pos/components/modals/MpTransactionsModal.tsx` |
| `src/app/pos/components/modals/PaymentModal.tsx` | `src/app/pos/components/modals/PaymentModal.tsx` |
| `src/app/pos/components/modals/ProductsModal.tsx` | `src/app/pos/components/modals/ProductsModal.tsx` |
| `src/app/pos/components/notifications/Notification.tsx` | `src/app/pos/components/notifications/Notification.tsx` |
| `src/app/pos/constants/index.ts` | `src/app/pos/constants/index.ts` |
| `src/app/pos/constants/mockData.ts` | `src/app/pos/constants/mockData.ts` |
| `src/app/pos/constants/strings.ts` | `src/app/pos/constants/strings.ts` |
| `src/app/pos/hooks/__tests__/offlineQueue-utils.test.ts` | `src/app/pos/hooks/__tests__/offlineQueue-utils.test.ts` |
| `src/app/pos/hooks/index.ts` | `src/app/pos/hooks/index.ts` |
| `src/app/pos/hooks/useCart.ts` | `src/app/pos/hooks/useCart.ts` |
| `src/app/pos/hooks/useExpenses.ts` | `src/app/pos/hooks/useExpenses.ts` |
| `src/app/pos/hooks/useKeyboard.electron.ts` | `src/app/pos/hooks/useKeyboard.electron.ts` |
| `src/app/pos/hooks/useKeyboard.legacy.ts` | `src/app/pos/hooks/useKeyboard.legacy.ts` |
| `src/app/pos/hooks/useKeyboard.web.ts` | `src/app/pos/hooks/useKeyboard.web.ts` |
| `src/app/pos/hooks/useMercadoPagoEvents.ts` | `src/app/pos/hooks/useMercadoPagoEvents.ts` |
| `src/app/pos/hooks/useMercadoPagoPolling.ts` | `src/app/pos/hooks/useMercadoPagoPolling.ts` |
| `src/app/pos/hooks/useNotifications.ts` | `src/app/pos/hooks/useNotifications.ts` |
| `src/app/pos/hooks/useOfflineQueue.ts` | `src/app/pos/hooks/useOfflineQueue.ts` |
| `src/app/pos/hooks/usePayment.ts` | `src/app/pos/hooks/usePayment.ts` |
| `src/app/pos/hooks/useProducts.ts` | `src/app/pos/hooks/useProducts.ts` |
| `src/app/pos/hooks/usePromotions.ts` | `src/app/pos/hooks/usePromotions.ts` |
| `src/app/pos/hooks/useSales.ts` | `src/app/pos/hooks/useSales.ts` |
| `src/app/pos/layout.tsx` | `src/app/pos/layout.tsx` |
| `src/app/pos/page.tsx` | `src/app/pos/page.tsx` |
| `src/app/pos/types/index.ts` | `src/app/pos/types/index.ts` |
| `src/instrumentation.ts` | `src/instrumentation.ts` |
| `src/lib/apiClient.ts` | `src/lib/apiClient.ts` |
| `src/lib/loginValidation.ts` | `src/lib/loginValidation.ts` |
| `src/lib/purchaseQueueStorage.ts` | `src/lib/purchaseQueueStorage.ts` |
| `src/lib/sessionManager.ts` | `src/lib/sessionManager.ts` |
| `src/lib/tenantTime.ts` | `src/lib/tenantTime.ts` |
| `src/middleware.ts` | `src/middleware.ts` |
| `src/shared/contexts/auth.tsx` | `src/shared/contexts/auth.tsx` |
| `src/shared/index.ts` | `src/shared/index.ts` |
| `src/shared/services/authService.ts` | `src/shared/services/authService.ts` |
| `src/shared/types/auth.ts` | `src/shared/types/auth.ts` |
| `src/shared/types/mercadopago.ts` | `src/shared/types/mercadopago.ts` |
| `src/test/setup.ts` | `src/test/setup.ts` |
| `public/brand/favicon-32.svg` | `public/brand/favicon-32.svg` |
| `public/brand/logo-full-white.svg` | `public/brand/logo-full-white.svg` |
| `public/brand/logo-full.svg` | `public/brand/logo-full.svg` |
| `public/brand/logo-icon.svg` | `public/brand/logo-icon.svg` |
| `public/brand/logo-wordmark.svg` | `public/brand/logo-wordmark.svg` |

Archivos propios de este repo (no existen en `omero`): `src/app/page.tsx`, `src/app/api/**`,
`src/lib/runtime.ts`, `src/lib/backend-proxy.ts`, `next.config.ts` (sin `rewrites`; con `redirects`).
`src/instrumentation.ts` parte de la copia y agrega la validación de entorno.

## Deuda conocida
- `globals.css` se copió completo (incluye estilos del admin que el POS no usa).
- Eliminar `/pos` de `omero` una vez validado este POS.
