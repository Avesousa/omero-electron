import net from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { findFreePort, LOOPBACK_HOST, PREFERRED_PORT, probeListen } from './ports'

const open: net.Server[] = []

function occupy(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, LOOPBACK_HOST, () => {
      open.push(server)
      resolve(server)
    })
  })
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))))
})

describe('probeListen', () => {
  it('devuelve el puerto que asignó el SO cuando se pide 0', async () => {
    const port = await probeListen(0, LOOPBACK_HOST)
    expect(port).toBeGreaterThan(0)
  })

  it('devuelve el mismo puerto si está libre', async () => {
    const free = (await probeListen(0, LOOPBACK_HOST))!
    expect(await probeListen(free, LOOPBACK_HOST)).toBe(free)
  })

  it('devuelve null si el puerto está ocupado', async () => {
    const server = await occupy(0)
    const { port } = server.address() as net.AddressInfo
    expect(await probeListen(port, LOOPBACK_HOST)).toBeNull()
  })

  it('devuelve null ante un error del SO (host inválido)', async () => {
    expect(await probeListen(0, '999.999.999.999')).toBeNull()
  })
})

describe('findFreePort', () => {
  it('usa el puerto preferido si está libre', async () => {
    const probe = async (port: number) => port
    expect(await findFreePort({ probe })).toBe(PREFERRED_PORT)
  })

  it('salta al siguiente puerto si el preferido está ocupado', async () => {
    const probe = async (port: number) => (port === 3000 ? null : port)
    expect(await findFreePort({ probe })).toBe(3001)
  })

  it('salta los puertos que ya fallaron', async () => {
    const probe = async (port: number) => port
    expect(await findFreePort({ probe, skip: new Set([3000, 3001]) })).toBe(3002)
  })

  it('cae a un puerto asignado por el SO si todo el rango está ocupado', async () => {
    const probe = async (port: number) => (port === 0 ? 51234 : null)
    expect(await findFreePort({ probe, count: 3 })).toBe(51234)
  })

  it('devuelve null si ni el SO puede asignar uno', async () => {
    expect(await findFreePort({ probe: async () => null })).toBeNull()
  })

  it('devuelve null si el puerto asignado por el SO ya había fallado', async () => {
    const probe = async (port: number) => (port === 0 ? 51234 : null)
    expect(await findFreePort({ probe, count: 1, skip: new Set([51234]) })).toBeNull()
  })

  it('con el sondeo real evita un puerto realmente ocupado', async () => {
    const server = await occupy(0)
    const { port } = server.address() as net.AddressInfo
    const found = await findFreePort({ preferred: port, count: 5 })
    expect(found).not.toBe(port)
    expect(found).not.toBeNull()
  })
})
