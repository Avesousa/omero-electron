#!/usr/bin/env node
/**
 * Descarga los binarios PRECOMPILADOS de better-sqlite3 para el ABI de Electron y los deja en
 * resources/native/better_sqlite3-<platform>-<arch>.node (uno por plataforma/arquitectura de destino).
 *
 * Por qué: el Next del POS corre dentro de Electron (utilityProcess) y su ABI de Node (Electron 40 → 143) es
 * DISTINTO del de Node del sistema (dev) y del de Docker/CI. Un `.node` con ABI equivocado no carga.
 * El DMG universal lleva los dos de macOS y el runtime elige por `process.arch` (OMERO_SQLITE_BINDING).
 *
 * Seguridad: cada archivo se verifica contra scripts/native-checksums.json (SHA-256 fijado). Sin entrada o con
 * hash distinto el script FALLA. Para registrar/actualizar hashes (p. ej. al subir Electron o better-sqlite3):
 *   node scripts/fetch-native.mjs --update     (revisar el diff del JSON antes de commitear)
 *
 * Uso: npm run fetch:native
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import * as tar from 'tar'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'resources', 'native')
const checksumsFile = path.join(root, 'scripts', 'native-checksums.json')
const update = process.argv.includes('--update')
const require = createRequire(import.meta.url)

/** Plataformas que se empaquetan: Windows x64 y macOS universal (Intel + Apple Silicon). */
const TARGETS = [
  { platform: 'win32', arch: 'x64' },
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
]

function fail(message) {
  console.error(`[fetch-native] ${message}`)
  process.exit(1)
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// better-sqlite3: versión EXACTA declarada en web/package.json
const webPkg = JSON.parse(fs.readFileSync(path.join(root, 'web', 'package.json'), 'utf8'))
const version = webPkg.optionalDependencies?.['better-sqlite3']
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('web/package.json debe fijar una versión exacta de better-sqlite3')

// ABI de Electron: se le pregunta al Electron instalado (ELECTRON_RUN_AS_NODE)
const electronBin = require('electron')
const probe = spawnSync(electronBin, ['-e', 'process.stdout.write(process.versions.modules)'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
})
const abi = probe.stdout?.trim()
if (probe.status !== 0 || !/^\d+$/.test(abi ?? '')) fail(`no se pudo obtener el ABI de Electron: ${probe.stderr || probe.error}`)

const checksums = fs.existsSync(checksumsFile) ? JSON.parse(fs.readFileSync(checksumsFile, 'utf8')) : {}
fs.mkdirSync(outDir, { recursive: true })

for (const { platform, arch } of TARGETS) {
  const asset = `better-sqlite3-v${version}-electron-v${abi}-${platform}-${arch}.tar.gz`
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${asset}`
  const target = path.join(outDir, `better_sqlite3-${platform}-${arch}.node`)
  const known = checksums[asset]

  if (!update && !known) fail(`sin checksum registrado para ${asset}. Ejecutá con --update y revisá el diff.`)

  // ya descargado y verificado → no se repite
  if (!update && fs.existsSync(target) && sha256(fs.readFileSync(target)) === known.node) {
    console.log(`[fetch-native] ${platform}-${arch}: ya está (ok)`)
    continue
  }

  console.log(`[fetch-native] descargando ${asset}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) fail(`descarga fallida (${res.status}) ${url}`)
  const archive = Buffer.from(await res.arrayBuffer())
  const archiveHash = sha256(archive)
  if (!update && archiveHash !== known.archive) {
    fail(`SHA-256 distinto para ${asset}\n  esperado: ${known.archive}\n  obtenido: ${archiveHash}`)
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-native-'))
  try {
    const archiveFile = path.join(tmp, asset)
    fs.writeFileSync(archiveFile, archive)
    await tar.x({ file: archiveFile, cwd: tmp, filter: (p) => p.endsWith('build/Release/better_sqlite3.node') })
    const extracted = path.join(tmp, 'build', 'Release', 'better_sqlite3.node')
    if (!fs.existsSync(extracted)) fail(`el archivo ${asset} no contiene build/Release/better_sqlite3.node`)
    const nodeBuf = fs.readFileSync(extracted)
    fs.writeFileSync(target, nodeBuf)
    if (update) checksums[asset] = { archive: archiveHash, node: sha256(nodeBuf) }
    else if (sha256(nodeBuf) !== known.node) fail(`el .node extraído de ${asset} no coincide con el registrado`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`[fetch-native] ${platform}-${arch} → ${path.relative(root, target)}`)
}

if (update) {
  fs.writeFileSync(checksumsFile, JSON.stringify(checksums, null, 2) + '\n')
  console.log(`[fetch-native] checksums actualizados en ${path.relative(root, checksumsFile)}`)
}
console.log(`[fetch-native] OK (better-sqlite3 v${version}, Electron ABI ${abi})`)
