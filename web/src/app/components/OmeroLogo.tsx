'use client'

import Image from 'next/image'
import { useTheme } from './ThemeProvider'
import { useEffect, useState } from 'react'

export function OmeroLogo({ width = 120, height = 26 }: { width?: number; height?: number }) {
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const src = mounted && theme === 'light' ? '/brand/logo-full.svg' : '/brand/logo-full-white.svg'
  return <Image src={src} alt="Omero" width={width} height={height} priority />
}
