'use client'

import { useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/shared'
import {
  sanitizeEmail,
  sanitizePassword,
  validateLoginForm,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@/lib/loginValidation'
import { OmeroLogo } from '@/app/components/OmeroLogo'
import type { FieldErrors } from '@/app/login/types'
import styles from './LoginForm.module.css'

export function LoginForm() {
  const { login, isLoading, error } = useAuth()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? undefined
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  })

  const handleEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeEmail(e.target.value)
    setEmail(sanitized)
    if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: undefined }))
  }, [fieldErrors.email])

  const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizePassword(e.target.value)
    setPassword(sanitized)
    if (fieldErrors.password) setFieldErrors(prev => ({ ...prev, password: undefined }))
  }, [fieldErrors.password])

  const handleBlur = useCallback((field: 'email' | 'password') => {
    setTouched(prev => ({ ...prev, [field]: true }))
    const errors = validateLoginForm(email, password)
    setFieldErrors(prev => ({ ...prev, [field]: errors[field] }))
  }, [email, password])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched({ email: true, password: true })

    const errors = validateLoginForm(email, password)
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setFieldErrors({})
    await login({ email, password, redirectTo })
  }

  const emailError = touched.email ? fieldErrors.email : undefined
  const passwordError = touched.password ? fieldErrors.password : undefined

  return (
    <div className={styles.page}>
      {/* Background decorative blobs */}
      <div className={styles.blob1} aria-hidden />
      <div className={styles.blob2} aria-hidden />

      <main className={styles.card} aria-label="Formulario de acceso">
        {/* Logo + Heading */}
        <div className={styles.header}>
          <div className={styles.logo}>
            <OmeroLogo width={140} height={30} />
          </div>
          <h1 className={styles.title}>Bienvenido de vuelta</h1>
          <p className={styles.subtitle}>Ingresá tus credenciales para acceder</p>
        </div>

        {error && (
          <div className={styles.authError} role="alert" aria-live="assertive" id="login-auth-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="login-email" className={styles.label}>
              Email
            </label>
            <div className={styles.inputWrap}>
              <svg className={styles.inputIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                placeholder="usuario@email.com"
                value={email}
                onChange={handleEmailChange}
                onBlur={() => handleBlur('email')}
                className={`${styles.input}${emailError ? ` ${styles.inputInvalid}` : ''}`}
                disabled={isLoading}
                maxLength={EMAIL_MAX_LENGTH}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'login-email-error' : undefined}
              />
            </div>
            {emailError && (
              <p id="login-email-error" className={styles.fieldError} role="alert">
                {emailError}
              </p>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor="login-password" className={styles.label}>
              Contraseña
            </label>
            <div className={styles.inputWrap}>
              <svg className={styles.inputIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={handlePasswordChange}
                onBlur={() => handleBlur('password')}
                className={`${styles.input}${passwordError ? ` ${styles.inputInvalid}` : ''}`}
                disabled={isLoading}
                maxLength={PASSWORD_MAX_LENGTH}
                aria-invalid={!!passwordError}
                aria-describedby={passwordError ? 'login-password-error' : undefined}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {passwordError && (
              <p id="login-password-error" className={styles.fieldError} role="alert">
                {passwordError}
              </p>
            )}
          </div>

          <button
            id="login-submit"
            type="submit"
            className={styles.submitBtn}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className={styles.spinner} aria-hidden />
                Ingresando…
              </>
            ) : (
              <>
                Ingresar
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </form>
      </main>
    </div>
  )
}
