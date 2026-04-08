import { createContext, useContext } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemeContextValue {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => Promise<void>
}

export const ThemeContext = createContext<ThemeContextValue>({
  themeMode: 'system',
  setThemeMode: async () => {
    throw new Error('useThemeContext must be used inside ThemeContext.Provider')
  }
})

export const useThemeContext = (): ThemeContextValue => useContext(ThemeContext)
