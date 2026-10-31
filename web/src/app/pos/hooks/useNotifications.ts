import { useState, useEffect, useCallback } from 'react'
import type { Notification, NotificationType } from '../types'

export const useNotifications = () => {
  const [notification, setNotification] = useState<Notification | null>(null)

  // Estables entre renders: otros hooks las usan como dependencia de efectos
  const showNotification = useCallback((message: string, type: NotificationType = 'info') => {
    setNotification({ message, type })
  }, [])

  const clearNotification = useCallback(() => {
    setNotification(null)
  }, [])

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [notification])

  return {
    notification,
    showNotification,
    clearNotification
  }
} 