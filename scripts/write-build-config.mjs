#!/usr/bin/env node
/**
 * Escribe resources/build-config.json con la URL del backend por defecto del instalador.
 * El desktop la usa si no hay variable de entorno BACKEND_URL (override).
 *
 * Requiere OMERO_DEFAULT_BACKEND_URL (origen http/https, ej. https://omero-backend.up.railway.app).
 * Falla si falta o es inválida: un instalador sin backend por defecto no sirve.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raw = process.env.OMERO_DEFAULT_BACKEND_URL?.trim()

function fail(message) {
  console.error(`[write-build-config] ${message}`)
  process.exit(1)
}

if (!raw) fail('Falta OMERO_DEFAULT_BACKEND_URL (URL del omero-backend de Railway).')

let url
try {
  url = new URL(raw)
} catch {
  fail(`OMERO_DEFAULT_BACKEND_URL no es una URL válida: "${raw}"`)
}
if (url.protocol !== 'http:' && url.protocol !== 'https:') fail(`Debe usar http o https: "${raw}"`)
if (url.username || url.password) fail('No debe incluir credenciales.')
if (url.pathname !== '/' || url.search || url.hash) fail(`Debe ser solo el origen (sin path/query/fragmento): "${raw}"`)

const file = path.join(root, 'resources', 'build-config.json')
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify({ defaultBackendUrl: url.origin }, null, 2) + '\n')
console.log(`[write-build-config] OK → resources/build-config.json (${url.origin})`)
