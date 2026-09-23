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
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export interface LoginCredentials {
  email: string
  password: string
  redirectTo?: string
}

export interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => void
}
