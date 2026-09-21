import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  // Build autocontenido: lo usa Electron (resources/frontend) y el Dockerfile de Railway.
  // Next 16.3 (dev) genera AGENTS.md/CLAUDE.md en el proyecto; se desactiva para no ensuciar el repo.
  agentRules: false,
  output: 'standalone',
  // Con dos lockfiles en el repo (raíz y web/) Next podría inferir la raíz del repo y anidar
  // el standalone en `standalone/web/server.js`. Se fija a esta carpeta para que `server.js`
  // quede en la raíz del standalone.
  outputFileTracingRoot: path.join(__dirname),
  // El POS es la raíz de este servicio.
  async redirects() {
    return [{ source: '/', destination: '/pos', permanent: false }]
  },
  // OJO: sin `rewrites` para /api/*. El proxy vive en `src/app/api/[...path]/route.ts` y lee
  // BACKEND_URL en *runtime* (los rewrites se resuelven en build y no permitirían override).
}

export default nextConfig
