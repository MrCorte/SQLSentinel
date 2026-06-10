import { BrowserWindow } from 'electron'
import WebSocket from 'ws'
import { createLogger } from './utils/logger'
import type { WsPushMessage, WsClientMessage } from '../shared/serviceProtocol'
import { CONFIG_PATH } from './serviceConfig'
import { readFileSync } from 'node:fs'

const log = createLogger('service-client')

export interface ServiceConfig {
  port: number
  secret: string
}

export type ServiceStatus = 'connected' | 'connecting' | 'disconnected'

let _config: ServiceConfig | null = null
let _ws: WebSocket | null = null
let _status: ServiceStatus = 'disconnected'
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
const _statusListeners: Array<(s: ServiceStatus) => void> = []

// ── Config ────────────────────────────────────────────────────────────────────

export function loadServiceConfig(): ServiceConfig | null {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ServiceConfig
  } catch {
    log.warn('[serviceClient] service.json not found — service not installed?')
    return null
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchService<T>(
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  if (!_config) throw new Error('Service config not loaded')
  const url = `http://127.0.0.1:${_config.port}${path}`
  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_config.secret}`
    },
    body: options?.body != null ? JSON.stringify(options.body) : undefined
  })
  if (!res.ok) throw new Error(`Service returned ${res.status}`)
  return res.json() as T
}

export const serviceApi = {
  getServers: () => fetchService<{ ok: true; data: unknown[] }>('/api/servers'),
  addServer: (body: unknown) => fetchService('/api/servers', { method: 'POST', body }),
  updateServer: (id: string, patch: unknown) =>
    fetchService(`/api/servers/${id}`, { method: 'PUT', body: patch }),
  removeServer: (id: string) => fetchService(`/api/servers/${id}`, { method: 'DELETE' }),
  migrateServers: (servers: unknown[]) =>
    fetchService('/api/servers/migrate', { method: 'POST', body: { servers } }),
  getAlerts: () => fetchService('/api/alerts'),
  acknowledgeAlert: (id: string) =>
    fetchService(`/api/alerts/${id}/acknowledge`, { method: 'POST' }),
  getSettings: () => fetchService('/api/settings'),
  updateSettings: (patch: unknown) => fetchService('/api/settings', { method: 'PUT', body: patch }),
  getMetricsHistoryBulk: () => fetchService('/api/metrics/history/bulk'),
  health: () => fetch(`http://127.0.0.1:${_config?.port ?? 57432}/health`).then((r) => r.json())
}

// ── WebSocket + push bridge ───────────────────────────────────────────────────

function pushToRenderer(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    // No isVisible() gate — same policy as the in-process push handler in
    // index.ts: a tray-hidden window must keep receiving service pushes or its
    // store goes stale until the next poll after restore. The renderer already
    // buffers updates while document.hidden, so nothing is wasted.
    if (!w.isDestroyed()) w.webContents.send(channel, data)
  })
}

// Ultimo stato PUBBLICATO ai listener — distinto da _status: 'connecting' è
// interno al ciclo di retry e non va mai pubblicato, altrimenti ogni tentativo
// (connecting→disconnected, ogni 5s) diventa una "transizione" che il renderer
// interpreta come nuova disconnessione → workerStart completo → job ricreati,
// pollCount azzerato (quindi mai persistenza, che scatta ogni SAVE_EVERY_N
// poll) e re-seed della history dal DB a ogni retry.
let _publishedStatus: ServiceStatus | null = null

function setStatus(s: ServiceStatus): void {
  _status = s
  if (s === 'connecting') return
  if (s === _publishedStatus) return
  _publishedStatus = s
  _statusListeners.forEach((fn) => fn(s))
}

export function onStatusChange(fn: (s: ServiceStatus) => void): void {
  _statusListeners.push(fn)
}

export function getStatus(): ServiceStatus {
  return _status
}

export function sendToService(msg: WsClientMessage): void {
  if (_ws?.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(msg))
  }
}

function scheduleReconnect(): void {
  if (_reconnectTimer) return
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null
    connect()
  }, 5_000)
}

export function connect(): void {
  if (!_config) {
    _config = loadServiceConfig()
    if (!_config) {
      setStatus('disconnected')
      return
    }
  }

  setStatus('connecting')
  // Auth via Authorization header (not querystring) so the secret never lands
  // in URL logs or process listings. Server-side rejects connections that
  // present an Origin header (browser tabs) or come from non-loopback.
  const url = `ws://127.0.0.1:${_config.port}/`
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${_config.secret}` }
  })
  _ws = ws

  ws.on('open', () => {
    log.info('[serviceClient] Connected to service')
    setStatus('connected')
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as WsPushMessage
      if (msg.type === 'service:ready') return
      pushToRenderer(msg.type, (msg as { data?: unknown }).data)
    } catch {
      // ignore
    }
  })

  ws.on('close', () => {
    log.warn('[serviceClient] Disconnected — retrying in 5s')
    setStatus('disconnected')
    scheduleReconnect()
  })

  ws.on('error', (err) => {
    log.error('[serviceClient] WS error:', err.message)
  })
}

export function disconnect(): void {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
  _ws?.close()
  _ws = null
  setStatus('disconnected')
}
