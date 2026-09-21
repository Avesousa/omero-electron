#!/usr/bin/env node
/**
 * Arma resources/frontend/ (lo que electron-builder empaqueta como extraResource "frontend")
 * a partir del build standalone del POS (web/.next/standalone).
 *
 *   resources/frontend/
 *     server.js, node_modules/, package.json   ← web/.next/standalone/*
 *     .next/static/                            ← web/.next/static
 *     public/                                  ← web/public
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
console.log(`[prepare-frontend] OK → ${path.relative(root, out)}`)
