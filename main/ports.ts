import net from 'net'

/** Puerto preferido del POS local: mantenerlo estable conserva el origen (localStorage) de las cajas ya instaladas. */
export const PREFERRED_PORT = 3000
/** Host donde escucha el Next local; el sondeo de puertos debe usar el MISMO host (no todas las interfaces). */
export const LOOPBACK_HOST = '127.0.0.1'

export type ListenProbe = (port: number, host: string) => Promise<number | null>

/**
 * Intenta escuchar en host:port y suelta el puerto. Devuelve el puerto realmente asignado
 * (útil con `0` = "que elija el SO") o `null` si no se pudo (ocupado, reservado, error del SO…).
 */
export const probeListen: ListenProbe = (port, host) =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(null))
    server.once('listening', () => {
      const bound = (server.address() as net.AddressInfo).port
      server.close(() => resolve(bound))
    })
    server.listen(port, host)
  })

export interface FindPortOptions {
  preferred?: number
  /** Cuántos puertos consecutivos probar a partir de `preferred`. */
  count?: number
  host?: string
  /** Puertos que ya fallaron (p. ej. el Next no pudo escuchar aunque el sondeo dijo que sí). */
  skip?: ReadonlySet<number>
  probe?: ListenProbe
}

/**
 * Elige un puerto local libre: primero el preferido, luego los siguientes y, como último recurso,
 * uno que asigne el SO. `null` solo si el sistema no deja escuchar en el loopback.
 * El usuario final nunca debería ver un error por el puerto.
 */
export async function findFreePort(options: FindPortOptions = {}): Promise<number | null> {
  const {
    preferred = PREFERRED_PORT,
    count = 10,
    host = LOOPBACK_HOST,
    skip = new Set<number>(),
    probe = probeListen,
  } = options

  for (let port = preferred; port < preferred + count; port++) {
    if (skip.has(port)) continue
    if ((await probe(port, host)) !== null) return port
  }

  const assigned = await probe(0, host)
  return assigned !== null && !skip.has(assigned) ? assigned : null
}
