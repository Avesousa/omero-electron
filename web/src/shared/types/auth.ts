export interface User {
  id: string
  name: string
  email: string
  role: string
  tenantId: string
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
