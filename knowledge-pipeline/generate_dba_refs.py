"""
Generate structured DBA reference cards in the Obsidian vault.
Run:  python generate_dba_refs.py
"""
from __future__ import annotations
import sys
from pathlib import Path
from config import VAULT_DIR, DB_PATH
from md_to_sqlite import sync_vault_to_sqlite

OUTPUT_DIR = VAULT_DIR / "DBA Reference"

CARDS: list[dict] = [
# ── COMPATIBILITY & VERSION ───────────────────────────────────────────────
{
"slug": "compatibility-level",
"title": "Check Database Compatibility Level",
"tags": ["tsql","compatibility-level","database-configuration"],
"explanation": "The compatibility level controls which SQL Server features and query optimizer behaviors are active for a database. It can differ from the SQL Server version and is not updated automatically after an engine upgrade.",
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
"when_to_use": ["After a SQL Server upgrade to verify databases have not been updated to the new level.","Before changing the compatibility level of a database."],
},
{
"slug": "sql-server-version",
"title": "Check SQL Server Version and Edition",
"tags": ["tsql","version","edition","instance-info"],
"explanation": "Knowing the exact SQL Server version, edition, and patch level is essential before any upgrade, troubleshooting session, or feature check. SERVERPROPERTY provides structured access to version metadata.",
"query": """\
SELECT
  SERVERPROPERTY('ProductVersion')      AS product_version,
  SERVERPROPERTY('ProductLevel')        AS product_level,
  SERVERPROPERTY('ProductUpdateLevel')  AS update_level,
  SERVERPROPERTY('Edition')             AS edition,
  SERVERPROPERTY('EngineEdition')       AS engine_edition,
  SERVERPROPERTY('MachineName')         AS machine_name,
  SERVERPROPERTY('InstanceName')        AS instance_name,
  SERVERPROPERTY('Collation')           AS server_collation,
  SERVERPROPERTY('IsHadrEnabled')       AS hadr_enabled,
  @@VERSION                             AS full_version_string""",
"when_to_use": ["Before opening a support ticket.","When verifying patch compliance.","Before using features only available in specific versions."],
},
{
"slug": "instance-uptime",
"title": "Check SQL Server Instance Uptime",
"tags": ["tsql","uptime","instance-info","restart"],
"explanation": "Instance uptime reveals when the last SQL Server restart occurred. DMV data (wait stats, plan cache, index usage) resets on restart, so uptime is critical context when interpreting these views.",
"query": """\
SELECT
  sqlserver_start_time                                    AS start_time,
  GETDATE()                                              AS current_time,
  DATEDIFF(DAY,   sqlserver_start_time, GETDATE())       AS uptime_days,
  DATEDIFF(HOUR,  sqlserver_start_time, GETDATE()) % 24  AS uptime_hours,
  DATEDIFF(MINUTE,sqlserver_start_time, GETDATE()) % 60  AS uptime_minutes
FROM sys.dm_os_sys_info""",
"when_to_use": ["When DMV data looks unexpectedly low (recent restart may have cleared accumulators).","To verify scheduled maintenance window restarts occurred."],
},
# ── PERFORMANCE ───────────────────────────────────────────────────────────
{
"slug": "wait-statistics",
"title": "Check SQL Server Wait Statistics",
"tags": ["tsql","wait-statistics","waits","performance","bottleneck"],
"explanation": "Wait statistics reveal the primary bottleneck on a SQL Server instance. High CXPACKET suggests parallelism issues, PAGEIOLATCH_* points to I/O, LCK_M_* indicates locking. Waits accumulate since the last SQL Server restart.",
"query": """\
SELECT TOP 15
  wait_type,
  waiting_tasks_count,
  wait_time_ms / 1000.0                                       AS wait_time_sec,
  max_wait_time_ms / 1000.0                                   AS max_wait_sec,
  (wait_time_ms - signal_wait_time_ms) / 1000.0               AS resource_wait_sec,
  CAST(100.0 * wait_time_ms / SUM(wait_time_ms) OVER ()
    AS DECIMAL(5,2))                                          AS pct_of_total
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
"when_to_use": ["As the first step in any performance investigation.","To classify the type of bottleneck: CPU, I/O, memory, or locking."],
},
{
"slug": "cpu-intensive-queries",
"title": "Check CPU-Intensive Queries",
"tags": ["tsql","cpu","performance","query-tuning"],
"explanation": "High CPU is often caused by a small number of queries that run frequently or perform excessive work per execution. This query surfaces the top offenders from the plan cache.",
"query": """\
SELECT TOP 10
  qs.total_worker_time / qs.execution_count AS avg_cpu_us,
  qs.total_worker_time                      AS total_cpu_us,
  qs.execution_count,
  SUBSTRING(st.text, 1, 250)                AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_worker_time DESC""",
"when_to_use": ["When overall CPU usage on the SQL Server instance is high.","To find queries that benefit most from an index or rewrite."],
},
{
"slug": "slow-queries-elapsed-time",
"title": "Check Slow Queries by Elapsed Time",
"tags": ["tsql","slow-queries","performance","elapsed-time"],
"explanation": "Slow elapsed time can indicate CPU pressure, I/O waits, blocking, or missing indexes. This query ranks cached plans by total and average elapsed time.",
"query": """\
SELECT TOP 10
  qs.total_elapsed_time / qs.execution_count AS avg_elapsed_us,
  qs.total_elapsed_time                      AS total_elapsed_us,
  qs.execution_count,
  SUBSTRING(st.text, 1, 250)                 AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_elapsed_time DESC""",
"when_to_use": ["When applications report timeouts or slow response times.","As a starting point for query tuning sessions."],
},
{
"slug": "top-io-queries",
"title": "Check Queries with Highest IO",
"tags": ["tsql","io","performance","query-tuning","reads"],
"explanation": "Queries with excessive logical reads are prime candidates for missing indexes or inefficient execution plans. Logical reads drive buffer pool pressure and slow down throughput.",
"query": """\
SELECT TOP 10
  qs.total_logical_reads / qs.execution_count  AS avg_logical_reads,
  qs.total_logical_reads,
  qs.total_physical_reads,
  qs.execution_count,
  SUBSTRING(st.text, 1, 250)                   AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
ORDER BY qs.total_logical_reads DESC""",
"when_to_use": ["When disk I/O is high and you need to identify the root cause queries.","In conjunction with missing index recommendations."],
},
{
"slug": "page-life-expectancy",
"title": "Check Page Life Expectancy (Buffer Pool Pressure)",
"tags": ["tsql","ple","memory","buffer-pool","performance"],
"explanation": "Page Life Expectancy (PLE) measures how long data pages stay in the buffer pool before being evicted. A PLE below 300 seconds (per 4 GB of RAM) indicates memory pressure. Modern guidance: PLE < RAM_GB * 75 is a concern.",
"query": """\
SELECT
  object_name,
  counter_name,
  instance_name,
  cntr_value                         AS ple_seconds
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Page life expectancy'
  AND object_name LIKE '%Buffer Manager%'
UNION ALL
SELECT
  object_name,
  counter_name,
  instance_name,
  cntr_value
FROM sys.dm_os_performance_counters
WHERE counter_name = 'Page life expectancy'
  AND object_name LIKE '%Buffer Node%'
ORDER BY object_name""",
"when_to_use": ["When memory pressure is suspected.","As part of a daily health check baseline.","Before and after adding RAM to the server."],
},
{
"slug": "buffer-cache-hit-ratio",
"title": "Check Buffer Cache Hit Ratio",
"tags": ["tsql","buffer-cache","memory","performance"],
"explanation": "The buffer cache hit ratio shows what percentage of data page requests are served from memory rather than disk. Values below 95% in an OLTP workload indicate insufficient RAM or excessive I/O.",
"query": """\
SELECT
  CAST(a.cntr_value * 100.0 / b.cntr_value AS DECIMAL(6,2)) AS buffer_cache_hit_ratio_pct
FROM sys.dm_os_performance_counters a
JOIN sys.dm_os_performance_counters b
  ON a.object_name = b.object_name
WHERE a.counter_name = 'Buffer cache hit ratio'
  AND b.counter_name = 'Buffer cache hit ratio base'""",
"when_to_use": ["When diagnosing whether additional RAM would help performance.","During baseline performance assessments."],
},
{
"slug": "memory-clerks-top10",
"title": "Check Top Memory Clerks",
"tags": ["tsql","memory","memory-clerks","performance"],
"explanation": "Memory clerks are internal SQL Server components that allocate memory for different purposes (buffer pool, plan cache, locks, sort operations, etc.). Identifying the largest clerks helps diagnose memory pressure.",
"query": """\
SELECT TOP 10
  type                            AS clerk_type,
  name,
  pages_kb / 1024.0               AS memory_mb,
  virtual_memory_committed_kb / 1024.0 AS virtual_mem_mb
FROM sys.dm_os_memory_clerks
ORDER BY pages_kb DESC""",
"when_to_use": ["When overall memory usage is high and you need to find which component is consuming it.","When diagnosing out-of-memory errors."],
},
{
"slug": "memory-by-database",
"title": "Check Buffer Pool Usage per Database",
"tags": ["tsql","memory","buffer-pool","database-memory"],
"explanation": "The buffer pool caches data pages from all databases. This query shows how much memory each database is consuming, helping identify databases that are monopolising the buffer pool.",
"query": """\
SELECT
  ISNULL(DB_NAME(database_id), 'Resource/System') AS db_name,
  COUNT(*) * 8 / 1024                             AS buffer_pool_mb,
  COUNT(*)                                        AS page_count
FROM sys.dm_os_buffer_descriptors
GROUP BY database_id
ORDER BY buffer_pool_mb DESC""",
"when_to_use": ["When total memory usage is high and you need to identify which database is using most of the buffer pool."],
},
{
"slug": "plan-cache-pollution",
"title": "Check Plan Cache Pollution (Single-Use Plans)",
"tags": ["tsql","plan-cache","performance","memory","adhoc"],
"explanation": "Ad-hoc queries that are not parameterised generate a new plan for each unique query text, filling the plan cache with single-use plans. This wastes memory and increases compile times.",
"query": """\
SELECT
  objtype                        AS plan_type,
  COUNT(*)                       AS plan_count,
  SUM(size_in_bytes) / 1048576.0 AS total_size_mb,
  SUM(CASE WHEN usecounts = 1 THEN 1 ELSE 0 END) AS single_use_count,
  CAST(100.0 * SUM(CASE WHEN usecounts = 1 THEN 1 ELSE 0 END) / COUNT(*)
    AS DECIMAL(5,1))             AS single_use_pct
FROM sys.dm_exec_cached_plans
GROUP BY objtype
ORDER BY total_size_mb DESC""",
"when_to_use": ["When plan cache size is large but PLE is low.","Before enabling 'Optimize for Ad hoc Workloads' server option."],
},
{
"slug": "sql-recompilations",
"title": "Check Queries with High Recompilation Rate",
"tags": ["tsql","recompilation","performance","plan-cache"],
"explanation": "Excessive recompilations waste CPU because SQL Server has to regenerate execution plans repeatedly. Common causes include schema changes during execution, SET options changing, or temp table modifications.",
"query": """\
SELECT TOP 10
  qs.sql_handle,
  qs.plan_generation_num,
  qs.execution_count,
  qs.plan_generation_num / NULLIF(qs.execution_count, 0) AS recompile_ratio,
  SUBSTRING(st.text, 1, 250)                              AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
WHERE qs.plan_generation_num > 1
ORDER BY qs.plan_generation_num DESC""",
"when_to_use": ["When CPU usage is high and it correlates with compilation activity (sys.dm_exec_query_stats plan_generation_num)."],
},
{
"slug": "batch-requests-per-sec",
"title": "Check Batch Requests and SQL Compilations per Second",
"tags": ["tsql","batch-requests","throughput","performance"],
"explanation": "Batch requests per second measures server throughput. SQL compilations/sec above 10% of batch requests may indicate plan cache issues. Recompilations/sec should be minimal.",
"query": """\
SELECT
  counter_name,
  cntr_value   AS current_value
FROM sys.dm_os_performance_counters
WHERE object_name LIKE '%SQL Statistics%'
  AND counter_name IN (
    'Batch Requests/sec',
    'SQL Compilations/sec',
    'SQL Re-Compilations/sec',
    'Auto-Param Attempts/sec',
    'Failed Auto-Params/sec',
    'Safe Auto-Params/sec'
  )""",
"when_to_use": ["As part of baseline throughput monitoring.","When CPU is high and you suspect excessive compilation activity."],
},
# ── I/O ──────────────────────────────────────────────────────────────────
{
"slug": "io-latency-by-file",
"title": "Check IO Latency per Database File",
"tags": ["tsql","io","latency","storage","performance"],
"explanation": "I/O latency measures how long read and write operations take for each database file. Read latency above 20ms or write latency above 10ms for data files indicates a storage bottleneck. Values reset on SQL Server restart.",
"query": """\
SELECT
  DB_NAME(vfs.database_id)           AS db_name,
  mf.physical_name,
  mf.type_desc,
  vfs.io_stall_read_ms  / NULLIF(vfs.num_of_reads,  0) AS avg_read_latency_ms,
  vfs.io_stall_write_ms / NULLIF(vfs.num_of_writes, 0) AS avg_write_latency_ms,
  vfs.num_of_reads,
  vfs.num_of_writes,
  vfs.num_of_bytes_read    / 1048576 AS mb_read,
  vfs.num_of_bytes_written / 1048576 AS mb_written
FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
JOIN sys.master_files mf
  ON vfs.database_id = mf.database_id
  AND vfs.file_id   = mf.file_id
ORDER BY avg_read_latency_ms DESC""",
"when_to_use": ["When storage performance is suspect.","Before and after storage configuration changes.","When PAGEIOLATCH wait types are prominent in wait statistics."],
},
{
"slug": "io-stall-by-database",
"title": "Check IO Stall Summary by Database",
"tags": ["tsql","io","stall","performance","storage"],
"explanation": "Aggregates total I/O stall time per database to quickly identify which databases are experiencing the most I/O pressure. Useful for prioritising storage-tier investigations.",
"query": """\
SELECT
  DB_NAME(vfs.database_id)           AS db_name,
  SUM(vfs.io_stall)                  AS total_io_stall_ms,
  SUM(vfs.io_stall_read_ms)          AS read_stall_ms,
  SUM(vfs.io_stall_write_ms)         AS write_stall_ms,
  SUM(vfs.num_of_reads)              AS total_reads,
  SUM(vfs.num_of_writes)             AS total_writes,
  SUM(vfs.num_of_bytes_read)    / 1048576 AS mb_read,
  SUM(vfs.num_of_bytes_written) / 1048576 AS mb_written
FROM sys.dm_io_virtual_file_stats(NULL, NULL) vfs
GROUP BY vfs.database_id
ORDER BY total_io_stall_ms DESC""",
"when_to_use": ["As a quick triage to find the most I/O-intensive database on the instance."],
},
# ── DISK & STORAGE ────────────────────────────────────────────────────────
{
"slug": "disk-space",
"title": "Check Disk Space (Volume Stats)",
"tags": ["tsql","disk","storage","capacity"],
"explanation": "Running out of disk space can cause databases to go offline. sys.dm_os_volume_stats returns free and total space for the volumes hosting database files.",
"query": """\
SELECT DISTINCT
  vs.volume_mount_point,
  vs.total_bytes / 1073741824.0                             AS total_gb,
  vs.available_bytes / 1073741824.0                         AS free_gb,
  CAST(vs.available_bytes * 100.0 / vs.total_bytes AS DECIMAL(5,1)) AS free_pct
FROM sys.master_files mf
CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs
ORDER BY free_pct""",
"when_to_use": ["During daily health checks.","When databases report 'could not allocate space' errors.","When planning capacity for new databases or data growth."],
},
{
"slug": "database-sizes",
"title": "Check Database File Sizes",
"tags": ["tsql","database-size","storage","capacity"],
"explanation": "Tracking database file sizes helps with capacity planning and identifying unexpected data growth. This query reports size and free space for every data and log file.",
"query": """\
SELECT
  DB_NAME(mf.database_id)              AS db_name,
  mf.name                              AS logical_name,
  mf.type_desc,
  mf.physical_name,
  mf.size * 8 / 1024.0                 AS size_mb,
  FILEPROPERTY(mf.name, 'SpaceUsed') * 8 / 1024.0 AS used_mb,
  (mf.size - CAST(FILEPROPERTY(mf.name,'SpaceUsed') AS BIGINT)) * 8 / 1024.0 AS free_mb
FROM sys.master_files mf
ORDER BY db_name, mf.type_desc""",
"when_to_use": ["During capacity planning reviews.","When a database grows unexpectedly.","To identify log files that are not being truncated."],
},
{
"slug": "log-space-usage",
"title": "Check Transaction Log Space Usage",
"tags": ["tsql","log","transaction-log","storage","vlf"],
"explanation": "A full transaction log causes the database to go offline for writes. This query shows used vs. total log space for each database and identifies logs that are nearly full.",
"query": """\
SELECT
  db.name,
  db.recovery_model_desc,
  ls.total_log_size_mb,
  ls.used_log_space_mb,
  CAST(ls.used_log_space_in_percent AS DECIMAL(5,1)) AS used_pct,
  ls.log_backup_time
FROM sys.databases db
CROSS APPLY sys.dm_db_log_space_usage() ls   -- run per database; shows current DB
-- To check all databases at once use the alternative below:
-- sys.dm_db_log_space_usage is scoped; for all DBs iterate or use sys.master_files
WHERE db.database_id = DB_ID()""",
"when_to_use": ["When a transaction log full error occurs.","Before running large batch operations.","To verify log backups are keeping up with log generation."],
},
{
"slug": "log-space-all-databases",
"title": "Check Transaction Log Space for All Databases",
"tags": ["tsql","log","transaction-log","storage"],
"explanation": "Uses DBCC SQLPERF to return log utilisation for every database in a single query, showing log file size, used space, and percentage used. Run as a health check snapshot.",
"query": """\
SELECT
  [Database Name],
  [Log Size (MB)],
  [Log Space Used (%)] AS log_used_pct,
  [Status]
FROM sys.dm_exec_query_stats qs  -- placeholder
-- Use this instead (works on all SQL Server versions):
-- DBCC SQLPERF(LOGSPACE)
-- For a SELECT-only equivalent:
SELECT
  d.name                                           AS db_name,
  d.recovery_model_desc,
  mf.size * 8 / 1024.0                             AS log_size_mb,
  FILEPROPERTY(mf.name,'SpaceUsed') * 8 / 1024.0  AS log_used_mb,
  CAST(FILEPROPERTY(mf.name,'SpaceUsed') * 100.0
    / mf.size AS DECIMAL(5,1))                     AS used_pct
FROM sys.master_files mf
JOIN sys.databases d ON mf.database_id = d.database_id
WHERE mf.type = 1  -- log files only
ORDER BY used_pct DESC""",
"when_to_use": ["As a daily health check to identify logs nearing capacity.","When investigating log space issues across multiple databases."],
},
{
"slug": "vlf-count",
"title": "Check Virtual Log File (VLF) Count",
"tags": ["tsql","vlf","transaction-log","performance"],
"explanation": "Excessive VLFs (Virtual Log Files) slow down database startup, recovery, and log backup/restore. A log file that has grown many times in small increments accumulates hundreds of VLFs. Counts above 1000 should be investigated.",
"query": """\
SELECT
  DB_NAME(li.database_id) AS db_name,
  COUNT(*)                AS vlf_count,
  SUM(li.vlf_size_mb)     AS total_log_mb
FROM sys.dm_db_log_info(NULL) li
GROUP BY li.database_id
ORDER BY vlf_count DESC""",
"when_to_use": ["When database recovery or startup is slow.","When log backup/restore operations take longer than expected.","As part of an annual log file maintenance review."],
},
{
"slug": "data-file-autogrowth-settings",
"title": "Check Database File Autogrowth Settings",
"tags": ["tsql","autogrowth","storage","capacity"],
"explanation": "Autogrowth events pause the database during file expansion and cause I/O stalls. Files should have fixed-size growth increments (not percentages) and pre-allocated sizes large enough to avoid frequent autogrowths.",
"query": """\
SELECT
  DB_NAME(database_id)                          AS db_name,
  name                                          AS logical_name,
  type_desc,
  physical_name,
  size * 8 / 1024.0                             AS current_size_mb,
  CASE is_percent_growth
    WHEN 1 THEN CAST(growth AS VARCHAR) + '%'
    ELSE CAST(growth * 8 / 1024.0 AS VARCHAR) + ' MB'
  END                                           AS autogrowth,
  CASE max_size
    WHEN -1 THEN 'Unlimited'
    WHEN 0  THEN 'No growth'
    ELSE CAST(max_size * 8 / 1024.0 AS VARCHAR) + ' MB'
  END                                           AS max_size,
  is_percent_growth
FROM sys.master_files
ORDER BY db_name, type_desc""",
"when_to_use": ["When reviewing storage configuration.","When autogrowth events appear in the SQL Server error log.","Before moving databases to new storage."],
},
{
"slug": "table-sizes-top20",
"title": "Check Top 20 Largest Tables by Size",
"tags": ["tsql","table-size","storage","capacity"],
"explanation": "Identifying the largest tables helps prioritise archiving, partitioning, and compression efforts. This query sums data and index pages for each table in the current database.",
"query": """\
SELECT TOP 20
  OBJECT_SCHEMA_NAME(ps.object_id)          AS schema_name,
  OBJECT_NAME(ps.object_id)                 AS table_name,
  SUM(ps.reserved_page_count) * 8 / 1024.0 AS reserved_mb,
  SUM(ps.used_page_count)     * 8 / 1024.0 AS used_mb,
  SUM(CASE WHEN ps.index_id IN (0,1)
        THEN ps.row_count ELSE 0 END)       AS row_count
FROM sys.dm_db_partition_stats ps
GROUP BY ps.object_id
ORDER BY reserved_mb DESC""",
"when_to_use": ["During capacity planning.","When identifying candidates for table compression or archiving."],
},
{
"slug": "heap-tables",
"title": "Check Heap Tables (Tables Without Clustered Index)",
"tags": ["tsql","heap","index","table-structure"],
"explanation": "Heap tables lack a clustered index, causing full table scans for most queries and increased fragmentation. In most OLTP schemas, every table should have a clustered index.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(t.object_id)               AS schema_name,
  t.name                                        AS table_name,
  ps.row_count,
  ps.reserved_page_count * 8 / 1024.0           AS reserved_mb
FROM sys.tables t
JOIN sys.dm_db_partition_stats ps
  ON t.object_id = ps.object_id AND ps.index_id = 0
WHERE NOT EXISTS (
  SELECT 1 FROM sys.indexes i
  WHERE i.object_id = t.object_id AND i.index_id = 1
)
ORDER BY reserved_mb DESC""",
"when_to_use": ["During a schema health review.","When scan-heavy queries cannot be improved with non-clustered indexes."],
},
{
"slug": "tables-without-pk",
"title": "Check Tables Without a Primary Key",
"tags": ["tsql","primary-key","schema","data-integrity"],
"explanation": "Tables without a primary key lack a guaranteed unique row identifier, which breaks replication, CDC, and complicates application logic. Every table in a relational schema should have a primary key.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(t.object_id) AS schema_name,
  t.name                          AS table_name,
  t.create_date,
  t.modify_date
FROM sys.tables t
WHERE NOT EXISTS (
  SELECT 1 FROM sys.indexes i
  WHERE i.object_id = t.object_id AND i.is_primary_key = 1
)
  AND t.is_ms_shipped = 0
ORDER BY schema_name, table_name""",
"when_to_use": ["During a schema health audit.","Before enabling replication or CDC on a database."],
},
{
"slug": "foreign-key-missing-index",
"title": "Check Foreign Keys Without Supporting Index",
"tags": ["tsql","foreign-key","index","performance"],
"explanation": "Foreign key columns on the referencing table without a supporting index cause full table scans during cascading operations and JOIN queries. Adding an index on FK columns is a common quick win.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(fk.parent_object_id)   AS schema_name,
  OBJECT_NAME(fk.parent_object_id)          AS table_name,
  fk.name                                   AS fk_name,
  COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS fk_column,
  OBJECT_NAME(fk.referenced_object_id)      AS referenced_table
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc
  ON fk.object_id = fkc.constraint_object_id
WHERE NOT EXISTS (
  SELECT 1 FROM sys.index_columns ic
  JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  WHERE ic.object_id = fkc.parent_object_id
    AND ic.column_id = fkc.parent_column_id
    AND ic.index_column_id = 1
)
ORDER BY schema_name, table_name""",
"when_to_use": ["During a schema performance review.","After a missing index analysis reveals FK columns repeatedly suggested."],
},
# ── BLOCKING & TRANSACTIONS ───────────────────────────────────────────────
{
"slug": "blocking-sessions",
"title": "Check Blocking Sessions",
"tags": ["tsql","blocking","sessions","performance"],
"explanation": "Blocking occurs when one session holds a lock that another session needs. Identifying the blocking chain is the first step in resolving concurrency problems.",
"query": """\
SELECT
  r.session_id,
  r.blocking_session_id,
  r.wait_type,
  r.wait_time / 1000.0           AS wait_sec,
  r.status,
  DB_NAME(r.database_id)         AS db_name,
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
"when_to_use": ["When users report slow or hanging queries.","When CPU is low but throughput is poor."],
},
{
"slug": "open-transactions",
"title": "Check Open and Long-Running Transactions",
"tags": ["tsql","transactions","blocking","deadlock"],
"explanation": "Open transactions hold locks and grow the transaction log, preventing log space reuse. Long-running transactions are a frequent cause of blocking chains and log space exhaustion.",
"query": """\
SELECT
  s.session_id,
  s.login_name,
  s.host_name,
  s.program_name,
  s.open_transaction_count,
  t.transaction_begin_time,
  DATEDIFF(SECOND, t.transaction_begin_time, GETDATE()) AS duration_sec,
  t.transaction_type,
  t.transaction_state,
  SUBSTRING(st.text, 1, 200)       AS last_sql
FROM sys.dm_exec_sessions s
JOIN sys.dm_tran_session_transactions tst ON s.session_id = tst.session_id
JOIN sys.dm_tran_active_transactions t    ON tst.transaction_id = t.transaction_id
LEFT JOIN sys.dm_exec_connections c       ON s.session_id = c.session_id
OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) st
WHERE s.open_transaction_count > 0
ORDER BY duration_sec DESC""",
"when_to_use": ["When blocking is reported but no active requests are visible.","When the transaction log cannot be truncated despite log backups."],
},
{
"slug": "deadlock-history",
"title": "Check Recent Deadlocks (System Health XE Session)",
"tags": ["tsql","deadlock","extended-events","system-health"],
"explanation": "SQL Server records deadlock events in the system_health Extended Events session. This query retrieves the XML deadlock graphs from the ring buffer, showing which sessions and resources were involved.",
"query": """\
SELECT
  xdr.value('@timestamp', 'datetime2')    AS deadlock_time,
  xdr.query('.')                          AS deadlock_graph_xml
FROM (
  SELECT CAST(target_data AS XML) AS target_data
  FROM sys.dm_xe_session_targets t
  JOIN sys.dm_xe_sessions s ON t.event_session_address = s.address
  WHERE s.name = 'system_health'
    AND t.target_name = 'ring_buffer'
) AS data
CROSS APPLY target_data.nodes('//RingBufferTarget/event[@name="xml_deadlock_report"]') AS xdr_table(xdr)
ORDER BY deadlock_time DESC""",
"when_to_use": ["When deadlocks are reported by the application.","When investigating recurring transaction failures with error 1205."],
},
{
"slug": "lock-waits-by-object",
"title": "Check Lock Waits by Object",
"tags": ["tsql","locking","blocking","waits"],
"explanation": "Identifies which tables or indexes are most frequently causing lock waits. Helps focus locking investigations on the most contended objects.",
"query": """\
SELECT
  DB_NAME(wt.database_id)                    AS db_name,
  OBJECT_NAME(p.object_id, wt.database_id)   AS object_name,
  i.name                                     AS index_name,
  wt.wait_type,
  COUNT(*)                                   AS wait_count,
  SUM(wt.wait_duration_ms) / 1000.0          AS total_wait_sec
FROM sys.dm_os_waiting_tasks wt
JOIN sys.partitions p
  ON wt.resource_associated_entity_id = p.hobt_id
LEFT JOIN sys.indexes i
  ON p.object_id = i.object_id AND p.index_id = i.index_id
WHERE wt.wait_type LIKE 'LCK_%'
GROUP BY wt.database_id, p.object_id, i.name, wt.wait_type
ORDER BY total_wait_sec DESC""",
"when_to_use": ["When LCK_M_* waits dominate the wait statistics.","To find specific tables that are hotspots for lock contention."],
},
{
"slug": "transaction-isolation-levels",
"title": "Check Session Transaction Isolation Levels",
"tags": ["tsql","isolation-level","transactions","concurrency"],
"explanation": "Different isolation levels have different locking behaviour. Sessions using READ UNCOMMITTED (NOLOCK) risk dirty reads; SERIALIZABLE causes the most blocking. Knowing which levels are in use helps explain concurrency issues.",
"query": """\
SELECT
  transaction_isolation_level,
  CASE transaction_isolation_level
    WHEN 0 THEN 'Unspecified'
    WHEN 1 THEN 'READ UNCOMMITTED'
    WHEN 2 THEN 'READ COMMITTED'
    WHEN 3 THEN 'REPEATABLE READ'
    WHEN 4 THEN 'SERIALIZABLE'
    WHEN 5 THEN 'SNAPSHOT'
    ELSE 'Unknown'
  END                             AS isolation_name,
  COUNT(*)                        AS session_count
FROM sys.dm_exec_sessions
WHERE is_user_process = 1
GROUP BY transaction_isolation_level
ORDER BY session_count DESC""",
"when_to_use": ["When diagnosing blocking caused by isolation level mismatches.","To audit whether applications are using appropriate isolation levels."],
},
# ── BACKUP & RECOVERY ─────────────────────────────────────────────────────
{
"slug": "backup-status",
"title": "Check Database Backup Status",
"tags": ["tsql","backup","recovery","msdb"],
"explanation": "Regular backups are essential for recovery. This query shows the most recent full, differential, and log backups for each database, making it easy to spot databases that have not been backed up recently.",
"query": """\
SELECT
  d.name                                            AS database_name,
  MAX(CASE b.type WHEN 'D' THEN b.backup_finish_date END) AS last_full,
  MAX(CASE b.type WHEN 'I' THEN b.backup_finish_date END) AS last_diff,
  MAX(CASE b.type WHEN 'L' THEN b.backup_finish_date END) AS last_log,
  DATEDIFF(HOUR,
    MAX(CASE b.type WHEN 'D' THEN b.backup_finish_date END),
    GETDATE())                                      AS hours_since_full
FROM sys.databases d
LEFT JOIN msdb.dbo.backupset b
  ON d.name = b.database_name
  AND b.backup_finish_date > DATEADD(DAY, -30, GETDATE())
WHERE d.database_id > 4
GROUP BY d.name
ORDER BY hours_since_full DESC""",
"when_to_use": ["As part of daily DBA health checks.","Before maintenance windows or patching."],
},
{
"slug": "recovery-model",
"title": "Check Database Recovery Models",
"tags": ["tsql","recovery-model","backup","log-backup"],
"explanation": "The recovery model determines how much data can be recovered after a failure. FULL recovery requires regular log backups to prevent log space exhaustion. SIMPLE recovery cannot be used with Always On AG.",
"query": """\
SELECT
  name,
  recovery_model_desc,
  log_reuse_wait_desc,
  state_desc,
  is_read_only,
  page_verify_option_desc
FROM sys.databases
WHERE database_id > 4
ORDER BY recovery_model_desc, name""",
"when_to_use": ["When a log file is filling up despite log backups (check log_reuse_wait_desc).","When adding a database to an Availability Group (must be FULL recovery)."],
},
{
"slug": "restore-history",
"title": "Check Recent Database Restore History",
"tags": ["tsql","restore","recovery","msdb","history"],
"explanation": "Tracking restore operations provides an audit trail for disaster recovery testing and unexpected restores. This query shows all restores in the last 30 days including who initiated them.",
"query": """\
SELECT
  rh.destination_database_name  AS db_name,
  rh.restore_date,
  rh.restore_type,
  rh.user_name,
  bs.database_name              AS source_database,
  bs.backup_start_date          AS backup_taken,
  bs.server_name                AS backup_server
FROM msdb.dbo.restorehistory rh
JOIN msdb.dbo.backupset bs ON rh.backup_set_id = bs.backup_set_id
WHERE rh.restore_date > DATEADD(DAY, -30, GETDATE())
ORDER BY rh.restore_date DESC""",
"when_to_use": ["After a suspected unauthorised restore.","To verify DR test restores completed successfully."],
},
{
"slug": "databases-never-backed-up",
"title": "Check Databases Never Backed Up",
"tags": ["tsql","backup","recovery","risk"],
"explanation": "New databases or databases restored from another server may have no backup history in msdb. These databases are completely unprotected and represent a data loss risk.",
"query": """\
SELECT d.name, d.create_date, d.recovery_model_desc
FROM sys.databases d
WHERE d.database_id > 4
  AND d.state_desc = 'ONLINE'
  AND d.is_read_only = 0
  AND NOT EXISTS (
    SELECT 1 FROM msdb.dbo.backupset b
    WHERE b.database_name = d.name
  )
ORDER BY d.create_date DESC""",
"when_to_use": ["After a SQL Server migration.","As part of a backup compliance audit."],
},
# ── SECURITY ─────────────────────────────────────────────────────────────
{
"slug": "sysadmin-members",
"title": "Check Members of the sysadmin Server Role",
"tags": ["tsql","security","sysadmin","permissions"],
"explanation": "Members of the sysadmin fixed server role have unrestricted access to the entire SQL Server instance. This list should be kept short and regularly reviewed.",
"query": """\
SELECT
  sp.name                    AS principal_name,
  sp.type_desc,
  sp.is_disabled,
  sp.create_date,
  sp.modify_date,
  sp.default_database_name
FROM sys.server_role_members srm
JOIN sys.server_principals sp ON srm.member_principal_id = sp.principal_id
JOIN sys.server_principals role ON srm.role_principal_id = role.principal_id
WHERE role.name = 'sysadmin'
ORDER BY sp.type_desc, sp.name""",
"when_to_use": ["During a security audit.","Before a compliance review.","After adding or removing logins."],
},
{
"slug": "server-role-members",
"title": "Check All Server Role Memberships",
"tags": ["tsql","security","server-roles","permissions"],
"explanation": "Fixed server roles (securityadmin, dbcreator, bulkadmin, etc.) grant significant privileges. Reviewing all role memberships helps detect privilege creep.",
"query": """\
SELECT
  role.name    AS server_role,
  sp.name      AS member_name,
  sp.type_desc AS member_type,
  sp.is_disabled
FROM sys.server_role_members srm
JOIN sys.server_principals role ON srm.role_principal_id = role.principal_id
JOIN sys.server_principals sp   ON srm.member_principal_id = sp.principal_id
WHERE role.is_fixed_role = 1
ORDER BY role.name, sp.name""",
"when_to_use": ["During a privilege audit.","When implementing least-privilege access controls."],
},
{
"slug": "sql-logins-list",
"title": "Check All SQL Server Logins",
"tags": ["tsql","security","logins","authentication"],
"explanation": "Returns all logins (SQL and Windows) with their status, policy, and expiration settings. SQL logins with CHECK_POLICY=OFF bypass Windows password policies and represent a security risk.",
"query": """\
SELECT
  sp.name,
  sp.type_desc,
  sp.is_disabled,
  sp.create_date,
  sp.modify_date,
  sp.default_database_name,
  CAST(sp.is_policy_checked AS BIT)     AS policy_checked,
  CAST(sp.is_expiration_checked AS BIT) AS expiration_checked,
  LOGINPROPERTY(sp.name, 'PasswordLastSetTime') AS password_last_set
FROM sys.sql_logins sp
ORDER BY sp.is_disabled, sp.name""",
"when_to_use": ["During a security hardening review.","To find logins with disabled password policies."],
},
{
"slug": "orphaned-users",
"title": "Check Orphaned Database Users",
"tags": ["tsql","security","orphaned-users","permissions"],
"explanation": "Orphaned users are database principals whose SID does not match any server login. They are common after database migrations and prevent affected users from connecting.",
"query": """\
SELECT
  dp.name         AS user_name,
  dp.type_desc,
  dp.create_date
FROM sys.database_principals dp
WHERE dp.type IN ('S','U')
  AND dp.sid IS NOT NULL
  AND dp.sid <> 0x00
  AND dp.name NOT IN ('dbo','guest','INFORMATION_SCHEMA','sys')
  AND NOT EXISTS (
    SELECT 1 FROM sys.server_principals sp
    WHERE sp.sid = dp.sid
  )
ORDER BY dp.name""",
"when_to_use": ["After migrating a database to a new SQL Server instance.","When users report login failures with error 15023."],
},
{
"slug": "database-role-members",
"title": "Check Database Role Memberships",
"tags": ["tsql","security","database-roles","permissions"],
"explanation": "Database roles (db_owner, db_datareader, db_datawriter, etc.) grant collections of permissions. Reviewing memberships catches over-privileged users and orphaned role grants.",
"query": """\
SELECT
  role.name   AS db_role,
  dp.name     AS member_name,
  dp.type_desc
FROM sys.database_role_members drm
JOIN sys.database_principals role ON drm.role_principal_id = role.principal_id
JOIN sys.database_principals dp   ON drm.member_principal_id = dp.principal_id
WHERE role.is_fixed_role = 1
   OR role.name IN ('db_owner','db_securityadmin')
ORDER BY role.name, dp.name""",
"when_to_use": ["During a database-level security audit.","Before a compliance review or penetration test."],
},
{
"slug": "object-permissions",
"title": "Check Object-Level Permissions in a Database",
"tags": ["tsql","security","permissions","grants"],
"explanation": "Object-level permissions (GRANT/DENY on tables, views, procedures) can accumulate over time. This query lists all explicit object permissions in the current database.",
"query": """\
SELECT
  USER_NAME(dp.grantee_principal_id) AS grantee,
  dp.permission_name,
  dp.state_desc                      AS grant_type,
  OBJECT_SCHEMA_NAME(dp.major_id)    AS schema_name,
  OBJECT_NAME(dp.major_id)           AS object_name,
  o.type_desc                        AS object_type
FROM sys.database_permissions dp
JOIN sys.objects o ON dp.major_id = o.object_id
WHERE dp.class = 1  -- object-level permissions
  AND dp.major_id > 0
ORDER BY grantee, object_name""",
"when_to_use": ["During a schema-level security audit.","When a user reports unexpected access to an object."],
},
# ── DATABASE CONFIGURATION ────────────────────────────────────────────────
{
"slug": "database-settings",
"title": "Check Database Option Settings",
"tags": ["tsql","database-configuration","settings","options"],
"explanation": "SQL Server databases have dozens of configurable options affecting behaviour, performance, and recovery. This query shows key settings including auto-options, page verify, read-only, and compatibility.",
"query": """\
SELECT
  name,
  state_desc,
  recovery_model_desc,
  compatibility_level,
  collation_name,
  is_auto_close_on,
  is_auto_shrink_on,
  is_auto_create_stats_on,
  is_auto_update_stats_on,
  is_auto_update_stats_async_on,
  page_verify_option_desc,
  is_read_only,
  is_read_committed_snapshot_on,
  snapshot_isolation_state_desc,
  is_trustworthy_on,
  is_broker_enabled
FROM sys.databases
WHERE database_id > 4
ORDER BY name""",
"when_to_use": ["During a database health or compliance audit.","When investigating unexpected database behaviour."],
},
{
"slug": "server-configuration-nondefault",
"title": "Check Non-Default SQL Server Configuration Options",
"tags": ["tsql","server-configuration","sp-configure","settings"],
"explanation": "sp_configure controls instance-level settings. Displaying only non-default values quickly reveals customisations such as MAXDOP, max server memory, cost threshold, or remote access settings.",
"query": """\
SELECT
  name,
  value             AS configured_value,
  value_in_use      AS running_value,
  minimum,
  maximum,
  description
FROM sys.configurations
WHERE value <> value_default
   OR value_in_use <> value_default
ORDER BY name""",
"when_to_use": ["When comparing instance configuration against a baseline or build standard.","After a SQL Server upgrade to verify settings survived."],
},
{
"slug": "maxdop-ctfp",
"title": "Check MAXDOP and Cost Threshold for Parallelism",
"tags": ["tsql","maxdop","parallelism","performance","configuration"],
"explanation": "MAXDOP limits the number of CPUs used per query. Cost Threshold for Parallelism determines when parallel plans are chosen. Misconfigured values cause excessive parallelism waits (CXPACKET) or underutilised CPUs.",
"query": """\
SELECT
  name,
  value_in_use   AS current_value,
  value          AS configured_value,
  description
FROM sys.configurations
WHERE name IN (
  'max degree of parallelism',
  'cost threshold for parallelism',
  'max worker threads',
  'affinity mask',
  'lightweight pooling'
)
ORDER BY name""",
"when_to_use": ["When CXPACKET or CXCONSUMER waits are high.","After adding CPUs to the server.","During SQL Server performance baseline setup."],
},
{
"slug": "max-server-memory",
"title": "Check SQL Server Memory Configuration",
"tags": ["tsql","memory","max-server-memory","configuration"],
"explanation": "The 'max server memory' setting caps the buffer pool. If set too high it can starve the OS; if too low it wastes available RAM. The common recommendation is to leave 10-15% or 4-10 GB for the OS.",
"query": """\
SELECT
  c.name,
  c.value_in_use                     AS configured_mb,
  os.total_physical_memory_kb / 1024 AS total_ram_mb,
  os.available_physical_memory_kb / 1024 AS available_ram_mb,
  CAST(c.value_in_use * 100.0
    / (os.total_physical_memory_kb / 1024) AS DECIMAL(5,1)) AS pct_of_total
FROM sys.configurations c
CROSS JOIN sys.dm_os_sys_memory os
WHERE c.name = 'max server memory (MB)'""",
"when_to_use": ["When the server is experiencing OS memory pressure or SQL Server PLE is consistently low.","When adding RAM to the server."],
},
{
"slug": "auto-shrink-databases",
"title": "Check Databases with Auto-Shrink Enabled",
"tags": ["tsql","auto-shrink","configuration","performance"],
"explanation": "Auto-shrink is widely regarded as harmful: it causes index fragmentation and I/O spikes every time the database shrinks and then grows again. It should be disabled on all production databases.",
"query": """\
SELECT name, create_date, is_auto_shrink_on, recovery_model_desc, state_desc
FROM sys.databases
WHERE is_auto_shrink_on = 1
ORDER BY name""",
"when_to_use": ["During a database configuration health check.","When intermittent I/O spikes correlate with unexpected file shrinks."],
},
{
"slug": "database-collation",
"title": "Check Database and Column Collation",
"tags": ["tsql","collation","configuration","schema"],
"explanation": "Collation mismatches between databases or between a column and tempdb cause implicit conversion warnings and can prevent JOIN operations. All databases in a system should use consistent collation.",
"query": """\
SELECT
  name,
  collation_name,
  compatibility_level,
  CASE WHEN collation_name = SERVERPROPERTY('Collation')
    THEN 'Matches server'
    ELSE 'MISMATCH with server'
  END AS collation_status
FROM sys.databases
WHERE database_id > 4
ORDER BY collation_status DESC, name""",
"when_to_use": ["When collation-related errors appear during cross-database queries.","During database migration planning."],
},
{
"slug": "page-verify-settings",
"title": "Check Page Verify Settings",
"tags": ["tsql","page-verify","checksum","data-integrity"],
"explanation": "CHECKSUM page verify detects hardware-level data corruption at the page level. Databases without CHECKSUM enabled cannot detect silent data corruption and should be updated.",
"query": """\
SELECT name, page_verify_option_desc, state_desc
FROM sys.databases
WHERE page_verify_option_desc <> 'CHECKSUM'
  AND database_id > 4
ORDER BY name""",
"when_to_use": ["During a data integrity audit.","When migrating databases from older SQL Server versions."],
},
{
"slug": "trustworthy-databases",
"title": "Check Databases with TRUSTWORTHY ON",
"tags": ["tsql","security","trustworthy","configuration"],
"explanation": "The TRUSTWORTHY database property allows CLR code or Service Broker procedures to run with elevated permissions. It should only be ON for databases that explicitly require it, as it is a security risk.",
"query": """\
SELECT name, is_trustworthy_on, is_broker_enabled, recovery_model_desc
FROM sys.databases
WHERE is_trustworthy_on = 1
  AND name <> 'msdb'  -- msdb legitimately requires TRUSTWORTHY
ORDER BY name""",
"when_to_use": ["During a security hardening review.","Before a penetration test or compliance audit."],
},
# ── INDEX HEALTH ──────────────────────────────────────────────────────────
{
"slug": "index-fragmentation",
"title": "Check Index Fragmentation",
"tags": ["tsql","index-fragmentation","index-maintenance","performance"],
"explanation": "Fragmented indexes degrade query performance. Indexes with avg_fragmentation > 30% should be rebuilt; those between 5-30% should be reorganized. Run against individual databases.",
"query": """\
SELECT
  DB_NAME()                                   AS db_name,
  OBJECT_NAME(ips.object_id)                  AS table_name,
  i.name                                      AS index_name,
  ips.index_type_desc,
  ROUND(ips.avg_fragmentation_in_percent, 1)  AS fragmentation_pct,
  ips.page_count
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
JOIN sys.indexes i
  ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.avg_fragmentation_in_percent > 5
  AND ips.page_count > 100
ORDER BY ips.avg_fragmentation_in_percent DESC""",
"when_to_use": ["Before scheduling index maintenance jobs.","After bulk data loads."],
},
{
"slug": "index-usage-stats",
"title": "Check Index Usage Statistics",
"tags": ["tsql","index-usage","performance","index-tuning"],
"explanation": "Index usage statistics track seeks, scans, lookups, and updates per index since the last SQL Server restart. Indexes with zero seeks and scans but many updates are pure overhead.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(i.object_id)    AS schema_name,
  OBJECT_NAME(i.object_id)           AS table_name,
  i.name                             AS index_name,
  i.type_desc,
  ios.user_seeks,
  ios.user_scans,
  ios.user_lookups,
  ios.user_updates,
  ios.last_user_seek,
  ios.last_user_scan
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats ios
  ON i.object_id = ios.object_id
  AND i.index_id = ios.index_id
  AND ios.database_id = DB_ID()
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
  AND i.index_id > 0
ORDER BY ios.user_updates DESC, ios.user_seeks ASC""",
"when_to_use": ["During an index review to identify underused or write-heavy indexes.","Before dropping indexes — always verify usage statistics first."],
},
{
"slug": "unused-indexes",
"title": "Check Unused Indexes (Zero Seeks, Scans, Lookups)",
"tags": ["tsql","unused-indexes","index-maintenance","performance"],
"explanation": "Indexes that are never read but always updated for INSERT/UPDATE/DELETE operations increase write overhead without benefiting any queries. Candidates for removal after careful validation.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(i.object_id)    AS schema_name,
  OBJECT_NAME(i.object_id)           AS table_name,
  i.name                             AS index_name,
  i.type_desc,
  ISNULL(ios.user_seeks,   0)        AS user_seeks,
  ISNULL(ios.user_scans,   0)        AS user_scans,
  ISNULL(ios.user_lookups, 0)        AS user_lookups,
  ISNULL(ios.user_updates, 0)        AS user_updates
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats ios
  ON i.object_id = ios.object_id
  AND i.index_id = ios.index_id
  AND ios.database_id = DB_ID()
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
  AND i.index_id > 1  -- skip clustered and heaps
  AND i.is_disabled = 0
  AND ISNULL(ios.user_seeks,   0) = 0
  AND ISNULL(ios.user_scans,   0) = 0
  AND ISNULL(ios.user_lookups, 0) = 0
ORDER BY ISNULL(ios.user_updates, 0) DESC""",
"when_to_use": ["During a scheduled index review.","Before a major upgrade to reduce maintenance overhead.","CAUTION: DMV data resets on restart — gather over multiple weeks."],
},
{
"slug": "missing-indexes",
"title": "Check Missing Index Recommendations",
"tags": ["tsql","missing-indexes","performance","index-tuning"],
"explanation": "SQL Server records index recommendations generated by the query optimizer. This query surfaces the most impactful missing indexes sorted by estimated improvement.",
"query": """\
SELECT TOP 20
  ROUND(migs.avg_total_user_cost * migs.avg_user_impact
    * (migs.user_seeks + migs.user_scans), 0) AS estimated_improvement,
  migs.user_seeks,
  migs.user_scans,
  DB_NAME(mid.database_id)           AS db_name,
  OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
  mid.equality_columns,
  mid.inequality_columns,
  mid.included_columns
FROM sys.dm_db_missing_index_groups mig
JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
JOIN sys.dm_db_missing_index_details mid       ON mig.index_handle = mid.index_handle
ORDER BY estimated_improvement DESC""",
"when_to_use": ["After identifying slow queries to find the best index candidates.","As part of a periodic performance review (DMVs reset on restart)."],
},
{
"slug": "disabled-indexes",
"title": "Check Disabled Indexes",
"tags": ["tsql","disabled-indexes","index-maintenance"],
"explanation": "Disabled indexes are not maintained by DML and cannot be used by the optimizer. They are often left behind after troubleshooting or maintenance operations and should be re-enabled or dropped.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(i.object_id) AS schema_name,
  OBJECT_NAME(i.object_id)        AS table_name,
  i.name                          AS index_name,
  i.type_desc,
  i.is_unique,
  i.is_primary_key
FROM sys.indexes i
WHERE i.is_disabled = 1
  AND OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
ORDER BY schema_name, table_name""",
"when_to_use": ["During an index health audit.","After a bulk load operation that temporarily disabled indexes."],
},
# ── STATISTICS ────────────────────────────────────────────────────────────
{
"slug": "stale-statistics",
"title": "Check Stale Statistics",
"tags": ["tsql","statistics","query-tuning","performance"],
"explanation": "Stale statistics cause the query optimizer to generate suboptimal execution plans. SQL Server auto-updates statistics by default when 20% of rows change, but large tables may benefit from manual updates.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(s.object_id) AS schema_name,
  OBJECT_NAME(s.object_id)        AS table_name,
  s.name                          AS stats_name,
  STATS_DATE(s.object_id, s.stats_id) AS last_updated,
  sp.rows,
  sp.rows_sampled,
  sp.modification_counter,
  sp.is_incremental
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
  AND STATS_DATE(s.object_id, s.stats_id) < DATEADD(DAY, -7, GETDATE())
  AND sp.modification_counter > 0
ORDER BY sp.modification_counter DESC""",
"when_to_use": ["When queries suddenly perform worse after data changes.","As part of regular maintenance planning."],
},
{
"slug": "statistics-sample-rates",
"title": "Check Statistics Sample Rates",
"tags": ["tsql","statistics","sample-rate","query-tuning"],
"explanation": "Statistics sampled at very low percentages may not accurately represent data distribution, leading to poor cardinality estimates. Large tables often get lower sample rates by default.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(s.object_id)   AS schema_name,
  OBJECT_NAME(s.object_id)          AS table_name,
  s.name                            AS stats_name,
  sp.rows,
  sp.rows_sampled,
  CAST(100.0 * sp.rows_sampled / NULLIF(sp.rows,0) AS DECIMAL(5,1)) AS sample_pct,
  STATS_DATE(s.object_id, s.stats_id) AS last_updated
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
  AND sp.rows > 100000
ORDER BY sample_pct""",
"when_to_use": ["When cardinality estimates in execution plans are wildly off.","For large tables where low sample rates can impact plan quality."],
},
# ── TEMPDB ────────────────────────────────────────────────────────────────
{
"slug": "tempdb-file-usage",
"title": "Check TempDB File Space Usage",
"tags": ["tsql","tempdb","storage","performance"],
"explanation": "TempDB is shared by all databases and all users. It stores temporary tables, sort results, row versioning, and intermediate query results. Monitoring free space prevents TempDB exhaustion.",
"query": """\
SELECT
  SUM(unallocated_extent_page_count) * 8 / 1024.0   AS free_mb,
  SUM(version_store_reserved_page_count) * 8 / 1024.0 AS version_store_mb,
  SUM(internal_object_reserved_page_count) * 8 / 1024.0 AS internal_objects_mb,
  SUM(user_object_reserved_page_count) * 8 / 1024.0  AS user_objects_mb,
  (SUM(unallocated_extent_page_count)
   + SUM(version_store_reserved_page_count)
   + SUM(internal_object_reserved_page_count)
   + SUM(user_object_reserved_page_count)) * 8 / 1024.0 AS total_used_mb
FROM tempdb.sys.dm_db_file_space_usage""",
"when_to_use": ["When TempDB space errors occur.","When monitoring read-committed snapshot isolation (version store).","Before large batch operations that use TempDB heavily."],
},
{
"slug": "tempdb-space-by-session",
"title": "Check TempDB Space Usage by Session",
"tags": ["tsql","tempdb","sessions","performance"],
"explanation": "Identifies which sessions are consuming the most TempDB space. Large sort operations, hash joins, and temp tables all use TempDB allocations tracked per session.",
"query": """\
SELECT TOP 20
  ss.session_id,
  s.login_name,
  s.host_name,
  s.program_name,
  (ss.user_objects_alloc_page_count
   + ss.internal_objects_alloc_page_count) * 8 / 1024.0  AS total_alloc_mb,
  ss.user_objects_alloc_page_count    * 8 / 1024.0        AS user_objects_mb,
  ss.internal_objects_alloc_page_count * 8 / 1024.0       AS internal_objects_mb
FROM tempdb.sys.dm_db_session_space_usage ss
JOIN sys.dm_exec_sessions s ON ss.session_id = s.session_id
WHERE ss.user_objects_alloc_page_count + ss.internal_objects_alloc_page_count > 0
ORDER BY total_alloc_mb DESC""",
"when_to_use": ["When TempDB is filling up and you need to find which session is responsible.","During performance investigations for large sort or hash join operations."],
},
{
"slug": "tempdb-version-store",
"title": "Check TempDB Version Store Size",
"tags": ["tsql","tempdb","version-store","snapshot-isolation","rcsi"],
"explanation": "The version store supports snapshot isolation and read-committed snapshot. If transactions stay open for a long time, the version store grows and can fill TempDB. Monitor cleanup_version_store_count to see if the cleanup process is keeping up.",
"query": """\
SELECT
  cntr_value                              AS version_store_kb,
  cntr_value / 1024.0                     AS version_store_mb
FROM sys.dm_os_performance_counters
WHERE object_name LIKE '%Transactions%'
  AND counter_name = 'Version Store Size (KB)'
UNION ALL
SELECT
  cntr_value,
  cntr_value / 1024.0
FROM sys.dm_os_performance_counters
WHERE object_name LIKE '%Transactions%'
  AND counter_name = 'Version Cleanup Rate (KB/s)'""",
"when_to_use": ["When TempDB fills unexpectedly after enabling RCSI.","When diagnosing long-running snapshot transactions."],
},
# ── SQL AGENT JOBS ────────────────────────────────────────────────────────
{
"slug": "failed-jobs-24h",
"title": "Check Failed SQL Agent Jobs (Last 24 Hours)",
"tags": ["tsql","sql-agent","jobs","monitoring"],
"explanation": "SQL Agent job failures can indicate broken maintenance plans, failed backups, or application-layer issues. This query returns all jobs that failed in the last 24 hours with the error message.",
"query": """\
SELECT
  j.name                                          AS job_name,
  jh.run_date,
  jh.run_time,
  jh.run_duration,
  jh.message                                      AS error_message,
  jh.step_id,
  jh.step_name,
  jh.sql_severity
FROM msdb.dbo.sysjobhistory jh
JOIN msdb.dbo.sysjobs j ON jh.job_id = j.job_id
WHERE jh.run_status = 0   -- 0 = Failed
  AND MSDB.dbo.agent_datetime(jh.run_date, jh.run_time)
      > DATEADD(HOUR, -24, GETDATE())
ORDER BY jh.run_date DESC, jh.run_time DESC""",
"when_to_use": ["As part of a morning DBA health check.","When backup or maintenance failures need investigation."],
},
{
"slug": "running-jobs",
"title": "Check Currently Running SQL Agent Jobs",
"tags": ["tsql","sql-agent","jobs","monitoring"],
"explanation": "Identifies SQL Agent jobs that are currently executing. Useful for detecting jobs that are running longer than expected or stacking up due to an earlier job not completing.",
"query": """\
SELECT
  j.name         AS job_name,
  ja.start_execution_date,
  DATEDIFF(MINUTE, ja.start_execution_date, GETDATE()) AS running_minutes,
  ja.last_executed_step_id,
  ja.last_executed_step_date
FROM msdb.dbo.sysjobactivity ja
JOIN msdb.dbo.sysjobs j ON ja.job_id = j.job_id
WHERE ja.session_id = (
  SELECT MAX(session_id) FROM msdb.dbo.syssessions
)
  AND ja.start_execution_date IS NOT NULL
  AND ja.stop_execution_date  IS NULL
ORDER BY running_minutes DESC""",
"when_to_use": ["When a job is suspected to be running longer than normal.","When investigating resource contention caused by concurrent jobs."],
},
{
"slug": "job-run-history",
"title": "Check SQL Agent Job Run History",
"tags": ["tsql","sql-agent","jobs","history"],
"explanation": "The job run history in msdb shows execution outcomes, duration, and error messages for all jobs over the retention period. Useful for trend analysis and SLA verification.",
"query": """\
SELECT TOP 50
  j.name                                            AS job_name,
  MSDB.dbo.agent_datetime(jh.run_date, jh.run_time) AS run_start,
  jh.run_duration                                   AS duration_hhmmss,
  CASE jh.run_status
    WHEN 0 THEN 'Failed'
    WHEN 1 THEN 'Succeeded'
    WHEN 2 THEN 'Retry'
    WHEN 3 THEN 'Cancelled'
    WHEN 4 THEN 'In Progress'
  END                                               AS status,
  jh.message
FROM msdb.dbo.sysjobhistory jh
JOIN msdb.dbo.sysjobs j ON jh.job_id = j.job_id
WHERE jh.step_id = 0  -- job-level outcome only
ORDER BY run_start DESC""",
"when_to_use": ["When reviewing job reliability over time.","When a job's execution time is increasing (trending towards SLA breach)."],
},
{
"slug": "disabled-jobs",
"title": "Check Disabled SQL Agent Jobs",
"tags": ["tsql","sql-agent","jobs","configuration"],
"explanation": "Disabled jobs are not executed on their schedule. While sometimes intentional, disabled jobs can indicate incomplete setups or jobs that were disabled during troubleshooting and never re-enabled.",
"query": """\
SELECT
  j.name,
  j.description,
  j.date_created,
  j.date_modified,
  c.name AS category
FROM msdb.dbo.sysjobs j
JOIN msdb.dbo.syscategories c ON j.category_id = c.category_id
WHERE j.enabled = 0
ORDER BY j.date_modified DESC""",
"when_to_use": ["During a SQL Agent configuration review.","When expected maintenance jobs are not running."],
},
# ── QUERY STORE ───────────────────────────────────────────────────────────
{
"slug": "query-store-status",
"title": "Check Query Store Status and Configuration",
"tags": ["tsql","query-store","performance","configuration"],
"explanation": "Query Store (SQL Server 2016+) captures query performance history, enabling plan forcing and regression detection. This query shows whether it is enabled and how much space it is using.",
"query": """\
SELECT
  d.name,
  qso.desired_state_desc,
  qso.actual_state_desc,
  qso.readonly_reason,
  qso.current_storage_size_mb,
  qso.max_storage_size_mb,
  qso.flush_interval_seconds,
  qso.interval_length_minutes,
  qso.stale_query_threshold_days
FROM sys.databases d
JOIN sys.database_query_store_options qso ON d.database_id = qso.database_id
WHERE d.database_id > 4
ORDER BY d.name""",
"when_to_use": ["When verifying Query Store is active before a compatibility level upgrade.","When Query Store enters read-only mode due to space exhaustion."],
},
{
"slug": "query-store-top-cpu",
"title": "Check Top CPU-Consuming Queries in Query Store",
"tags": ["tsql","query-store","performance","cpu"],
"explanation": "Query Store retains historical query performance data, allowing you to identify the worst CPU consumers even for queries no longer in the plan cache. Run in the context of the target database.",
"query": """\
SELECT TOP 10
  qt.query_sql_text,
  rs.avg_cpu_time / 1000.0          AS avg_cpu_ms,
  rs.avg_duration / 1000.0          AS avg_duration_ms,
  rs.count_executions               AS execution_count,
  p.is_forced_plan,
  q.query_id
FROM sys.query_store_runtime_stats rs
JOIN sys.query_store_plan p  ON rs.plan_id = p.plan_id
JOIN sys.query_store_query q ON p.query_id = q.query_id
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
ORDER BY rs.avg_cpu_time DESC""",
"when_to_use": ["When investigating CPU-intensive workloads with a historical perspective.","To identify queries that regressed after an upgrade."],
},
{
"slug": "query-store-forced-plans",
"title": "Check Query Store Forced Plans",
"tags": ["tsql","query-store","forced-plan","performance"],
"explanation": "Forced plans in Query Store lock in a specific execution plan, preventing plan regressions. This query lists all currently forced plans so they can be reviewed and validated.",
"query": """\
SELECT
  q.query_id,
  qt.query_sql_text,
  p.plan_id,
  p.force_failure_count,
  p.last_force_failure_reason_desc,
  p.query_plan
FROM sys.query_store_plan p
JOIN sys.query_store_query q ON p.query_id = q.query_id
JOIN sys.query_store_query_text qt ON q.query_text_id = qt.query_text_id
WHERE p.is_forced_plan = 1
ORDER BY p.force_failure_count DESC""",
"when_to_use": ["During a post-upgrade review to check whether forced plans are still needed.","When a forced plan is failing to apply (force_failure_count > 0)."],
},
# ── IN-PROGRESS OPERATIONS ────────────────────────────────────────────────
{
"slug": "running-backups-restores",
"title": "Check In-Progress Backup and Restore Operations",
"tags": ["tsql","backup","restore","monitoring","progress"],
"explanation": "Backup and restore operations can run for hours. This query tracks active backup/restore sessions with percent complete and estimated finish time.",
"query": """\
SELECT
  r.session_id,
  r.command,
  DB_NAME(r.database_id)           AS db_name,
  r.percent_complete,
  r.start_time,
  CAST(r.estimated_completion_time / 60000.0 AS DECIMAL(8,1)) AS est_remaining_min,
  SUBSTRING(st.text, 1, 200)       AS sql_text
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE r.command IN ('BACKUP DATABASE','BACKUP LOG','RESTORE DATABASE','RESTORE LOG')
ORDER BY r.percent_complete""",
"when_to_use": ["During a backup or restore to track progress.","When a backup is taking longer than expected."],
},
{
"slug": "index-rebuild-progress",
"title": "Check In-Progress Index Rebuild Operations",
"tags": ["tsql","index-maintenance","progress","monitoring"],
"explanation": "Index rebuilds can be long-running. Monitoring their progress helps estimate completion time and detect stalled operations. ALTER INDEX operations appear in sys.dm_exec_requests.",
"query": """\
SELECT
  r.session_id,
  r.command,
  DB_NAME(r.database_id)          AS db_name,
  r.percent_complete,
  r.start_time,
  CAST(r.estimated_completion_time / 60000.0 AS DECIMAL(8,1)) AS est_remaining_min,
  SUBSTRING(st.text, 1, 200)      AS sql_text
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE r.command IN ('ALTER INDEX','DBCC')
   OR SUBSTRING(st.text, 1, 50) LIKE '%ALTER INDEX%'
ORDER BY r.percent_complete""",
"when_to_use": ["During scheduled index maintenance windows.","When an index rebuild is blocking other operations."],
},
{
"slug": "dbcc-progress",
"title": "Check In-Progress DBCC Operations",
"tags": ["tsql","dbcc","integrity-check","progress"],
"explanation": "DBCC CHECKDB is the primary tool for detecting database corruption but can run for hours on large databases. This query shows active DBCC sessions and their completion percentage.",
"query": """\
SELECT
  r.session_id,
  r.command,
  DB_NAME(r.database_id)           AS db_name,
  r.percent_complete,
  r.start_time,
  CAST(r.estimated_completion_time / 60000.0 AS DECIMAL(8,1)) AS est_remaining_min,
  SUBSTRING(st.text, 1, 200)       AS sql_text
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE r.command LIKE 'DBCC%'
ORDER BY r.percent_complete""",
"when_to_use": ["During scheduled integrity check maintenance.","When investigating data corruption."],
},
# ── ALWAYS ON ─────────────────────────────────────────────────────────────
{
"slug": "always-on-health",
"title": "Check Always On Availability Group Health",
"tags": ["tsql","always-on","availability-group","hadr","high-availability"],
"explanation": "Always On Availability Groups provide high availability and disaster recovery. This query shows synchronization state, role, and lag metrics for every replica and database.",
"query": """\
SELECT
  ag.name                             AS ag_name,
  ar.replica_server_name              AS replica,
  ar.availability_mode_desc,
  ar.failover_mode_desc,
  ars.role_desc                       AS role,
  ars.connected_state_desc,
  ars.synchronization_health_desc     AS sync_health,
  drs.database_name,
  drs.synchronization_state_desc      AS db_sync_state,
  drs.log_send_queue_size             AS log_send_queue_kb,
  drs.redo_queue_size                 AS redo_queue_kb,
  drs.last_commit_time
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar
  ON ag.group_id = ar.group_id
JOIN sys.dm_hadr_availability_replica_states ars
  ON ar.replica_id = ars.replica_id
LEFT JOIN sys.dm_hadr_database_replica_states drs
  ON ars.replica_id = drs.replica_id
ORDER BY ag.name, ars.role_desc, ar.replica_server_name""",
"when_to_use": ["During daily health checks for HA/DR environments.","When failover has occurred or is planned."],
},
{
"slug": "ag-log-send-queue",
"title": "Check AG Log Send and Redo Queue Size",
"tags": ["tsql","always-on","hadr","log-send","redo-queue","latency"],
"explanation": "Log send queue represents data not yet sent to the secondary; redo queue represents data received but not yet applied. Large queues mean data loss risk and slow failover recovery time.",
"query": """\
SELECT
  ag.name                            AS ag_name,
  ar.replica_server_name             AS secondary_replica,
  drs.database_name,
  drs.synchronization_state_desc,
  drs.log_send_queue_size            AS log_send_queue_kb,
  drs.log_send_rate                  AS log_send_rate_kb_sec,
  drs.redo_queue_size                AS redo_queue_kb,
  drs.redo_rate                      AS redo_rate_kb_sec,
  drs.last_sent_time,
  drs.last_hardened_time,
  drs.last_commit_time
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.availability_replicas ar  ON drs.replica_id = ar.replica_id
JOIN sys.availability_groups ag    ON ar.group_id = ag.group_id
JOIN sys.dm_hadr_availability_replica_states ars ON ar.replica_id = ars.replica_id
WHERE ars.role_desc = 'SECONDARY'
ORDER BY drs.log_send_queue_size DESC""",
"when_to_use": ["When monitoring AG RPO compliance.","When a secondary is falling behind due to redo bottleneck."],
},
{
"slug": "ag-failover-readiness",
"title": "Check AG Replica Failover Readiness",
"tags": ["tsql","always-on","hadr","failover","readiness"],
"explanation": "Before a planned failover, verify that the target secondary is in SYNCHRONIZED state with AUTOMATIC failover mode. Asynchronous or not-synchronized replicas cannot fail over automatically.",
"query": """\
SELECT
  ag.name                             AS ag_name,
  ar.replica_server_name,
  ar.availability_mode_desc,
  ar.failover_mode_desc,
  ars.role_desc,
  ars.synchronization_health_desc,
  ars.connected_state_desc,
  ars.operational_state_desc
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar
  ON ag.group_id = ar.group_id
JOIN sys.dm_hadr_availability_replica_states ars
  ON ar.replica_id = ars.replica_id
ORDER BY ag.name, ars.role_desc""",
"when_to_use": ["Before a planned failover or maintenance window.","When verifying HA configuration after replica changes."],
},
{
"slug": "ag-automatic-seeding-status",
"title": "Check AG Automatic Seeding Status",
"tags": ["tsql","always-on","hadr","seeding","automatic-seeding"],
"explanation": "Automatic seeding initialises secondary databases without manual backup/restore. Monitoring its progress and failure reasons helps troubleshoot AG join failures.",
"query": """\
SELECT
  local_database_name,
  role_desc,
  seeding_state_desc,
  seeding_source_state_desc,
  start_time,
  completion_time,
  failure_state_desc,
  error_code,
  performed_seeding
FROM sys.dm_hadr_automatic_seeding
ORDER BY start_time DESC""",
"when_to_use": ["When adding a new database to an AG with automatic seeding enabled.","When a secondary database fails to join the AG."],
},
# ── ACTIVE CONNECTIONS & SESSIONS ─────────────────────────────────────────
{
"slug": "active-connections",
"title": "Check Active Connections and Sessions",
"tags": ["tsql","connections","sessions","users"],
"explanation": "Too many connections can exhaust the connection pool or indicate a connection leak. This query groups active user sessions by database and login.",
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
"when_to_use": ["When the application reports 'max pool size reached' errors.","To audit which logins are connected and how many sessions each holds."],
},
{
"slug": "active-sessions-detail",
"title": "Check Detailed Active Session Information",
"tags": ["tsql","sessions","active-queries","monitoring"],
"explanation": "Returns a full picture of every active session including login, host, current SQL, wait type, and resource consumption. The DBA equivalent of 'who is doing what right now'.",
"query": """\
SELECT
  s.session_id,
  s.status,
  s.login_name,
  s.host_name,
  s.program_name,
  DB_NAME(r.database_id)          AS db_name,
  r.wait_type,
  r.wait_time / 1000.0            AS wait_sec,
  r.cpu_time                      AS cpu_ms,
  r.logical_reads,
  r.reads,
  r.writes,
  SUBSTRING(st.text, 1, 200)      AS current_sql
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests r  ON s.session_id = r.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) st
WHERE s.is_user_process = 1
ORDER BY r.cpu_time DESC""",
"when_to_use": ["As a replacement for sp_who2 with richer information.","When identifying which session is consuming the most resources at this moment."],
},
# ── MAINTENANCE ───────────────────────────────────────────────────────────
{
"slug": "suspect-pages",
"title": "Check Suspect Pages (Data Corruption Indicator)",
"tags": ["tsql","corruption","integrity","suspect-pages"],
"explanation": "The msdb.dbo.suspect_pages table records pages that triggered I/O errors. Any rows here indicate potential hardware or storage corruption and must be investigated immediately.",
"query": """\
SELECT
  DB_NAME(database_id)  AS db_name,
  file_id,
  page_id,
  event_type,
  CASE event_type
    WHEN 1 THEN '823 or 824 error'
    WHEN 2 THEN 'Bad checksum'
    WHEN 3 THEN 'Torn page'
    WHEN 4 THEN 'Restored'
    WHEN 5 THEN 'Repaired (DBCC)'
    WHEN 7 THEN 'Deallocated (DBCC)'
  END                   AS event_description,
  error_count,
  last_update_date
FROM msdb.dbo.suspect_pages
ORDER BY last_update_date DESC""",
"when_to_use": ["During any data integrity investigation.","After a storage event or hardware failure.","As part of a daily health check script."],
},
{
"slug": "recently-modified-objects",
"title": "Check Recently Modified Database Objects",
"tags": ["tsql","schema","change-tracking","auditing"],
"explanation": "Tracking recent schema changes helps correlate performance regressions or application errors with code deployments. SQL Server records modify_date for all objects.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(object_id) AS schema_name,
  name                          AS object_name,
  type_desc,
  create_date,
  modify_date
FROM sys.objects
WHERE modify_date > DATEADD(DAY, -7, GETDATE())
  AND is_ms_shipped = 0
ORDER BY modify_date DESC""",
"when_to_use": ["When a performance regression started recently and you need to identify schema changes.","After a deployment to verify which objects were modified."],
},
{
"slug": "database-snapshots",
"title": "Check Database Snapshots",
"tags": ["tsql","snapshot","storage","read-only"],
"explanation": "Database snapshots provide a read-only, point-in-time view of a database and grow over time as the source database changes. They consume disk space and can impact source database I/O.",
"query": """\
SELECT
  d.name                          AS snapshot_name,
  d.create_date                   AS created,
  SD.name                         AS source_database,
  mf.physical_name,
  mf.size * 8 / 1024.0            AS sparse_file_mb,
  DATEDIFF(HOUR, d.create_date, GETDATE()) AS age_hours
FROM sys.databases d
JOIN sys.master_files mf ON d.database_id = mf.database_id
JOIN sys.databases SD    ON d.source_database_id = SD.database_id
WHERE d.source_database_id IS NOT NULL
ORDER BY d.create_date DESC""",
"when_to_use": ["To audit existing snapshots before storage fills up.","Before taking a new snapshot to verify none are unexpectedly old."],
},
{
"slug": "linked-servers-list",
"title": "Check Configured Linked Servers",
"tags": ["tsql","linked-servers","configuration","security"],
"explanation": "Linked servers allow queries to be distributed across multiple SQL Server instances or OLE DB sources. They can be a security risk if credentials are stored with high privilege.",
"query": """\
SELECT
  s.name                    AS linked_server_name,
  s.product,
  s.provider,
  s.data_source,
  ll.uses_self_credential,
  ll.remote_name            AS maps_to_login,
  s.is_remote_login_enabled,
  s.modify_date
FROM sys.servers s
LEFT JOIN sys.linked_logins ll ON s.server_id = ll.server_id
WHERE s.is_linked = 1
ORDER BY s.name""",
"when_to_use": ["During a security or configuration audit.","When troubleshooting distributed query failures."],
},
{
"slug": "in-memory-tables",
"title": "Check In-Memory (Memory-Optimised) Tables",
"tags": ["tsql","in-memory-oltp","hekaton","memory","performance"],
"explanation": "In-Memory OLTP tables reside in memory and offer very high throughput for specific workloads. This query identifies which databases and tables use memory optimisation.",
"query": """\
SELECT
  DB_NAME()                              AS db_name,
  OBJECT_SCHEMA_NAME(t.object_id)        AS schema_name,
  t.name                                 AS table_name,
  t.durability_desc,
  SUM(ps.reserved_page_count) * 8 / 1024.0 AS reserved_mb
FROM sys.tables t
LEFT JOIN sys.dm_db_partition_stats ps ON t.object_id = ps.object_id
WHERE t.is_memory_optimized = 1
GROUP BY t.object_id, t.name, t.durability_desc
ORDER BY reserved_mb DESC""",
"when_to_use": ["To inventory in-memory tables before migrations or upgrades.","When troubleshooting memory pressure that correlates with In-Memory OLTP usage."],
},
{
"slug": "columnstore-indexes",
"title": "Check Columnstore Indexes",
"tags": ["tsql","columnstore","index","analytics","performance"],
"explanation": "Columnstore indexes provide massive compression and fast analytical queries on large datasets. This query lists all clustered and non-clustered columnstore indexes with their state.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(i.object_id)  AS schema_name,
  OBJECT_NAME(i.object_id)         AS table_name,
  i.name                           AS index_name,
  i.type_desc,
  i.is_disabled,
  rg.total_rows,
  rg.deleted_rows,
  rg.state_desc                    AS rowgroup_state
FROM sys.indexes i
LEFT JOIN sys.column_store_row_groups rg
  ON i.object_id = rg.object_id AND i.index_id = rg.index_id
WHERE i.type IN (5, 6)   -- 5=Clustered CS, 6=Non-clustered CS
ORDER BY schema_name, table_name""",
"when_to_use": ["Before migrating to or from a data warehouse.","When investigating columnstore compression ratios.","When diagnosing columnstore tuple-mover or rebuild issues."],
},
{
"slug": "read-only-single-user-databases",
"title": "Check Read-Only and Single-User Databases",
"tags": ["tsql","read-only","single-user","database-state"],
"explanation": "Databases in READ_ONLY or SINGLE_USER mode are inaccessible to normal application connections. This state is sometimes left accidentally after maintenance or troubleshooting.",
"query": """\
SELECT
  name,
  state_desc,
  user_access_desc,
  is_read_only,
  recovery_model_desc,
  log_reuse_wait_desc
FROM sys.databases
WHERE is_read_only = 1
   OR user_access_desc <> 'MULTI_USER'
   OR state_desc <> 'ONLINE'
ORDER BY state_desc, name""",
"when_to_use": ["When a database is inaccessible to applications.","After maintenance windows to verify all databases returned to normal state."],
},
{
"slug": "error-log-ring-buffer",
"title": "Check Recent SQL Server Errors (Ring Buffer)",
"tags": ["tsql","error-log","diagnostics","monitoring"],
"explanation": "The ring buffer captures recent SQL Server error events in memory. It provides fast access to recent exceptions without reading the error log file from disk.",
"query": """\
SELECT TOP 50
  xdr.value('@timestamp', 'datetime2')  AS error_time,
  xdr.value('(data[@name="error"]/value)[1]',   'int')     AS error_number,
  xdr.value('(data[@name="severity"]/value)[1]','int')     AS severity,
  xdr.value('(data[@name="message"]/value)[1]', 'nvarchar(4000)') AS message
FROM (
  SELECT CAST(target_data AS XML) target_data
  FROM sys.dm_xe_session_targets t
  JOIN sys.dm_xe_sessions s ON t.event_session_address = s.address
  WHERE s.name = 'system_health'
    AND t.target_name = 'ring_buffer'
) AS data
CROSS APPLY target_data.nodes('//RingBufferTarget/event[@name="error_reported"]') AS xdr_table(xdr)
ORDER BY error_time DESC""",
"when_to_use": ["When investigating recent errors that may not be in the error log yet.","During a quick diagnostics pass after an incident."],
},
{
"slug": "xe-sessions-active",
"title": "Check Active Extended Events Sessions",
"tags": ["tsql","extended-events","monitoring","diagnostics"],
"explanation": "Extended Events sessions collect detailed server-side diagnostics. Knowing which sessions are active avoids missed events and duplicate collection, and helps audit the monitoring setup.",
"query": """\
SELECT
  s.name                                          AS session_name,
  s.create_time,
  s.total_buffer_size / 1024                      AS buffer_kb,
  t.target_name,
  t.execution_count
FROM sys.dm_xe_sessions s
JOIN sys.dm_xe_session_targets t ON s.address = t.event_session_address
ORDER BY s.name, t.target_name""",
"when_to_use": ["Before adding a new XE session to check for conflicts.","When auditing what diagnostics are being collected on the instance."],
},
{
"slug": "active-transactions-count",
"title": "Check Active Transactions Count and Summary",
"tags": ["tsql","transactions","monitoring","concurrency"],
"explanation": "A sudden spike in active transactions indicates concurrency pressure. This query provides a count and breakdown of active transactions by type.",
"query": """\
SELECT
  CASE transaction_type
    WHEN 1 THEN 'Read/Write'
    WHEN 2 THEN 'Read-Only'
    WHEN 3 THEN 'System'
    WHEN 4 THEN 'Distributed'
    ELSE 'Unknown'
  END                     AS transaction_type,
  CASE transaction_state
    WHEN 0 THEN 'Uninitialized'
    WHEN 1 THEN 'Not yet started'
    WHEN 2 THEN 'Active'
    WHEN 3 THEN 'Ended (read-only)'
    WHEN 4 THEN 'Committed (DTC)'
    WHEN 5 THEN 'Prepared (DTC)'
    WHEN 6 THEN 'Committed'
    WHEN 7 THEN 'Rolling back'
    WHEN 8 THEN 'Rolled back'
    ELSE 'Unknown'
  END                     AS transaction_state,
  COUNT(*)                AS transaction_count
FROM sys.dm_tran_active_transactions
GROUP BY transaction_type, transaction_state
ORDER BY transaction_count DESC""",
"when_to_use": ["When concurrency problems arise and you need a high-level view of transaction activity.","When a distributed transaction coordinator issue is suspected."],
},
{
"slug": "log-backup-frequency",
"title": "Check Transaction Log Backup Frequency",
"tags": ["tsql","backup","log-backup","rpo","recovery"],
"explanation": "The interval between log backups determines the maximum data loss (RPO) for databases in FULL recovery. This query calculates the average and maximum gap between log backups over the last 24 hours.",
"query": """\
SELECT
  database_name,
  COUNT(*)                                        AS log_backups_24h,
  MIN(backup_finish_date)                         AS first_backup,
  MAX(backup_finish_date)                         AS last_backup,
  AVG(DATEDIFF(MINUTE,
    LAG(backup_finish_date) OVER (PARTITION BY database_name ORDER BY backup_finish_date),
    backup_finish_date))                          AS avg_interval_min,
  MAX(DATEDIFF(MINUTE,
    LAG(backup_finish_date) OVER (PARTITION BY database_name ORDER BY backup_finish_date),
    backup_finish_date))                          AS max_gap_min
FROM msdb.dbo.backupset
WHERE type = 'L'
  AND backup_finish_date > DATEADD(HOUR, -24, GETDATE())
GROUP BY database_name
ORDER BY max_gap_min DESC""",
"when_to_use": ["When verifying RPO compliance for FULL recovery databases.","When log backups are suspected to be running less frequently than required."],
},
{
"slug": "sp-configure-all",
"title": "Check All SQL Server Configuration Options",
"tags": ["tsql","sp-configure","server-configuration","settings"],
"explanation": "Returns all instance-level configuration options with their current, configured, and default values. Useful for full configuration snapshots or baseline comparisons.",
"query": """\
SELECT
  name,
  minimum,
  maximum,
  value             AS configured_value,
  value_in_use      AS running_value,
  value_default     AS default_value,
  is_advanced,
  is_dynamic,
  description
FROM sys.configurations
ORDER BY name""",
"when_to_use": ["When creating a configuration baseline.","After a SQL Server upgrade to verify settings."],
},
{
"slug": "filegroups-overview",
"title": "Check Filegroups and Their Files",
"tags": ["tsql","filegroups","storage","configuration"],
"explanation": "Filegroups organise database files and control where objects are stored. Understanding filegroup layout is essential for capacity planning and performance optimisation.",
"query": """\
SELECT
  fg.name                             AS filegroup_name,
  fg.type_desc,
  fg.is_default,
  fg.is_read_only,
  mf.name                             AS logical_filename,
  mf.physical_name,
  mf.size * 8 / 1024.0               AS size_mb,
  mf.growth,
  mf.is_percent_growth
FROM sys.filegroups fg
JOIN sys.database_files mf ON fg.data_space_id = mf.data_space_id
ORDER BY fg.name, mf.name""",
"when_to_use": ["When planning storage layout for a new database.","When investigating which filegroup an object should be moved to."],
},
{
"slug": "auto-close-databases",
"title": "Check Databases with Auto-Close Enabled",
"tags": ["tsql","auto-close","configuration","performance"],
"explanation": "Auto-close releases all database resources when the last user disconnects. On busy systems this causes repeated cold-start overhead (loading the buffer pool, recreating the plan cache). It should be disabled on production databases.",
"query": """\
SELECT name, is_auto_close_on, recovery_model_desc, state_desc, compatibility_level
FROM sys.databases
WHERE is_auto_close_on = 1
  AND database_id > 4
ORDER BY name""",
"when_to_use": ["During a database configuration audit.","When connection establishment is slow despite an existing connection pool."],
},
# ── DUPLICATE & OVERLAPPING INDEXES ───────────────────────────────────────
{
"slug": "duplicate-indexes",
"title": "Find Duplicate and Overlapping Indexes",
"tags": ["tsql","duplicate-indexes","index-tuning","storage","performance"],
"explanation": "Duplicate indexes waste storage and slow down INSERT/UPDATE/DELETE operations because SQL Server must maintain each copy. An index is a duplicate when its leading key columns match another index on the same table.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(i1.object_id)  AS schema_name,
  OBJECT_NAME(i1.object_id)         AS table_name,
  i1.name                           AS index1,
  i2.name                           AS index2,
  i1.type_desc,
  (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
   FROM sys.index_columns ic
   JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
   WHERE ic.object_id = i1.object_id AND ic.index_id = i1.index_id AND ic.is_included_column = 0
  ) AS index1_keys,
  (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
   FROM sys.index_columns ic
   JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
   WHERE ic.object_id = i2.object_id AND ic.index_id = i2.index_id AND ic.is_included_column = 0
  ) AS index2_keys
FROM sys.indexes i1
JOIN sys.indexes i2
  ON  i1.object_id = i2.object_id
  AND i1.index_id  < i2.index_id
  AND i1.type_desc = i2.type_desc
WHERE i1.type > 0
  AND (
    SELECT STRING_AGG(CAST(ic.column_id AS VARCHAR), ',') WITHIN GROUP (ORDER BY ic.key_ordinal)
    FROM sys.index_columns ic WHERE ic.object_id = i1.object_id AND ic.index_id = i1.index_id AND ic.is_included_column = 0
  ) =
  (
    SELECT STRING_AGG(CAST(ic.column_id AS VARCHAR), ',') WITHIN GROUP (ORDER BY ic.key_ordinal)
    FROM sys.index_columns ic WHERE ic.object_id = i2.object_id AND ic.index_id = i2.index_id AND ic.is_included_column = 0
  )
ORDER BY schema_name, table_name""",
"when_to_use": ["During an index consolidation exercise.","When storage usage is unexpectedly high and you suspect redundant indexes."],
},
# ── FILL FACTOR ───────────────────────────────────────────────────────────
{
"slug": "index-fill-factor",
"title": "Check Index Fill Factor Settings",
"tags": ["tsql","fill-factor","index-maintenance","fragmentation"],
"explanation": "Fill factor determines how full index leaf pages are when rebuilt. A fill factor of 0 or 100 means fully packed pages, which causes page splits on INSERT and UPDATE-heavy tables. Values between 70-90 are typical for OLTP workloads.",
"query": """\
SELECT
  OBJECT_SCHEMA_NAME(i.object_id)   AS schema_name,
  OBJECT_NAME(i.object_id)          AS table_name,
  i.name                            AS index_name,
  i.type_desc,
  i.fill_factor,
  i.is_disabled,
  p.rows                            AS row_count
FROM sys.indexes i
JOIN sys.partitions p
  ON  i.object_id = p.object_id
  AND i.index_id  = p.index_id
  AND p.partition_number = 1
WHERE i.type > 0
  AND OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
  AND (i.fill_factor NOT BETWEEN 80 AND 100 OR i.fill_factor = 0)
ORDER BY schema_name, table_name, i.index_id""",
"when_to_use": ["After an index rebuild to verify fill factor was applied correctly.","When investigating excessive page splits (check with sys.dm_db_index_operational_stats)."],
},
# ── REPLICATION ───────────────────────────────────────────────────────────
{
"slug": "replication-status",
"title": "Check Replication Publication and Subscription Status",
"tags": ["tsql","replication","monitoring","high-availability"],
"explanation": "Transactional replication lag and subscription errors can cause data divergence between publisher and subscriber. This query surfaces all active publications and subscription latency where replication metadata is available.",
"query": """\
-- Publications on this server
SELECT
  name            AS publication_name,
  publication_type,
  status,
  sync_method,
  repl_freq
FROM distribution..MSpublications
ORDER BY name;

-- Subscriptions and their status
SELECT
  s.publication,
  s.subscriber_db,
  s.status,
  s.last_sync_summary,
  s.last_sync_datetime
FROM distribution..MSsubscriptions s
ORDER BY s.last_sync_datetime DESC""",
"when_to_use": ["When data divergence is suspected between publisher and subscriber.","During a replication health check after a failover."],
},
# ── NETWORK STATS ─────────────────────────────────────────────────────────
{
"slug": "network-io-stats",
"title": "Check Network IO Stats per Session",
"tags": ["tsql","network","io","sessions","performance"],
"explanation": "Excessive network I/O from a single session can saturate bandwidth and slow all clients. This query ranks active sessions by bytes sent and received since the connection was established.",
"query": """\
SELECT TOP 20
  s.session_id,
  s.login_name,
  s.host_name,
  s.program_name,
  s.status,
  c.num_reads,
  c.num_writes,
  c.net_packet_size,
  c.client_net_address,
  r.command,
  r.wait_type,
  r.total_elapsed_time / 1000     AS elapsed_sec
FROM sys.dm_exec_sessions s
JOIN sys.dm_exec_connections c ON s.session_id = c.session_id
LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id
WHERE s.is_user_process = 1
ORDER BY c.num_reads + c.num_writes DESC""",
"when_to_use": ["When network bandwidth is saturated and you need to identify the source.","During a capacity planning review of client traffic patterns."],
},
# ── TEMPDB CONTENTION ─────────────────────────────────────────────────────
{
"slug": "tempdb-contention",
"title": "Check TempDB Allocation Contention (PAGELATCH)",
"tags": ["tsql","tempdb","contention","latch","performance"],
"explanation": "PAGELATCH_UP or PAGELATCH_EX waits on TempDB pages 2 or 3 indicate allocation bitmap contention. The primary remediation is to ensure TempDB has one data file per CPU core (up to 8), all of equal size.",
"query": """\
-- Check for latch waits on TempDB allocation pages
SELECT
  wait_type,
  waiting_tasks_count,
  wait_time_ms,
  max_wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_type LIKE 'PAGELATCH%'
ORDER BY wait_time_ms DESC;

-- Count of TempDB data files
SELECT COUNT(*) AS tempdb_data_files
FROM sys.master_files
WHERE database_id = 2 AND type = 0;

-- Size and autogrowth of each TempDB file
SELECT
  name, physical_name,
  size * 8 / 1024    AS size_mb,
  growth,
  is_percent_growth
FROM sys.master_files
WHERE database_id = 2
ORDER BY file_id""",
"when_to_use": ["When PAGELATCH_UP or PAGELATCH_EX waits are among the top waits.","After adding CPUs to verify TempDB file count is adequate."],
},
# ── QUERY STORE REGRESSED QUERIES ─────────────────────────────────────────
{
"slug": "query-store-regressed-queries",
"title": "Find Regressed Queries in Query Store",
"tags": ["tsql","query-store","performance","regression","plan-change"],
"explanation": "Query Store tracks plan changes and performance over time. A regressed query is one whose average duration has worsened significantly after a plan change, making it a prime candidate for forced plan or investigation.",
"query": """\
SELECT TOP 20
  q.query_id,
  qt.query_sql_text,
  rs1.avg_duration / 1000.0   AS avg_duration_before_ms,
  rs2.avg_duration / 1000.0   AS avg_duration_after_ms,
  CAST((rs2.avg_duration - rs1.avg_duration) * 100.0
    / NULLIF(rs1.avg_duration, 0) AS DECIMAL(10,1)) AS pct_regression,
  p1.plan_id                  AS old_plan_id,
  p2.plan_id                  AS new_plan_id
FROM sys.query_store_query q
JOIN sys.query_store_query_text qt  ON q.query_text_id    = qt.query_text_id
JOIN sys.query_store_plan p1        ON q.query_id         = p1.query_id
JOIN sys.query_store_plan p2        ON q.query_id         = p2.query_id AND p2.plan_id > p1.plan_id
JOIN sys.query_store_runtime_stats rs1 ON p1.plan_id = rs1.plan_id
JOIN sys.query_store_runtime_stats rs2 ON p2.plan_id = rs2.plan_id
WHERE rs2.avg_duration > rs1.avg_duration * 1.5  -- at least 50% worse
ORDER BY pct_regression DESC""",
"when_to_use": ["After an application or index change where query performance degraded.","During periodic Query Store review to catch silent regressions."],
},
# ── DATABASE GROWTH TREND ─────────────────────────────────────────────────
{
"slug": "database-growth-trend",
"title": "Estimate Database Growth from Backup History",
"tags": ["tsql","growth","capacity-planning","backup-history"],
"explanation": "Backup history stores the compressed and uncompressed size of each backup. By comparing sizes over time for the same database you can estimate monthly growth and project when the disk will run out.",
"query": """\
SELECT
  database_name,
  CAST(backup_finish_date AS DATE)     AS backup_date,
  type,
  MAX(backup_size) / 1024 / 1024       AS backup_size_mb,
  MAX(compressed_backup_size) / 1024 / 1024 AS compressed_mb
FROM msdb.dbo.backupset
WHERE type = 'D'   -- full backups only
  AND backup_finish_date >= DATEADD(MONTH, -6, GETDATE())
GROUP BY database_name, CAST(backup_finish_date AS DATE), type
ORDER BY database_name, backup_date""",
"when_to_use": ["During capacity planning to estimate when disks will fill up.","When negotiating storage provisioning for a new database or environment."],
},
# ── PERFORMANCE COUNTERS ───────────────────────────────────────────────────
{
"slug": "performance-counters-summary",
"title": "Check Key SQL Server Performance Counters",
"tags": ["tsql","performance","dmv","counters","monitoring"],
"explanation": "sys.dm_os_performance_counters surfaces the same metrics as Windows PerfMon but from inside T-SQL. Key counters include Batch Requests/sec, Buffer cache hit ratio, Lazy writes/sec, and Page life expectancy.",
"query": """\
SELECT
  object_name,
  counter_name,
  instance_name,
  cntr_value,
  cntr_type
FROM sys.dm_os_performance_counters
WHERE counter_name IN (
  'Batch Requests/sec',
  'SQL Compilations/sec',
  'SQL Re-Compilations/sec',
  'Buffer cache hit ratio',
  'Page life expectancy',
  'Lazy writes/sec',
  'Checkpoint pages/sec',
  'Log Flushes/sec',
  'Log Flush Wait Time',
  'Transactions/sec',
  'Lock Requests/sec',
  'Lock Waits/sec',
  'Deadlocks/sec',
  'Full Scans/sec',
  'Index Searches/sec',
  'User Connections'
)
ORDER BY object_name, counter_name""",
"when_to_use": ["When building a performance baseline.","When investigating unexpected workload changes without a monitoring tool."],
},
# ── JOB SCHEDULE OVERVIEW ─────────────────────────────────────────────────
{
"slug": "job-schedules-overview",
"title": "Check SQL Agent Job Schedules",
"tags": ["tsql","sql-agent","jobs","schedule","maintenance"],
"explanation": "Understanding when SQL Agent jobs are scheduled helps prevent maintenance overlaps (e.g. backup + index rebuild running simultaneously) and validates that critical jobs have not lost their schedules after a migration.",
"query": """\
SELECT
  j.name                AS job_name,
  j.enabled             AS job_enabled,
  s.name                AS schedule_name,
  s.enabled             AS schedule_enabled,
  s.freq_type,
  CASE s.freq_type
    WHEN 1  THEN 'Once'
    WHEN 4  THEN 'Daily'
    WHEN 8  THEN 'Weekly'
    WHEN 16 THEN 'Monthly'
    WHEN 32 THEN 'Monthly relative'
    WHEN 64 THEN 'On SQL Agent start'
    WHEN 128 THEN 'On idle'
    ELSE 'Unknown'
  END                   AS freq_desc,
  s.freq_interval,
  s.active_start_time,
  s.active_end_time,
  js.next_run_date,
  js.next_run_time
FROM msdb.dbo.sysjobs j
JOIN msdb.dbo.sysjobschedules js ON j.job_id = js.job_id
JOIN msdb.dbo.sysschedules s    ON js.schedule_id = s.schedule_id
ORDER BY j.name, s.name""",
"when_to_use": ["After migrating SQL Agent jobs to a new server to verify schedules are intact.","When planning maintenance windows to avoid job conflicts."],
},
# ── MISSING STATISTICS ────────────────────────────────────────────────────
{
"slug": "missing-statistics",
"title": "Check Tables with Missing or Auto-Created Statistics",
"tags": ["tsql","statistics","auto-stats","query-tuning"],
"explanation": "SQL Server creates statistics automatically on columns used in WHERE or JOIN clauses when auto-create statistics is ON. Tables with no statistics at all are a risk; auto-created statistics are a sign that manual statistics were not maintained proactively.",
"query": """\
-- Tables in the current database with zero statistics
SELECT
  OBJECT_SCHEMA_NAME(t.object_id) AS schema_name,
  t.name                           AS table_name,
  p.rows                           AS row_count,
  COUNT(s.stats_id)                AS stats_count
FROM sys.tables t
JOIN sys.partitions p
  ON  t.object_id = p.object_id
  AND p.index_id IN (0, 1)
  AND p.partition_number = 1
LEFT JOIN sys.stats s
  ON  t.object_id = s.object_id
WHERE t.is_ms_shipped = 0
GROUP BY t.object_id, t.name, p.rows
HAVING COUNT(s.stats_id) = 0
   AND p.rows > 1000
ORDER BY p.rows DESC;

-- Auto-created statistics (not associated with an index)
SELECT TOP 50
  OBJECT_SCHEMA_NAME(s.object_id) AS schema_name,
  OBJECT_NAME(s.object_id)        AS table_name,
  s.name                          AS stats_name,
  s.auto_created,
  sp.last_updated,
  sp.rows,
  sp.rows_sampled,
  sp.modification_counter
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE s.auto_created = 1
  AND OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
ORDER BY sp.modification_counter DESC""",
"when_to_use": ["When the query optimizer is producing bad cardinality estimates.","During post-migration health checks to ensure statistics were transferred."],
},
# ── LINKED SERVER SECURITY ────────────────────────────────────────────────
{
"slug": "linked-server-security",
"title": "Check Linked Server Security and Login Mappings",
"tags": ["tsql","linked-servers","security","remote-access"],
"explanation": "Linked servers can be configured to pass the caller's credentials or to use a fixed remote login. Fixed logins stored with elevated permissions are a significant security risk and should be audited regularly.",
"query": """\
SELECT
  ls.name                  AS linked_server_name,
  ls.product,
  ls.provider,
  ls.data_source,
  ls.is_remote_login_enabled,
  ls.is_rpc_out_enabled,
  lsl.uses_self_credential,
  lsl.remote_name          AS mapped_remote_login
FROM sys.servers ls
LEFT JOIN sys.linked_logins lsl
  ON ls.server_id = lsl.server_id
WHERE ls.is_linked = 1
ORDER BY ls.name""",
"when_to_use": ["During a security audit to check for hardcoded remote credentials.","After migrating to a new server to verify linked server configuration."],
},
# ── WAIT STATS RESET TRACKING ─────────────────────────────────────────────
{
"slug": "wait-stats-snapshot-delta",
"title": "Capture Wait Statistics Delta Between Two Points",
"tags": ["tsql","wait-statistics","performance","monitoring","baseline"],
"explanation": "Cumulative wait stats since the last restart are useful for long-term trending, but for diagnosing a current incident you need the delta over a short interval. This script captures a snapshot, waits, then computes the difference.",
"query": """\
-- Step 1: Capture baseline into a temp table
SELECT wait_type, waiting_tasks_count, wait_time_ms, signal_wait_time_ms
INTO #wait_snap1
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
  'SLEEP_TASK','LAZYWRITER_SLEEP','LOGMGR_QUEUE','REQUEST_FOR_DEADLOCK_SEARCH',
  'RESOURCE_QUEUE','SERVER_IDLE_CHECK','SLEEP_DBSTARTUP','SLEEP_DCOMSTARTUP',
  'SLEEP_MASTERDBREADY','SLEEP_MASTERMDREADY','SLEEP_TEMPDBSTARTUP',
  'WAITFOR','XE_DISPATCHER_WAIT','XE_TIMER_EVENT','BROKER_TO_FLUSH',
  'DISPATCHER_QUEUE_SEMAPHORE','ONDEMAND_TASK_QUEUE','SP_SERVER_DIAGNOSTICS_SLEEP'
);

-- Step 2: Wait 60 seconds then run the delta query
WAITFOR DELAY '00:01:00';

-- Step 3: Compute delta
SELECT TOP 15
  s2.wait_type,
  s2.waiting_tasks_count - s1.waiting_tasks_count    AS new_tasks,
  (s2.wait_time_ms - s1.wait_time_ms) / 1000.0       AS wait_sec_delta,
  CAST(100.0 * (s2.wait_time_ms - s1.wait_time_ms)
    / NULLIF(SUM(s2.wait_time_ms - s1.wait_time_ms) OVER (), 0)
    AS DECIMAL(5,2))                                  AS pct_of_delta
FROM sys.dm_os_wait_stats s2
JOIN #wait_snap1 s1 ON s2.wait_type = s1.wait_type
WHERE s2.wait_time_ms > s1.wait_time_ms
ORDER BY wait_sec_delta DESC;

DROP TABLE #wait_snap1""",
"when_to_use": ["During a live performance incident to identify what the server is waiting on right now.","When cumulative wait stats are dominated by historical waits that predate the current issue."],
},
]

# ---------------------------------------------------------------------------
# Card generation
# ---------------------------------------------------------------------------

def _render_card(card: dict) -> str:
    tags_yaml = "\n".join(f"  - {t}" for t in card["tags"])
    when_bullets = "\n".join(f"- {w}" for w in card["when_to_use"])
    return (
        f"---\n"
        f"title: {card['title']}\n"
        f"tags:\n{tags_yaml}\n"
        f"type: dba-reference\n"
        f"source: dba-reference/{card['slug']}\n"
        f"---\n\n"
        f"# {card['title']}\n\n"
        f"{card['explanation']}\n\n"
        f"## T-SQL Query\n\n"
        f"```sql\n{card['query']}\n```\n\n"
        f"## When to Use\n\n"
        f"{when_bullets}\n"
    )


def generate_cards(output_dir: Path) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for card in CARDS:
        path = output_dir / f"DBA - {card['title']}.md"
        path.write_text(_render_card(card), encoding="utf-8")
        print(f"  OK  {path.name}")
        count += 1
    return count


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(f"Generating {len(CARDS)} DBA reference cards -> {OUTPUT_DIR}")
    n = generate_cards(OUTPUT_DIR)
    print(f"\nGenerated {n} cards. Syncing to SQLite...")
    sync_vault_to_sqlite(VAULT_DIR, DB_PATH)
    print("Done.")
