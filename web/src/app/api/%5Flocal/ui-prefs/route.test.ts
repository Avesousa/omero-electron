// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GET, PUT } from './route'

let dir: string
const saved = { ...process.env }
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-ui-route-'))
  process.env.OMERO_RUNTIME = 'desktop'
  process.env.OMERO_DATA_DIR = dir
})
afterEach(() => {
  process.env = { ...saved }
  fs.rmSync(dir, { recursive: true, force: true })
})

const put = (body: string) => PUT(new Request('http://x/api/_local/ui-prefs', { method: 'PUT', body }))

describe('/api/_local/ui-prefs', () => {
  it('GET sin preferencia, PUT dark, GET dark (persistido)', async () => {
    expect(await (await GET()).json()).toEqual({ success: true, data: { available: true } })
    const res = await put('{"theme":"dark"}')
    expect((await res.json()).data).toEqual({ available: true, saved: true })
    expect(await (await GET()).json()).toEqual({ success: true, data: { available: true, theme: 'dark' } })
  })

  it('PUT inválido → 400', async () => {
    expect((await put('{"theme":"neon"}')).status).toBe(400)
    expect((await put('no json')).status).toBe(400)
  })

  it('web: available:false', async () => {
    process.env.OMERO_RUNTIME = 'web'
    expect((await (await GET()).json()).data).toEqual({ available: false })
    expect((await (await put('{"theme":"dark"}')).json()).data).toEqual({ available: false })
  })
})
