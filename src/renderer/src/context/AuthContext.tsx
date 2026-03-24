import { createContext, useContext } from 'react'
import type { AuthSession } from '../../../preload/index'

export interface AuthContextValue {
  session: AuthSession
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthContext.Provider')
  return ctx
}
