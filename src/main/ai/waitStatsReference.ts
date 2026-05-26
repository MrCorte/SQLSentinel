/**
 * Curated reference for the wait types most relevant to DBA diagnosis.
 * Injected into the agent prompt as <<WAIT_STATS_REFERENCE>> when the user's
 * question or the recent alerts mention waits — saves the model from having
 * to "remember" what each one means.
 *
 * Sources: SQL Server docs, Paul Randal's wait-stats reference, MS SS guides.
 * Keep entries terse: meaning (≤80 chars), fix (≤120 chars).
 */

export interface WaitStatEntry {
  type: string
  category: 'lock' | 'io' | 'memory' | 'cpu' | 'network' | 'log' | 'parallelism' | 'latch' | 'other'
  meaning: string
  fix: string
}

export const WAIT_STATS: WaitStatEntry[] = [
  // ── Locking ───────────────────────────────────────────────────────────────
  { type: 'LCK_M_S',      category: 'lock', meaning: 'Waiting for a shared lock (read).',
    fix: 'Identify blocker: sys.dm_exec_requests blocking_session_id. Consider RCSI or shorter transactions.' },
  { type: 'LCK_M_X',      category: 'lock', meaning: 'Waiting for an exclusive lock (write).',
    fix: 'Long-running update/delete or blocked by another writer. Investigate sys.dm_tran_locks.' },
  { type: 'LCK_M_U',      category: 'lock', meaning: 'Waiting for an update lock.',
    fix: 'Often precedes LCK_M_X. Same diagnosis path.' },
  { type: 'LCK_M_IS',     category: 'lock', meaning: 'Waiting for intent shared lock at higher granularity.',
    fix: 'Reader blocked by writer at table/page level.' },
  { type: 'LCK_M_IX',     category: 'lock', meaning: 'Waiting for intent exclusive lock.',
    fix: 'Writer blocked at higher granularity — check escalation thresholds.' },
  { type: 'LCK_M_SCH_M',  category: 'lock', meaning: 'Schema modification lock — table being altered.',
    fix: 'DDL operation in progress. Wait or cancel the alter.' },
  { type: 'LCK_M_SCH_S',  category: 'lock', meaning: 'Schema stability lock — query compiling against schema.',
    fix: 'Blocked by concurrent DDL. Short waits normal.' },

  // ── IO ────────────────────────────────────────────────────────────────────
  { type: 'PAGEIOLATCH_SH', category: 'io', meaning: 'Waiting for data page read from disk (shared).',
    fix: 'Slow IO or insufficient buffer pool. Check disk latency, add memory, review missing indexes.' },
  { type: 'PAGEIOLATCH_EX', category: 'io', meaning: 'Waiting for data page write/read (exclusive).',
    fix: 'Slow IO subsystem or contention. Check disk perfmon counters, tempdb file count.' },
  { type: 'PAGEIOLATCH_UP', category: 'io', meaning: 'Waiting for data page IO (update intent).',
    fix: 'Same as PAGEIOLATCH_EX — disk subsystem analysis.' },
  { type: 'IO_COMPLETION',  category: 'io', meaning: 'Waiting for non-data file IO (e.g. log shipping, backups).',
    fix: 'Check disk throughput; co-locate log and tempdb on fast storage.' },
  { type: 'WRITELOG',       category: 'log', meaning: 'Waiting for transaction log flush.',
    fix: 'Slow log disk or sync replicas (AG). Use dedicated fast disk for the log file.' },
  { type: 'LOGBUFFER',      category: 'log', meaning: 'Waiting for space in the log buffer.',
    fix: 'High commit rate. Batch transactions or use delayed durability for non-critical workloads.' },

  // ── Memory ────────────────────────────────────────────────────────────────
  { type: 'RESOURCE_SEMAPHORE',       category: 'memory', meaning: 'Waiting for query memory grant.',
    fix: 'Memory-intensive query starved. Check estimated/granted memory in sys.dm_exec_query_memory_grants.' },
  { type: 'RESOURCE_SEMAPHORE_QUERY_COMPILE', category: 'memory', meaning: 'Waiting for compile memory.',
    fix: 'Too many concurrent compilations. Use Forced Parameterization or parameter sniffing fixes.' },
  { type: 'CMEMTHREAD',               category: 'memory', meaning: 'Memory object contention.',
    fix: 'High plan cache churn. Investigate ad-hoc workload and optimize-for-ad-hoc setting.' },

  // ── CPU / Parallelism ─────────────────────────────────────────────────────
  { type: 'SOS_SCHEDULER_YIELD', category: 'cpu', meaning: 'Thread voluntarily yielding — CPU pressure.',
    fix: 'High signal_wait_time means CPU bottleneck. Tune queries, add cores, lower MAXDOP.' },
  { type: 'CXPACKET',            category: 'parallelism', meaning: 'Parallel query coordination wait (producer side).',
    fix: 'Normal in OLAP. If excessive in OLTP, raise cost threshold for parallelism, lower MAXDOP.' },
  { type: 'CXCONSUMER',          category: 'parallelism', meaning: 'Parallel consumer waiting for data — usually benign.',
    fix: 'Ignore unless paired with high SOS_SCHEDULER_YIELD or PAGEIOLATCH.' },
  { type: 'EXCHANGE',            category: 'parallelism', meaning: 'Parallel exchange operator wait.',
    fix: 'Skew in parallel plan. Check for missing/stale statistics on join columns.' },

  // ── Latches (in-memory) ───────────────────────────────────────────────────
  { type: 'PAGELATCH_SH',        category: 'latch', meaning: 'In-memory page latch wait (shared) — often tempdb allocation.',
    fix: 'Add tempdb files (1 per core up to 8). Trace flag 1118 / 1117 on older versions.' },
  { type: 'PAGELATCH_EX',        category: 'latch', meaning: 'In-memory page latch wait (exclusive) — tempdb GAM/SGAM contention.',
    fix: 'Classic tempdb contention. Same fix as PAGELATCH_SH.' },
  { type: 'PAGELATCH_UP',        category: 'latch', meaning: 'In-memory page latch (update intent).',
    fix: 'Same family — tempdb scaling.' },
  { type: 'LATCH_EX',            category: 'latch', meaning: 'Non-buffer latch (exclusive) — system structure contention.',
    fix: 'Investigate by sub_type via sys.dm_os_latch_stats.' },

  // ── Network ───────────────────────────────────────────────────────────────
  { type: 'ASYNC_NETWORK_IO',    category: 'network', meaning: 'Server waiting for client to consume results.',
    fix: 'Slow client / row-by-row processing on the client. Usually NOT a server problem.' },

  // ── AlwaysOn / HADR ───────────────────────────────────────────────────────
  { type: 'HADR_SYNC_COMMIT',    category: 'other', meaning: 'Waiting for sync replica to harden the transaction.',
    fix: 'Network latency or slow log disk on replica. Check sys.dm_hadr_database_replica_states.' },
  { type: 'HADR_LOGCAPTURE_WAIT', category: 'other', meaning: 'AG log capture wait — usually benign idle wait.',
    fix: 'Background process waiting for log records. Ignore unless excessive.' },
  { type: 'DBMIRROR_SEND',       category: 'other', meaning: 'Database mirroring send wait.',
    fix: 'Network bottleneck to mirror partner. Check throughput.' },

  // ── Backup ────────────────────────────────────────────────────────────────
  { type: 'BACKUPIO',            category: 'io', meaning: 'Backup waiting on IO.',
    fix: 'Backup target disk slow. Use compression, parallelize with MAXDEVICES.' },
  { type: 'BACKUPBUFFER',        category: 'io', meaning: 'Backup waiting for buffer.',
    fix: 'Source disk read slow. Same fix as BACKUPIO.' },

  // ── Other notable ─────────────────────────────────────────────────────────
  { type: 'THREADPOOL',          category: 'other', meaning: 'Worker thread starvation.',
    fix: 'Max worker threads exhausted. Reduce concurrency, check parallelism, add cores.' },
  { type: 'OLEDB',               category: 'other', meaning: 'Linked server / OLEDB provider wait.',
    fix: 'External data source slow. Usually unfixable from SQL side.' },
  { type: 'WAITFOR',             category: 'other', meaning: 'Explicit WAITFOR DELAY/TIME — benign.',
    fix: 'No action.' },
  { type: 'SLEEP_BPOOL_FLUSH',   category: 'other', meaning: 'Background buffer pool lazywriter activity.',
    fix: 'Normal background activity. Investigate only if dominant.' },
  { type: 'PREEMPTIVE_OS_AUTHENTICATIONOPS', category: 'other', meaning: 'OS auth/Active Directory call from SQL Server.',
    fix: 'Slow domain controller / Kerberos. Check AD health.' }
]

const WAIT_TYPE_SET = new Set(WAIT_STATS.map((w) => w.type))
const WAIT_KEYWORDS = ['wait', 'attes', 'blocking', 'lock', 'latch', 'tempdb contention', 'parallelism', 'cxpacket']

// Returns true if the question text or any of the surrounding context (e.g.
// recent alert messages) mentions a known wait type or a wait-stats keyword.
export function shouldInjectWaitStats(question: string, contextText: string): boolean {
  const blob = `${question}\n${contextText}`.toLowerCase()
  if (WAIT_KEYWORDS.some((kw) => blob.includes(kw))) return true
  for (const wt of WAIT_TYPE_SET) {
    if (blob.includes(wt.toLowerCase())) return true
  }
  return false
}

// Selects entries to inject. If specific wait types are named in the context,
// return only those; otherwise return a curated common subset.
export function selectRelevantWaitStats(question: string, contextText: string): WaitStatEntry[] {
  const blob = `${question}\n${contextText}`.toLowerCase()
  const explicit = WAIT_STATS.filter((w) => blob.includes(w.type.toLowerCase()))
  if (explicit.length > 0) return explicit
  // Fallback: most common diagnostic targets when the conversation is generic.
  const commonTypes = new Set([
    'LCK_M_X', 'PAGEIOLATCH_SH', 'PAGEIOLATCH_EX', 'WRITELOG',
    'RESOURCE_SEMAPHORE', 'SOS_SCHEDULER_YIELD', 'CXPACKET',
    'PAGELATCH_EX', 'ASYNC_NETWORK_IO', 'HADR_SYNC_COMMIT'
  ])
  return WAIT_STATS.filter((w) => commonTypes.has(w.type))
}

export function formatWaitStatsBlock(entries: WaitStatEntry[]): string {
  return entries
    .map((w) => `[${w.type} | ${w.category}] ${w.meaning}\n  → ${w.fix}`)
    .join('\n')
}
