/**
 * Verifica `safeStorage` REAL de Electron con el DeviceStore compilado (fase 4).
 * Se ejecuta con el Electron instalado (necesita `app.whenReady`, o sea sesión gráfica en macOS/Windows):
 *
 *   npm run verify:safestorage      # compila (tsc) y corre este script con electron
 *
 * Comprueba: (1) el cifrado del SO está disponible y no es `basic_text`; (2) round-trip de un secreto; (3) el archivo
 * en disco NO contiene el secreto en claro; (4) un archivo alterado se aparta y no rompe. Sale ≠ 0 si algo falla.
 * `--negative` prueba el detector: guarda un secreto EN CLARO a propósito y exige que la verificación lo detecte.
 */
const { app, safeStorage } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { DeviceStore } = require('../dist/main/device-store.js')

const NEGATIVE = process.argv.includes('--negative')
const SECRET = '11111111-2222-3333-4444-555555555555.TESTSECRETTESTSECRETTESTSECRETTESTSECRET1'
const TENANT = '724c4579-ea83-4cef-9f37-bcfbfcc12268'

function fail(message) {
  console.error(`✘ ${message}`)
  app.exit(1)
}

app.whenReady().then(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omero-safestorage-'))
  try {
    const backend = safeStorage.getSelectedStorageBackend ? safeStorage.getSelectedStorageBackend() : 'n/a'
    console.log(`→ safeStorage disponible=${safeStorage.isEncryptionAvailable()} backend=${backend}`)
    const store = new DeviceStore({ dir, safeStorage, log: (m) => console.log(`  log: ${m}`) })
    if (!store.persistent) return fail('el cifrado del SO no está disponible (o es basic_text): la caja no persistiría la sesión')

    if (NEGATIVE) {
      fs.writeFileSync(path.join(dir, 'device-session.bin'), JSON.stringify({ [TENANT]: { secret: SECRET, sessionActive: true } }))
    } else if (!store.save({ [TENANT]: { secret: SECRET, sessionActive: true } })) {
      return fail('no se pudo guardar')
    }

    const raw = fs.readFileSync(path.join(dir, 'device-session.bin'))
    if (raw.includes(Buffer.from(SECRET)) || raw.includes(Buffer.from('TESTSECRETTESTSECRET'))) {
      if (NEGATIVE) {
        console.log('✔ (negativo) el detector encontró el secreto en claro, como debe')
        return app.exit(0)
      }
      return fail('el archivo contiene el secreto EN CLARO')
    }
    if (NEGATIVE) return fail('(negativo) el detector NO encontró el secreto en claro: la verificación no sirve')
    console.log('✔ el archivo no contiene el secreto en claro')

    const loaded = new DeviceStore({ dir, safeStorage }).load()
    if (loaded[TENANT]?.secret !== SECRET) return fail('el round-trip devolvió otro valor')
    console.log('✔ round-trip cifrado → descifrado')

    fs.writeFileSync(path.join(dir, 'device-session.bin'), Buffer.concat([raw.subarray(0, 8), Buffer.from('ALTERADO')]))
    const after = new DeviceStore({ dir, safeStorage, log: () => {} }).load()
    if (Object.keys(after).length !== 0) return fail('un archivo alterado no debería descifrar')
    if (!fs.readdirSync(dir).some((f) => f.startsWith('device-session.bin.corrupt-'))) return fail('el archivo alterado no se apartó')
    console.log('✔ un archivo alterado se aparta y se arranca sin secretos')

    const id = new DeviceStore({ dir, safeStorage }).deviceId
    if (!/^[0-9a-f-]{36}$/.test(id)) return fail('deviceId inválido')
    console.log(`✔ deviceId estable: ${id}`)
    console.log('✔ safeStorage real: OK')
    app.exit(0)
  } catch (err) {
    fail(`excepción: ${err && err.stack ? err.stack : err}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
