#!/usr/bin/env node
/**
 * Verifica que el binario nativo de better-sqlite3 CARGA con el ABI real de Electron.
 *
 * Ejecuta el Electron instalado con ELECTRON_RUN_AS_NODE=1 (mismo Node/ABI que el utilityProcess que corre el
 * Next del POS), abre una base en memoria con `nativeBinding`, crea una tabla, inserta y consulta.
 * Sale ≠ 0 si el binario tiene el ABI equivocado, no existe o no es de esta plataforma.
 *
 * Uso:
 *   npm run verify:native                      # binario de esta plataforma/arquitectura en resources/native
 *   node scripts/verify-native.mjs --binding <ruta.node> --module <carpeta de better-sqlite3>
 *
 * Se ejecuta en CI (Windows) y a mano en macOS antes de generar el instalador.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}
function fail(message) {
  console.error(`[verify-native] ✘ ${message}`)
  process.exit(1)
}

const binding = path.resolve(
  arg('binding') ?? path.join(root, 'resources', 'native', `better_sqlite3-${process.platform}-${process.arch}.node`),
)
// Por defecto se usa el JS de better-sqlite3 de web/ (instalado por npm); en el empaquetado: --module resources/frontend/node_modules/better-sqlite3
const moduleDir = path.resolve(arg('module') ?? path.join(root, 'web', 'node_modules', 'better-sqlite3'))

if (!fs.existsSync(binding)) fail(`no existe el binario ${binding} (¿corriste "npm run fetch:native"?)`)
if (!fs.existsSync(path.join(moduleDir, 'package.json'))) fail(`no se encontró better-sqlite3 en ${moduleDir} (¿npm ci en web/?)`)

const code = `
  const Database = require(${JSON.stringify(moduleDir)})
  const db = new Database(':memory:', { nativeBinding: ${JSON.stringify(binding)} })
  db.exec('CREATE TABLE t (a INTEGER)')
  db.prepare('INSERT INTO t VALUES (?)').run(42)
  const row = db.prepare('SELECT a, sqlite_version() AS v FROM t').get()
  if (row.a !== 42) throw new Error('lectura inesperada')
  process.stdout.write(JSON.stringify({ sqlite: row.v, abi: process.versions.modules, node: process.versions.node, electron: process.versions.electron, arch: process.arch }))
`

const result = spawnSync(require('electron'), ['-e', code], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
})

if (result.status !== 0) {
  const output = result.stderr || result.stdout || String(result.error)
  // La causa útil ("was compiled against NODE_MODULE_VERSION X…", "not a mach-o file"…) va en la línea del Error, no en la cola del stack.
  const lines = output.split('\n').map((l) => l.trim()).filter((l) => l && l.length < 300) // descarta código minificado de Electron
  const cause = lines.filter((l) => /^Error:|NODE_MODULE_VERSION|dlopen|mach-o|invalid ELF|not a valid Win32/i.test(l)).slice(0, 3)
  fail(`el binario NO carga con el ABI de Electron:\n    ${(cause.length ? cause : lines.slice(-3)).join('\n    ')}`)
}

let info
try {
  info = JSON.parse(result.stdout)
} catch {
  fail(`salida inesperada: ${result.stdout}`)
}
console.log(
  `[verify-native] ✔ ${path.relative(root, binding)} carga bajo Electron ${info.electron} (Node ${info.node}, ABI ${info.abi}, ${info.arch}) — SQLite ${info.sqlite}`,
)
