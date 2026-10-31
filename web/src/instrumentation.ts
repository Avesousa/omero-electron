/**
 * Hook de arranque de Next. Solo corre código de Node (nunca edge):
 * la lógica vive en instrumentation-node.ts y se importa condicionalmente.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
