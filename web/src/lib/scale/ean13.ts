/** Dígito verificador de un EAN-13 a partir de sus primeros 12 dígitos. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/** Completa 12 dígitos con su verificador (para armar etiquetas de prueba). */
export function withCheckDigit(first12: string): string {
  return first12 + ean13CheckDigit(first12)
}
