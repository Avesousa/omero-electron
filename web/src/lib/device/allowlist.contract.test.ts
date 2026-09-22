// @vitest-environment node
/**
 * Contrato con el backend (`DeviceScopeFilter`): un JWT de caja con `scope=pos` SOLO puede llamar a estas rutas; todo
 * lo demás da 403 aunque el usuario sea ADMIN. Este test extrae las rutas `/api/...` que el POS realmente llama
 * (renderer y servidor local) y falla si alguna no está en la lista: si el POS agrega una ruta nueva hay que
 * agregarla también en `omero-backend/.../DeviceScopeFilter.java` (y acá).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

interface Rule {
  method: string
  pattern: string
}

/** Espejo de `DeviceScopeFilter.POS` + `ANY_SCOPE` (mantener sincronizado con el backend). */
export const POS_ALLOWLIST: Rule[] = [
  { method: 'GET', pattern: '/api/health' },
  { method: 'GET', pattern: '/api/auth/me' },
  { method: 'GET', pattern: '/api/products' },
  { method: 'GET', pattern: '/api/products/search' },
  { method: 'GET', pattern: '/api/products/*' },
  { method: 'GET', pattern: '/api/promotions' },
  { method: 'GET', pattern: '/api/business/config' },
  { method: 'GET', pattern: '/api/business/config/*' },
  { method: 'GET', pattern: '/api/dashboard/daily-summary' },
  { method: 'GET', pattern: '/api/mercadopago/events' },
  { method: 'GET', pattern: '/api/mercadopago/transactions' },
  { method: 'POST', pattern: '/api/mercadopago/polling/start' },
  { method: 'POST', pattern: '/api/sales' },
  { method: 'POST', pattern: '/api/expenses' },
  { method: 'POST', pattern: '/api/sync/batch' },
  { method: 'POST', pattern: '/api/auth/**' },
]

function matches(pattern: string, p: string): boolean {
  const re = new RegExp(
    '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§§').replace(/\*/g, '[^/]+').replace(/§§/g, '.*') + '$',
  )
  return re.test(p)
}

export const isAllowed = (p: string) => POS_ALLOWLIST.some((r) => matches(r.pattern, p))

const SRC = path.resolve(__dirname, '../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'api' || e.name === '__tests__' || e.name === 'test') continue // app/api = rutas locales/proxy
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(full)
  }
  return out
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Rutas `/api/...` entre comillas/backticks (sin query; `${x}` → `*`). */
export function extractRoutes(code: string): string[] {
  const found = new Set<string>()
  // La ruta empieza tras una comilla/backtick o tras `${base}` (p. ej. `${backendUrl()}/api/sync/batch`).
  for (const m of stripComments(code).matchAll(/(?:['"`]|\})(\/api\/[^'"`\s?)]*)/g)) {
    const raw = m[1]
    if (raw.endsWith('/')) continue // prefijo (`'/api/auth/'`, `'/api/'`): no es una llamada
    const route = raw.replace(/\$\{[^}]*\}/g, '*')
    if (route.startsWith('/api/_local')) continue // servidor local: no llega al backend
    found.add(route)
  }
  return [...found]
}

describe('extractRoutes / matcher (el detector funciona)', () => {
  it('ignora comentarios, queries y rutas locales; normaliza placeholders', () => {
    const code = `
      // fetch('/api/sales/review')
      /* apiFetch('/api/devices') */
      apiFetch('/api/products/\${code}')
      fetch(\`\${BACKEND_URL}/api/mercadopago/polling/start\`)
      fetch('/api/_local/outbox?limit=1')
      if (!path.startsWith('/api/auth/')) x()
      const u = \`\${backendUrl()}/api/sync/batch\`
      apiFetch('/api/dashboard/daily-summary?byUser=true')
    `
    expect(extractRoutes(code).sort()).toEqual(['/api/dashboard/daily-summary', '/api/products/*', '/api/mercadopago/polling/start', '/api/sync/batch'].sort())
  })

  it('detecta una ruta que NO está en la lista (p. ej. una de administración)', () => {
    const routes = extractRoutes("apiFetch('/api/sales/review'); apiFetch('/api/devices'); apiFetch('/api/products')")
    expect(routes.filter((r) => !isAllowed(r)).sort()).toEqual(['/api/devices', '/api/sales/review'])
  })

  it('el matcher respeta un segmento vs. varios', () => {
    expect(isAllowed('/api/products/001')).toBe(true)
    expect(isAllowed('/api/products/1/2')).toBe(false)
    expect(isAllowed('/api/auth/device/refresh')).toBe(true)
    expect(isAllowed('/api/expenses')).toBe(true)
    expect(isAllowed('/api/expenses/1')).toBe(false)
  })
})

describe('contrato: todo lo que llama el POS está en la lista blanca de la caja (scope=pos)', () => {
  const files = walk(SRC)
  const routes = new Map<string, string[]>()
  for (const f of files) {
    for (const r of extractRoutes(fs.readFileSync(f, 'utf8'))) routes.set(r, [...(routes.get(r) ?? []), path.relative(SRC, f)])
  }

  it('el escáner encontró las llamadas conocidas del POS (no está ciego)', () => {
    for (const known of ['/api/products', '/api/promotions', '/api/sales', '/api/expenses', '/api/sync/batch', '/api/mercadopago/events', '/api/dashboard/daily-summary']) {
      expect([...routes.keys()], known).toContain(known)
    }
  })

  it('ninguna ruta llamada por el POS queda fuera de la lista', () => {
    const outside = [...routes].filter(([r]) => !isAllowed(r)).map(([r, where]) => `${r}  ← ${[...new Set(where)].join(', ')}`)
    expect(outside, `Rutas del POS fuera de la lista blanca de la caja:\n${outside.join('\n')}`).toEqual([])
  })
})
