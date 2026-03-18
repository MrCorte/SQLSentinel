import { create } from 'zustand'

interface AppStore {
  /** Server ID to auto-select when Dashboard mounts/activates */
  pendingServerId: string | null
  setPendingServerId: (id: string | null) => void
  /** True while the Electron window is in the background (blurred). */
  isBackground: boolean
  setIsBackground: (v: boolean) => void
}

export const useAppStore = create<AppStore>((set) => ({
  pendingServerId: null,
  setPendingServerId: (id) => set({ pendingServerId: id }),
  isBackground: false,
  setIsBackground: (v) => set({ isBackground: v })
}))
