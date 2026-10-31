export interface User {
  id: string
  name: string
  email: string
  /** Nombre del rol asignado (ej. "omero-admin"), no un enum fijo — ver shared/permissions.ts. */
  role: string
  tenantId: string
  /** Permisos efectivos al momento del login/rotación — no se actualizan hasta la próxima. */
  permissions: string[]
}

export interface LoginData{
  accessToken: string
  refreshToken: string
  expiresIn: string
  user: User
  /** Si el negocio ofrece login con clave numérica (backend nuevo; ausente = no). */
  quickKeyLoginEnabled?: boolean
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

/** Login con email + contraseña (siempre disponible; obligatorio la primera vez en una caja). */
export interface EmailCredentials {
  email: string
  password: string
  redirectTo?: string
}

/** Login con clave numérica: tenant guardado en la caja + clave. */
export interface KeyCredentials {
  tenantId: string
  key: string
  redirectTo?: string
}

export type LoginCredentials = EmailCredentials | KeyCredentials

export interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => void
  /** Vuelve a leer la sesión guardada (cookie/sessionStorage) y actualiza el estado. true si hay sesión vigente. */
  syncSession: () => boolean
}
