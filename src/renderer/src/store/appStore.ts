import { create } from 'zustand'

interface AppStore {
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
  selectedServerId: null,
  setSelectedServerId: (id) => set({ selectedServerId: id }),
  selectedAgName: null,
  setSelectedAgName: (name) => set({ selectedAgName: name }),
  isBackground: false,
  setIsBackground: (v) => set({ isBackground: v })
}))
