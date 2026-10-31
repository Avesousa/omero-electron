import type { FieldErrors } from "@/app/login/types";


export const EMAIL_MAX_LENGTH = 254; // RFC 5321
export const PASSWORD_MIN_LENGTH = 8; // alineado con @Size(min = 8) de RegisterRequest
export const PASSWORD_MAX_LENGTH = 72; // límite de bytes de bcrypt

const EMAIL_REGEX =
  /^[^\s@<>'"\\;,()[\]{}]+@[^\s@<>'"\\;,()[\]{}]+\.[a-zA-Z]{2,}$/;

const DANGEROUS_CHARS_REGEX = /[<>'"`;\\]/;


export function sanitizeEmail(raw: string): string {
  return raw.trim().toLowerCase().slice(0, EMAIL_MAX_LENGTH);
}

export function sanitizePassword(raw: string): string {
  return raw.trim().slice(0, PASSWORD_MAX_LENGTH);
}


export function validateEmail(email: string): string | undefined {
  if (!email) return "El email es requerido.";
  if (email.length > EMAIL_MAX_LENGTH)
    return `El email no puede superar ${EMAIL_MAX_LENGTH} caracteres.`;
  if (DANGEROUS_CHARS_REGEX.test(email))
    return "El email contiene caracteres no permitidos.";
  if (!EMAIL_REGEX.test(email))
    return "Ingresá un email válido (ej: usuario@dominio.com).";
  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (!password) return "La contraseña es requerida.";
  if (password.length < PASSWORD_MIN_LENGTH)
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `La contraseña no puede superar ${PASSWORD_MAX_LENGTH} caracteres.`;
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(password))
    return "La contraseña contiene caracteres no válidos.";
  return undefined;
}

export function validateLoginForm(
  email: string,
  password: string,
): FieldErrors {
  const errors: FieldErrors = {};

  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;

  const passwordError = validatePassword(password);
  if (passwordError) errors.password = passwordError;

  return errors;
}

export function isFormValid(email: string, password: string): boolean {
  const errors = validateLoginForm(email, password);
  return Object.keys(errors).length === 0;
}
