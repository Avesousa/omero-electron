import { getBackendUrl, getRuntime } from '@/lib/runtime'

// Readiness LOCAL: Electron (waitForFrontend) y el healthcheck de Railway.
// No consulta el backend: el POS debe poder arrancar aunque no haya conexión.
// La carpeta se llama `%5Flocal` porque en App Router `_local` sería una carpeta privada (sin ruta);
// la URL resultante es /api/_local/health y tiene prioridad sobre el catch-all /api/[...path].
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({
    ok: true,
    runtime: getRuntime(),
    backendConfigured: Boolean(getBackendUrl()),
  })
}
