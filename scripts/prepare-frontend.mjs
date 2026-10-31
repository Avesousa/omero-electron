#!/usr/bin/env node
/**
 * Arma resources/frontend/ (lo que electron-builder empaqueta como extraResource "frontend")
 * a partir del build standalone del POS (web/.next/standalone).
 *
 *   resources/frontend/
 *     server.js, node_modules/, package.json   ← web/.next/standalone/*
 *     .next/static/                            ← web/.next/static
 *     public/                                  ← web/public
 *   (y valida resources/native: binarios de better-sqlite3 para el ABI de Electron)
 *
 * Uso: npm --prefix web run build && node scripts/prepare-frontend.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const web = path.join(root, 'web')
const standalone = path.join(web, '.next', 'standalone')
const out = path.join(root, 'resources', 'frontend')

function fail(message) {
  console.error(`[prepare-frontend] ${message}`)
  process.exit(1)
}

if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  if (fs.existsSync(path.join(standalone, 'web', 'server.js'))) {
    fail('El standalone quedó anidado en standalone/web/. Revisá outputFileTracingRoot en web/next.config.ts.')
  }
  fail('No existe web/.next/standalone/server.js. ¿Corriste "npm --prefix web run build"?')
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
fs.cpSync(standalone, out, { recursive: true })

const staticDir = path.join(web, '.next', 'static')
if (fs.existsSync(staticDir)) {
  fs.cpSync(staticDir, path.join(out, '.next', 'static'), { recursive: true })
}
const publicDir = path.join(web, 'public')
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, path.join(out, 'public'), { recursive: true })
}

if (!fs.existsSync(path.join(out, 'server.js'))) fail('resources/frontend/server.js no se generó.')

// ── Caché SQLite (better-sqlite3) ────────────────────────────────────────────
// Next NO traza este módulo (se carga con createRequire en runtime, ver web/src/lib/catalog/store-registry.ts), así
// que se copia explícitamente: solo lib/ y package.json (~60 KB). El `.node` NO se copia desde acá: el que trae
// node_modules es del Node del SISTEMA (ABI equivocado para Electron); en runtime se usa el binario de
// resources/native elegido por plataforma/arquitectura (OMERO_SQLITE_BINDING).
const sqliteSrc = path.join(web, 'node_modules', 'better-sqlite3')
if (!fs.existsSync(path.join(sqliteSrc, 'lib'))) {
  fail('No se encontró web/node_modules/better-sqlite3. Corré "npm ci" en web/ (es optionalDependency).')
}
const sqliteDir = path.join(out, 'node_modules', 'better-sqlite3')
fs.rmSync(sqliteDir, { recursive: true, force: true })
fs.mkdirSync(sqliteDir, { recursive: true })
for (const entry of ['package.json', 'LICENSE']) {
  if (fs.existsSync(path.join(sqliteSrc, entry))) fs.cpSync(path.join(sqliteSrc, entry), path.join(sqliteDir, entry))
}
fs.cpSync(path.join(sqliteSrc, 'lib'), path.join(sqliteDir, 'lib'), { recursive: true })

const nativeDir = path.join(root, 'resources', 'native')
const required = ['win32-x64', 'darwin-arm64', 'darwin-x64'].map((t) => `better_sqlite3-${t}.node`)
const missing = required.filter((f) => !fs.existsSync(path.join(nativeDir, f)))
if (missing.length) fail(`Faltan binarios nativos en resources/native: ${missing.join(', ')}. Corré "npm run fetch:native".`)
console.log(`[prepare-frontend] OK → ${path.relative(root, out)}`)
