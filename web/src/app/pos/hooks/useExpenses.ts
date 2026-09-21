import { useState } from 'react'
import { apiFetch } from '@/lib/apiClient'

interface ExpenseState {
  showExpenseModal: boolean
  amount: string
  isProcessing: boolean
}

export const useExpenses = (showNotification?: (message: string, type: 'success' | 'error' | 'info') => void) => {
  const [expenseState, setExpenseState] = useState<ExpenseState>({
    showExpenseModal: false,
    amount: '',
    isProcessing: false
  })

  const openExpenseModal = () => {
    setExpenseState(prev => ({
      ...prev,
      showExpenseModal: true,
      amount: '',
      isProcessing: false
    }))
  }

  const closeExpenseModal = () => {
    setExpenseState(prev => ({
      ...prev,
      showExpenseModal: false,
      amount: '',
      isProcessing: false
    }))
  }

  const updateAmount = (amount: string) => {
    setExpenseState(prev => ({ ...prev, amount }))
  }

  const createExpense = async (onComplete: () => void) => {
    const { amount } = expenseState
    const amountValue = parseFloat(amount) || 0

    if (amountValue <= 0) {
      if (showNotification) {
        showNotification('Debe ingresar un monto válido', 'error')
      }
      return
    }

    setExpenseState(prev => ({ ...prev, isProcessing: true }))

    try {
      const result = await apiFetch<unknown>('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          description: 'Gasto general',
          amount: amountValue,
          type: 'GENERAL'
        })
      })

      if (result.success) {
        if (showNotification) {
          showNotification(`Gasto registrado: $${amountValue.toLocaleString()}`, 'success')
        }
        closeExpenseModal()
        onComplete()
      } else {
        if (showNotification) {
          showNotification(result.error || 'Error al registrar gasto', 'error')
        }
        setExpenseState(prev => ({ ...prev, isProcessing: false }))
      }
    } catch (error) {
      console.error('Error creating expense:', error)
      if (showNotification) {
        showNotification('Error de conexión al registrar gasto', 'error')
      }
      setExpenseState(prev => ({ ...prev, isProcessing: false }))
    }
  }

  return {
    expenseState,
    openExpenseModal,
    closeExpenseModal,
    updateAmount,
    createExpense
  }
}

