'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { loadDeviceTheme, saveTheme, THEME_STORAGE_KEY, type Theme } from '@/lib/uiPrefs'

const ThemeContext = createContext<{ theme: Theme; toggle: () => void; settled: boolean }>({
  theme: 'light',
  toggle: () => {},
  settled: true,
})

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Leer desde el atributo ya seteado por el script inline (evita flash)
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document !== 'undefined') {
      return (document.documentElement.getAttribute('data-theme') as Theme) ?? 'light'
    }
    return 'light'
  })
  // `settled`: ya se consultó el tema guardado en el dispositivo (o falló/venció el timeout). Lo usa el marcador de
  // "app lista" para que Electron no muestre la ventana con el tema equivocado.
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Desktop: el tema del dispositivo (archivo) manda sobre el localStorage, que es por puerto.
  useEffect(() => {
    let cancelled = false
    void loadDeviceTheme().then(saved => {
      if (cancelled) return
      if (saved) {
        setTheme(saved)
        try {
          localStorage.setItem(THEME_STORAGE_KEY, saved) // el próximo arranque sin parpadeo (script inline)
        } catch {
          /* sin storage */
        }
      }
      setSettled(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    void saveTheme(next)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle, settled }}>
      {children}
    </ThemeContext.Provider>
  )
}
