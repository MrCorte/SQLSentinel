import * as net from 'net'
import { DiscoveredServer, ScanOptions, ScanProgress } from './types'
import { expandCidr } from './cidrUtils'

// Hard cap on concurrency: Windows ephemeral port range tops out around 16k —
// pushing concurrency above 200 risks EADDRINUSE storms and FD pressure.
const MAX_CONCURRENCY = 200

/**
 * Attempts a TCP connection to a single host:port.
 * Returns a DiscoveredServer regardless of outcome — never throws.
 * Uses only net.Socket (no PowerShell, no UDP, no SQL Browser).
 * Cancellable via AbortSignal: aborting destroys the socket immediately.
 */
export function scanHost(
  ip: string,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<DiscoveredServer> {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const socket = new net.Socket()
    let settled = false

    // Explicit timer for TCP handshake: Node's socket.setTimeout() measures
    // inactivity and does not deterministically bound the SYN→SYN-ACK duration.
    // With this timer the project's 500ms constraint is enforced even on slow
    // networks or firewalls that drop packets.
    const handshakeTimer = setTimeout(() => cleanup(false), timeoutMs)

    const onAbort = (): void => cleanup(false)
    if (signal) {
      if (signal.aborted) {
        // Already aborted before we started: short-circuit.
        clearTimeout(handshakeTimer)
        socket.destroy()
        resolve({
          ip,
          port,
          reachable: false,
          responseTimeMs: 0,
          discoveredAt: new Date()
        })
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const cleanup = (reachable: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(handshakeTimer)
      signal?.removeEventListener('abort', onAbort)
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
 * Lazy task generator: yields ip×port combinations on demand without
 * materializing the full Cartesian product up-front. A /16 with 3 ports would
 * otherwise allocate ~196k task objects (~10 MB) before scanning starts.
 */
function* taskIterator(
  ips: string[],
  ports: number[]
): IterableIterator<{ ip: string; port: number }> {
  for (const ip of ips) {
    for (const port of ports) {
      yield { ip, port }
    }
  }
}

/**
 * Scans all IP:port combinations derived from the given CIDR and port list.
 * Runs at most `options.concurrency` concurrent probes (default 50, hard cap 200).
 * Calls onProgress after each probe completes.
 * Returns only reachable servers.
 *
 * Cancellation: pass an AbortSignal to stop the scan early. In-flight probes
 * resolve as unreachable; pending probes are skipped.
 */
export async function scanSubnet(
  options: ScanOptions,
  onProgress?: (progress: ScanProgress) => void,
  signal?: AbortSignal
): Promise<DiscoveredServer[]> {
  const { cidr, ports, timeoutMs, concurrency } = options

  const ips = expandCidr(cidr)
  const total = ips.length * ports.length
  if (total === 0) return []

  const iter = taskIterator(ips, ports)
  let completed = 0
  let found = 0
  const results: DiscoveredServer[] = []

  // Clamp concurrency: never above MAX_CONCURRENCY, never above the total work.
  const effectiveConcurrency = Math.max(
    1,
    Math.min(concurrency || 50, MAX_CONCURRENCY, total)
  )

  // Worker pool — each worker grabs the next task by pulling from the iterator.
  // iter.next() is synchronous-before-await so two workers cannot get the same task.
  const worker = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted) return
      const { value: task, done } = iter.next()
      if (done || !task) return
      const result = await scanHost(task.ip, task.port, timeoutMs, signal)
      completed++
      if (result.reachable) {
        found++
        results.push(result)
      }
      onProgress?.({ total, completed, found })
    }
  }

  await Promise.all(Array.from({ length: effectiveConcurrency }, () => worker()))

  return results
}
