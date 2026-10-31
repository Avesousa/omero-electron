import styles from './LoadingScreen.module.css'

/** Pantalla de carga a página completa (sesión restaurándose, ruta cargando). Nunca una pantalla vacía. */
export function LoadingScreen({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden />
      <p className={styles.label}>{label}</p>
    </div>
  )
}
