import { useState, useEffect } from 'react'
import type { Notification, NotificationType } from '../types'

export const useNotifications = () => {
  const [notification, setNotification] = useState<Notification | null>(null)

  const showNotification = (message: string, type: NotificationType = 'info') => {
    setNotification({ message, type })
  }

  const clearNotification = () => {
    setNotification(null)
  }

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