/**
 * Los errores que se muestran al usuario van siempre en español. Si el backend devolvió algo genérico
 * ("Error 403", "Error 500") o vacío, se reemplaza por un texto claro; el resto (ya en español) pasa tal cual.
 */
export function friendlyError(error: string | undefined, fallback: string): string {
  const e = (error ?? '').trim()
  if (!e) return fallback
  const generic = /^Error (\d{3})$/.exec(e)
  if (generic) {
    const status = Number(generic[1])
    if (status === 403) return 'No tenés permiso para realizar esta acción.'
    if (status === 404) return 'No se encontró el elemento. Recargá la pantalla.'
    return fallback
  }
  if (/^(forbidden|access denied|unauthorized|internal server error|bad request|not found)/i.test(e)) return fallback
  return e
}
