import type { Metadata } from "next"
import { Inter } from 'next/font/google'
import { ThemeProvider } from './components/ThemeProvider'
import { AuthProvider } from '@/shared'
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: "Omero - Sistema POS",
  description: "Sistema de punto de venta fácil de usar para pequeños negocios",
  icons: { icon: "/brand/favicon-32.svg" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{
          // Rediseño claro (2026-10): el tema por defecto pasa a claro. Se usa una clave nueva para que las
          // cajas que ya tenían guardado 'dark' (el provider lo guardaba siempre) arranquen en claro una vez.
          __html: `(function(){try{var t=localStorage.getItem('omero-theme-v2');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light')}catch(e){document.documentElement.setAttribute('data-theme','light')}})()`,
        }} />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
