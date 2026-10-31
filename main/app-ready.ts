/**
 * Espera a que la página del POS avise que ya está lista (atributo `data-omero-ready` en <html>, lo pone
 * `AppReadyMarker` cuando hidrató, restauró la sesión y resolvió el tema). Mientras tanto Electron mantiene la
 * pantalla de carga. Tiene un tope de tiempo: si la página nunca avisa (error de render, JS bloqueado) devuelve
 * 'timeout' y el llamador muestra la ventana igual, para no dejar al cajero mirando la carga para siempre.
 */
export const READY_EXPRESSION = `document.documentElement.hasAttribute('data-omero-ready')`

export type ReadyResult = 'ready' | 'timeout'

export interface WaitForReadyOptions {
  /** Evalúa una expresión JS en la página. Debe rechazar si la página no responde. */
  evaluate: (expression: string) => Promise<unknown>
  timeoutMs?: number
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export async function waitForAppReady(opts: WaitForReadyOptions): Promise<ReadyResult> {
  const { evaluate, timeoutMs = 20_000, intervalMs = 150, now = Date.now, sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)) } = opts
  const start = now()
  while (now() - start < timeoutMs) {
    try {
      if ((await evaluate(READY_EXPRESSION)) === true) return 'ready'
    } catch {
      // la página todavía no está lista para evaluar (navegando): se reintenta
    }
    await sleep(intervalMs)
  }
  return 'timeout'
}
