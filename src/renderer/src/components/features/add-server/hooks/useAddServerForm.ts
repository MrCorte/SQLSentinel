import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AddServerFormData } from '../AddServerDialog'

interface FormErrors {
  ip?: string
  port?: string
  username?: string
}

const EMPTY_FORM: AddServerFormData = {
  ip: '',
  port: 1433,
  instanceName: '',
  useWindowsAuth: true,
  username: '',
  password: '',
  groupId: undefined,
  alias: undefined,
  hostingType: 'on-premise'
}

interface UseAddServerFormReturn {
  form: AddServerFormData
  errors: FormErrors
  setForm: Dispatch<SetStateAction<AddServerFormData>>
  setErrors: Dispatch<SetStateAction<FormErrors>>
  set: <K extends keyof AddServerFormData>(key: K, value: AddServerFormData[K]) => void
  validate: () => boolean
  initializeForm: (params: {
    initialIp?: string
    initialPort?: number
    initialInstanceName?: string
    initialUseWindowsAuth?: boolean
    initialUsername?: string
    initialPassword?: string
    defaultGroupId?: string
  }) => void
}

export function useAddServerForm(): UseAddServerFormReturn {
  const [form, setForm] = useState<AddServerFormData>(EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})

  const set = <K extends keyof AddServerFormData>(key: K, value: AddServerFormData[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const validate = (): boolean => {
    const newErrors: FormErrors = {}
    if (!form.ip.trim()) newErrors.ip = 'IP or hostname required'
    const portNum = Number(form.port)
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
      newErrors.port = 'Port must be a number between 1 and 65535'
    if (!form.useWindowsAuth && !form.username.trim())
      newErrors.username = 'Username required for SQL Server authentication'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const initializeForm = (params: {
    initialIp?: string
    initialPort?: number
    initialInstanceName?: string
    initialUseWindowsAuth?: boolean
    initialUsername?: string
    initialPassword?: string
    defaultGroupId?: string
  }): void => {
    setForm({
      ...EMPTY_FORM,
      ip: params.initialIp ?? '',
      port: params.initialPort ?? 1433,
      instanceName: params.initialInstanceName ?? '',
      useWindowsAuth: params.initialUseWindowsAuth ?? true,
      username: params.initialUsername ?? '',
      password: params.initialPassword ?? '',
      groupId: params.defaultGroupId
    })
    setErrors({})
  }

  return { form, errors, setForm, setErrors, set, validate, initializeForm }
}
