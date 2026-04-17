import * as net from 'net'
import { DiscoveredServer, ScanOptions, ScanProgress } from './types'
import { expandCidr } from './cidrUtils'

/**
 * Attempts a TCP connection to a single host:port.
 * Returns a DiscoveredServer regardless of outcome — never throws.
 * Uses only net.Socket (no PowerShell, no UDP, no SQL Browser).
 */
export function scanHost(ip: string, port: number, timeoutMs: number): Promise<DiscoveredServer> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const socket = new net.Socket()
    let settled = false

    // Timer esplicito per l'handshake TCP: socket.setTimeout() di Node misura
    // l'inattività e non vincola deterministicamente la durata del SYN→SYN-ACK.
    // Con questo timer il vincolo 500ms del progetto è effettivo anche su reti
    // lente o firewall che dropano i pacchetti.
    const handshakeTimer = setTimeout(() => cleanup(false), timeoutMs)

    const cleanup = (reachable: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(handshakeTimer)
      socket.destroy()
      resolve({
        ip,
        port,
        reachable,
        responseTimeMs: Date.now() - startTime,
        discoveredAt: new Date()
      })
    }

    socket.setTimeout(timeoutMs)
    socket.on('connect', () => cleanup(true))
    socket.on('timeout', () => cleanup(false))
    socket.on('error', () => cleanup(false))
    socket.connect(port, ip)
  })
}

/**
 * Scans all IP:port combinations derived from the given CIDR and port list.
 * Runs at most `options.concurrency` concurrent probes (default 50).
 * Calls onProgress after each probe completes.
 * Returns only reachable servers.
 */
export async function scanSubnet(
  options: ScanOptions,
  onProgress?: (progress: ScanProgress) => void
): Promise<DiscoveredServer[]> {
  const { cidr, ports, timeoutMs, concurrency } = options

  const ips = expandCidr(cidr)

  // Build the flat task list: every ip × port combination
  const tasks: Array<{ ip: string; port: number }> = []
  for (const ip of ips) {
    for (const port of ports) {
      tasks.push({ ip, port })
    }
  }

  if (tasks.length === 0) return []

  const total = tasks.length
  let completed = 0
  let found = 0
  const results: DiscoveredServer[] = []

  // Worker pool — each worker grabs the next task via shared index.
  // index++ is safe in JS single-threaded event loop (read+increment before any await).
  let index = 0
  const worker = async (): Promise<void> => {
    while (index < tasks.length) {
      const task = tasks[index++]
      const result = await scanHost(task.ip, task.port, timeoutMs)
      completed++
      if (result.reachable) {
        found++
        results.push(result)
      }
      onProgress?.({ total, completed, found })
    }
  }

  const workerCount = Math.min(concurrency, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return results
}
