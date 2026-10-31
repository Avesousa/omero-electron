# POS Omero — modo web (Railway). Root Directory del servicio: web/
# Variables de runtime (Railway): OMERO_RUNTIME=web, BACKEND_URL=https://<omero-backend>, PORT (lo inyecta Railway).
# No se usan NEXT_PUBLIC_*: el POS llama a /api/* del mismo origen y el proxy reenvía al backend.

# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# OJO: NO usar --omit=optional. Omite TODAS las optionalDependencies, incluidas las binarias de Tailwind 4
# (lightningcss-*) y de SWC de Next, y rompe el build. better-sqlite3 (caché SQLite del desktop) es opcional:
# publica binarios musl y, si su instalación fallara, npm la tolera. El modo web nunca la carga.
RUN npm ci

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 3: runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# El servidor valida OMERO_RUNTIME y BACKEND_URL al arrancar (instrumentation): si faltan, no levanta.
CMD ["node", "server.js"]
