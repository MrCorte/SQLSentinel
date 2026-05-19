import type { BrowserWindow } from 'electron'

let _win: BrowserWindow | null = null

export function setRendererWindow(win: BrowserWindow): void {
  _win = win
}

export function pushToRenderer(channel: string, data: unknown): void {
  if (_win && !_win.isDestroyed()) {
    _win.webContents.send(channel, data)
  }
}
