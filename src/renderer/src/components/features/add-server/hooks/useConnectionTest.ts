import { useState } from 'react'
import type { AddServerFormData } from '../AddServerDialog'

interface AgBadge {
  role: 'PRIMARY' | 'SECONDARY' | 'RESOLVING'
  agName: string
  agGroupId: string
}

interface UseConnectionTestReturn {
  testState: 'idle' | 'loading' | 'success' | 'error'
  testLabel: string
  agBadge: AgBadge | null
  resetTest: () => void
  handleTestConnection: (
    form: AddServerFormData,
    setForm: (updater: (prev: AddServerFormData) => AddServerFormData) => void
  ) => Promise<void>
}

export function useConnectionTest(): UseConnectionTestReturn {
  const [testState, setTestState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [testLabel, setTestLabel] = useState('')
  const [agBadge, setAgBadge] = useState<AgBadge | null>(null)

  const resetTest = (): void => {
    setTestState('idle')
    setTestLabel('')
    setAgBadge(null)
  }

  const handleTestConnection = async (
    form: AddServerFormData,
    setForm: (updater: (prev: AddServerFormData) => AddServerFormData) => void
  ): Promise<void> => {
    if (!form.ip.trim()) {
      return
    }
    setTestState('loading')
    setTestLabel('')
    try {
      const result = await window.sqlSentinel.detectServerInfo({
        ip: form.ip.trim(),
        port: Number(form.port),
        instanceName: form.instanceName || undefined,
        useWindowsAuth: form.useWindowsAuth,
        username: form.username || undefined,
        password: form.password || undefined
      })
      if (!result.ok) {
        setTestState('error')
        setTestLabel(result.error)
        return
      }
      const { machineName, instanceName, agRole, agName, agGroupId } = result.data
      setForm((prev) => ({
        ...prev,
        machineName,
        instanceName: prev.instanceName?.trim() ? prev.instanceName : (instanceName ?? ''),
        alias: prev.alias?.trim() ? prev.alias : machineName,
        agRole,
        agName,
        agGroupId
      }))
      if (agRole && agName && agGroupId) {
        setAgBadge({ role: agRole, agName, agGroupId })
      } else {
        setAgBadge(null)
      }
      const label = instanceName ? `${machineName}\\${instanceName}` : machineName
      setTestState('success')
      setTestLabel(label)
    } catch (err) {
      setTestState('error')
      setTestLabel(err instanceof Error ? err.message : String(err))
    }
  }

  return { testState, testLabel, agBadge, resetTest, handleTestConnection }
}
