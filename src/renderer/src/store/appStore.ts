import { create } from 'zustand'

interface AppStore {
  /** Server ID to auto-select when Dashboard mounts/activates */
  pendingServerId: string | null
  setPendingServerId: (id: string | null) => void
  /** Currently selected server ID — shared between ServerTree and Dashboard */
  selectedServerId: string | null
  setSelectedServerId: (id: string | null) => void
  /** Currently selected Availability Group name — shared between ServerTree,
   *  the HomeDashboard AG headers, and the Dashboard AG view. */
  selectedAgName: string | null
  setSelectedAgName: (name: string | null) => void
  /** True while the Electron window is in the background (blurred). */
  isBackground: boolean
  setIsBackground: (v: boolean) => void
}

export const useAppStore = create<AppStore>((set) => ({
  pendingServerId: null,
  setPendingServerId: (id) => set({ pendingServerId: id }),
  selectedServerId: null,
  setSelectedServerId: (id) => set({ selectedServerId: id }),
  selectedAgName: null,
  setSelectedAgName: (name) => set({ selectedAgName: name }),
  isBackground: false,
  setIsBackground: (v) => set({ isBackground: v })
}))
