"""
Generate structured DBA reference cards in the Obsidian vault.

Each card covers one diagnostic topic with:
  - Precise title (keywords for FTS matching)
  - 2-3 sentence explanation
  - T-SQL query in a fenced code block
  - "When to use" bullets

Run:
    python generate_dba_refs.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from config import VAULT_DIR, DB_PATH
from md_to_sqlite import sync_vault_to_sqlite

OUTPUT_DIR = VAULT_DIR / "DBA Reference"

# ---------------------------------------------------------------------------
# Reference card definitions
# ---------------------------------------------------------------------------

CARDS: list[dict] = [
    {
        "slug": "compatibility-level",
        "title": "Check Database Compatibility Level",
        "tags": ["tsql", "compatibility-level", "database-configuration"],
        "explanation": (
            "The compatibility level controls which SQL Server features and query optimizer "
            "behaviors are active for a database. It can differ from the SQL Server version "
            "and is not updated automatically after an engine upgrade."
        ),
        "query": """\
SELECT
  name,
  compatibility_level,
  CASE compatibility_level
    WHEN 160 THEN 'SQL Server 2022'
    WHEN 150 THEN 'SQL Server 2019'
    WHEN 140 THEN 'SQL Server 2017'
    WHEN 130 THEN 'SQL Server 2016'
    WHEN 120 THEN 'SQL Server 2014'
    WHEN 110 THEN 'SQL Server 2012'
    ELSE 'Other/Unknown'
  END AS version_label,
  state_desc,
  user_access_desc
FROM sys.databases
ORDER BY name""",
        "when_to_use": [
            "After a SQL Server upgrade to verify databases have not been updated to the new level.",
            "When diagnosing unexpected query plan changes after an engine upgrade.",
            "Before changing the compatibility level of a database.",
        ],
    },
    {
        "slug": "blocking-sessions",
        "title": "Check Blocking Sessions",
        "tags": ["tsql", "blocking", "sessions", "performance"],
        "explanation": (
            "Blocking occurs when one session holds a lock that another session needs. "
            "Identifying the blocking chain (head blocker and blocked sessions) is the "
            "first step in resolving concurrency problems."
        ),
        "query": """\
SELECT
  r.session_id,
  r.blocking_session_id,
  r.wait_type,
  r.wait_time / 1000.0          AS wait_sec,
  r.status,
  DB_NAME(r.database_id)        AS db_name,
  SUBSTRING(st.text,
    (r.statement_start_offset / 2) + 1,
    ((CASE r.statement_end_offset
        WHEN -1 THEN DATALENGTH(st.text)
        ELSE r.statement_end_offset
      END - r.statement_start_offset) / 2) + 1
  )                              AS current_statement
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE r.blocking_session_id > 0
ORDER BY r.wait_time DESC""",
        "when_to_use": [
            "When users report slow or hanging queries.",
            "When CPU is low but throughput is poor (lock contention, not resource starvation).",
        ],
    },
    {
        "slug": "cpu-intensive-queries",
        "title": "Check CPU-Intensive Queries",
        "tags": ["tsql", "cpu", "performance", "query-tuning"],
        "explanation": (
            "High CPU is often caused by a small number of queries that run frequently or "
            "perform excessive work per execution. This query surfaces the top offenders "
            "from the plan cache."
        ),
        "query": """\
SELECT TOP 10
  qs.total_worker_time / qs.execution_count  AS avg_cpu_us,
  qs.total_worker_time                       AS total_cpu_us,
  qs.execution_count,
  SUBSTRING(st.text, 1, 250)                 AS query_text,
  qp.query_plan
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
ORDER BY qs.total_worker_time DESC""",
        "when_to_use": [
            "When overall CPU usage on the SQL Server instance is high.",
            "To find queries that benefit most from an index or rewrite.",
        ],
    },
    {
        "slug": "slow-queries-elapsed-time",
        "title": "Check Slow Queries by Elapsed Time",
        "tags": ["tsql", "slow-queries", "performance", "elapsed-time"],
        "explanation": (
            "Slow elapsed time can indicate CPU pressure, I/O waits, blocking, or "
            "missing indexes. This query ranks cached plans by total and average "
            "elapsed time."
        ),
        "query": """\
SELECT TOP 10
  qs.total_elapsed_time / qs.execution_count  AS avg_elapsed_us,
  qs.total_elapsed_time                       AS total_elapsed_us,
  qs.execution_count,
  SUBSTRING(st.text, 1, 250)                  AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_elapsed_time DESC""",
        "when_to_use": [
            "When applications report timeouts or slow response times.",
            "As a starting point for query tuning sessions.",
        ],
    },
    {
        "slug": "backup-status",
        "title": "Check Database Backup Status",
        "tags": ["tsql", "backup", "recovery", "msdb"],
        "explanation": (
            "Regular backups are essential for recovery. This query shows the most recent "
            "full, differential, and log backups for each database, making it easy to "
            "spot databases that have not been backed up recently."
        ),
        "query": """\
SELECT
  d.name                                          AS database_name,
  MAX(CASE b.type WHEN 'D' THEN b.backup_finish_date END) AS last_full,
  MAX(CASE b.type WHEN 'I' THEN b.backup_finish_date END) AS last_diff,
  MAX(CASE b.type WHEN 'L' THEN b.backup_finish_date END) AS last_log,
  DATEDIFF(HOUR,
    MAX(CASE b.type WHEN 'D' THEN b.backup_finish_date END),
    GETDATE())                                    AS hours_since_full
FROM sys.databases d
LEFT JOIN msdb.dbo.backupset b
  ON d.name = b.database_name
  AND b.backup_finish_date > DATEADD(DAY, -30, GETDATE())
WHERE d.database_id > 4          -- exclude system databases
GROUP BY d.name
ORDER BY hours_since_full DESC""",
        "when_to_use": [
            "As part of daily DBA health checks.",
            "Before maintenance windows or patching.",
            "When auditing recovery point objectives (RPO).",
        ],
    },
    {
        "slug": "disk-space",
        "title": "Check Disk Space (Volume Stats)",
        "tags": ["tsql", "disk", "storage", "capacity"],
        "explanation": (
            "Running out of disk space can cause databases to go offline. "
            "sys.dm_os_volume_stats returns free and total space for the volumes "
            "hosting database files."
        ),
        "query": """\
SELECT DISTINCT
  vs.volume_mount_point,
  vs.total_bytes / 1073741824.0   AS total_gb,
  vs.available_bytes / 1073741824.0 AS free_gb,
  CAST(vs.available_bytes * 100.0 / vs.total_bytes AS DECIMAL(5,1)) AS free_pct
FROM sys.master_files mf
CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs
ORDER BY free_pct""",
        "when_to_use": [
            "During daily health checks.",
            "When databases report 'could not allocate space' errors.",
            "When planning capacity for new databases or data growth.",
        ],
    },
    {
        "slug": "active-connections",
        "title": "Check Active Connections and Sessions",
        "tags": ["tsql", "connections", "sessions", "users"],
        "explanation": (
            "Too many connections can exhaust the connection pool or indicate a "
            "connection leak. This query groups active user sessions by database "
            "and login."
        ),
        "query": """\
SELECT
  DB_NAME(s.database_id)   AS db_name,
  s.login_name,
  COUNT(*)                 AS session_count,
  SUM(CASE WHEN r.session_id IS NOT NULL THEN 1 ELSE 0 END) AS active_requests
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
WHERE s.is_user_process = 1
GROUP BY s.database_id, s.login_name
ORDER BY session_count DESC""",
        "when_to_use": [
            "When the application reports 'max pool size reached' errors.",
            "To audit which logins are connected and how many sessions each holds.",
        ],
    },
    {
        "slug": "always-on-health",
        "title": "Check Always On Availability Group Health",
        "tags": ["tsql", "always-on", "availability-group", "hadr", "high-availability"],
        "explanation": (
            "Always On Availability Groups provide high availability and disaster recovery. "
            "This query shows synchronization state, role, and lag metrics for every "
            "replica and database in all AGs."
        ),
        "query": """\
SELECT
  ag.name                            AS ag_name,
  ar.replica_server_name             AS replica,
  ar.availability_mode_desc,
  ar.failover_mode_desc,
  ars.role_desc                      AS role,
  ars.connected_state_desc,
  ars.synchronization_health_desc    AS sync_health,
  drs.database_name,
  drs.synchronization_state_desc     AS db_sync_state,
  drs.log_send_queue_size            AS log_send_queue_kb,
  drs.redo_queue_size                AS redo_queue_kb,
  drs.last_commit_time
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar
  ON ag.group_id = ar.group_id
JOIN sys.dm_hadr_availability_replica_states ars
  ON ar.replica_id = ars.replica_id
LEFT JOIN sys.dm_hadr_database_replica_states drs
  ON ars.replica_id = drs.replica_id
ORDER BY ag.name, ars.role_desc, ar.replica_server_name""",
        "when_to_use": [
            "During daily health checks for HA/DR environments.",
            "When failover has occurred or is planned.",
            "When replication lag (log send / redo queue) is suspected.",
        ],
    },
    {
        "slug": "missing-indexes",
        "title": "Check Missing Index Recommendations",
        "tags": ["tsql", "missing-indexes", "performance", "index-tuning"],
        "explanation": (
            "SQL Server records index recommendations generated by the query optimizer. "
            "This query surfaces the most impactful missing indexes sorted by the "
            "estimated improvement they would provide."
        ),
        "query": """\
SELECT TOP 20
  ROUND(migs.avg_total_user_cost
    * migs.avg_user_impact
    * (migs.user_seeks + migs.user_scans), 0) AS estimated_improvement,
  migs.user_seeks,
  migs.user_scans,
  DB_NAME(mid.database_id)           AS db_name,
  mid.object_id,
  OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
  mid.equality_columns,
  mid.inequality_columns,
  mid.included_columns,
  'CREATE INDEX IX_' + OBJECT_NAME(mid.object_id, mid.database_id)
    + '_' + REPLACE(ISNULL(mid.equality_columns,''), ', ', '_')
    + ' ON ' + mid.statement
    + ' (' + ISNULL(mid.equality_columns,'')
    + ISNULL(', ' + mid.inequality_columns,'') + ')'
    + ISNULL(' INCLUDE (' + mid.included_columns + ')', '')
                                     AS create_index_ddl
FROM sys.dm_db_missing_index_groups mig
JOIN sys.dm_db_missing_index_group_stats migs
  ON mig.index_group_handle = migs.group_handle
JOIN sys.dm_db_missing_index_details mid
  ON mig.index_handle = mid.index_handle
ORDER BY estimated_improvement DESC""",
        "when_to_use": [
            "After identifying slow queries to find the best index candidates.",
            "As part of a periodic performance review (DMVs reset on restart).",
        ],
    },
    {
        "slug": "wait-statistics",
        "title": "Check SQL Server Wait Statistics",
        "tags": ["tsql", "wait-statistics", "waits", "performance", "bottleneck"],
        "explanation": (
            "Wait statistics reveal the primary bottleneck on a SQL Server instance. "
            "High CXPACKET suggests parallelism issues, PAGEIOLATCH_* points to I/O, "
            "LCK_M_* indicates locking. Waits accumulate since the last SQL Server restart."
        ),
        "query": """\
SELECT TOP 15
  wait_type,
  waiting_tasks_count,
  wait_time_ms / 1000.0              AS wait_time_sec,
  max_wait_time_ms / 1000.0          AS max_wait_sec,
  (wait_time_ms - signal_wait_time_ms) / 1000.0 AS resource_wait_sec,
  CAST(100.0 * wait_time_ms
    / SUM(wait_time_ms) OVER ()
    AS DECIMAL(5,2))                 AS pct_of_total
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
  'SLEEP_TASK','BROKER_TO_FLUSH','BROKER_TASK_STOP','CLR_AUTO_EVENT',
  'DISPATCHER_QUEUE_SEMAPHORE','FT_IFTS_SCHEDULER_IDLE_WAIT',
  'HADR_FILESTREAM_IOMGR_IOCOMPLETION','HADR_WORK_QUEUE',
  'LAZYWRITER_SLEEP','LOGMGR_QUEUE','ONDEMAND_TASK_QUEUE',
  'REQUEST_FOR_DEADLOCK_SEARCH','RESOURCE_QUEUE','SERVER_IDLE_CHECK',
  'SLEEP_DBSTARTUP','SLEEP_DCOMSTARTUP','SLEEP_MASTERDBREADY',
  'SLEEP_MASTERMDREADY','SLEEP_MASTERUPGRADED','SLEEP_MSDBSTARTUP',
  'SLEEP_SYSTEMTASK','SLEEP_TEMPDBSTARTUP','SNI_HTTP_ACCEPT',
  'SP_SERVER_DIAGNOSTICS_SLEEP','SQLTRACE_BUFFER_FLUSH',
  'WAITFOR','XE_DISPATCHER_WAIT','XE_TIMER_EVENT'
)
ORDER BY wait_time_ms DESC""",
        "when_to_use": [
            "As the first step in any performance investigation.",
            "To classify the type of bottleneck: CPU, I/O, memory, or locking.",
        ],
    },
    {
        "slug": "index-fragmentation",
        "title": "Check Index Fragmentation",
        "tags": ["tsql", "index-fragmentation", "index-maintenance", "performance"],
        "explanation": (
            "Fragmented indexes degrade query performance due to additional I/O. "
            "Indexes with avg_fragmentation > 30% should be rebuilt; those between "
            "5-30% should be reorganized."
        ),
        "query": """\
SELECT
  DB_NAME()                          AS db_name,
  OBJECT_NAME(ips.object_id)         AS table_name,
  i.name                             AS index_name,
  ips.index_type_desc,
  ROUND(ips.avg_fragmentation_in_percent, 1) AS fragmentation_pct,
  ips.page_count
FROM sys.dm_db_index_physical_stats(
    DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
JOIN sys.indexes i
  ON ips.object_id = i.object_id
  AND ips.index_id = i.index_id
WHERE ips.avg_fragmentation_in_percent > 5
  AND ips.page_count > 100
ORDER BY ips.avg_fragmentation_in_percent DESC""",
        "when_to_use": [
            "Before scheduling index maintenance (rebuild/reorganize) jobs.",
            "After bulk data loads that may have caused fragmentation.",
        ],
    },
    {
        "slug": "database-sizes",
        "title": "Check Database File Sizes",
        "tags": ["tsql", "database-size", "storage", "capacity"],
        "explanation": (
            "Tracking database file sizes helps with capacity planning and identifying "
            "unexpected data growth. This query reports size and free space for every "
            "data and log file."
        ),
        "query": """\
SELECT
  DB_NAME(mf.database_id)             AS db_name,
  mf.name                             AS logical_name,
  mf.type_desc,
  mf.physical_name,
  mf.size * 8 / 1024.0               AS size_mb,
  FILEPROPERTY(mf.name, 'SpaceUsed') * 8 / 1024.0 AS used_mb,
  (mf.size - FILEPROPERTY(mf.name, 'SpaceUsed')) * 8 / 1024.0 AS free_mb
FROM sys.master_files mf
ORDER BY db_name, mf.type_desc""",
        "when_to_use": [
            "During capacity planning reviews.",
            "When a database grows unexpectedly.",
            "To identify log files that are not being truncated (full recovery model with no log backups).",
        ],
    },
]

# ---------------------------------------------------------------------------
# Card generation
# ---------------------------------------------------------------------------

def _render_card(card: dict) -> str:
    tags_yaml = "\n".join(f"  - {t}" for t in card["tags"])
    when_bullets = "\n".join(f"- {w}" for w in card["when_to_use"])
    return f"""\
---
title: {card['title']}
tags:
{tags_yaml}
type: dba-reference
---

# {card['title']}

{card['explanation']}

## T-SQL Query

```sql
{card['query']}
```

## When to Use

{when_bullets}
"""


def generate_cards(output_dir: Path) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for card in CARDS:
        path = output_dir / f"DBA - {card['title']}.md"
        content = _render_card(card)
        path.write_text(content, encoding="utf-8")
        print(f"  OK  {path.name}")
        count += 1
    return count


if __name__ == "__main__":
    print(f"Generating DBA reference cards -> {OUTPUT_DIR}")
    n = generate_cards(OUTPUT_DIR)
    print(f"\nGenerated {n} cards. Syncing to SQLite...")
    from config import DB_PATH, VAULT_DIR
    sync_vault_to_sqlite(VAULT_DIR, DB_PATH)
    print("Done.")
