export function isMockModeEnabled(env: Record<string, unknown>): boolean {
  return env.VITE_MOCK_MODE === 'true'
}
