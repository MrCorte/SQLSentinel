-- SQLSentinel persistence backend — SQL Server 2025
--
-- Part 1: SQLSentinelDB — app persistence database
--   All tables that replace SQLite: settings, db_custom_fields,
--   metrics_snapshots, users, sessions, rag_documents, rag_chunks
--   rag_chunks uses vector(1536) — requires SQL Server 2025
--   DiskANN vector index is optional because some 2025 container builds expose
--   the vector type before accepting CREATE VECTOR INDEX syntax.
--
-- Part 2: SentinelAppDB — test target database
--   Realistic workload data for monitoring/collector testing
--
-- App connection:
--   Host: localhost   Port: 1437
--   Login (app):  ${SQLSENTINEL_APP_USER} / ${SQLSENTINEL_APP_PASSWORD}
--   Login (admin): ${SQLSENTINEL_DOCK_USER} / ${SQLSENTINEL_DOCK_PASSWORD}
--   Login (sa):   sa              / ${SQLSENTINEL_STORAGE_SA_PASSWORD}

-- ── Part 1: Persistence database ───────────────────────────────────────────

USE master;
GO

DECLARE @dockLogin sysname = N'$(DockUser)';
DECLARE @dockPassword NVARCHAR(128) = N'$(DockPassword)';
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @dockLogin)
BEGIN
    DECLARE @dockSql NVARCHAR(MAX) =
        N'CREATE LOGIN ' + QUOTENAME(@dockLogin) +
        N' WITH PASSWORD = ' + QUOTENAME(@dockPassword, '''') +
        N', CHECK_POLICY = ON';
    EXEC(@dockSql);
END
GO
DECLARE @dockLogin sysname = N'$(DockUser)';
IF IS_SRVROLEMEMBER(N'sysadmin', @dockLogin) <> 1
BEGIN
    DECLARE @dockRoleSql NVARCHAR(MAX) =
        N'ALTER SERVER ROLE sysadmin ADD MEMBER ' + QUOTENAME(@dockLogin);
    EXEC(@dockRoleSql);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = N'SQLSentinelDB')
    CREATE DATABASE SQLSentinelDB;
GO

USE SQLSentinelDB;
GO

-- App login — least privilege: only needs this database
DECLARE @appLogin sysname = N'$(AppUser)';
DECLARE @appPassword NVARCHAR(128) = N'$(AppPassword)';
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @appLogin)
BEGIN
    DECLARE @appLoginSql NVARCHAR(MAX) =
        N'CREATE LOGIN ' + QUOTENAME(@appLogin) +
        N' WITH PASSWORD = ' + QUOTENAME(@appPassword, '''') +
        N', CHECK_POLICY = ON';
    EXEC(@appLoginSql);
END
GO
DECLARE @appLogin sysname = N'$(AppUser)';
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @appLogin)
BEGIN
    DECLARE @appUserSql NVARCHAR(MAX) =
        N'CREATE USER ' + QUOTENAME(@appLogin) + N' FOR LOGIN ' + QUOTENAME(@appLogin);
    EXEC(@appUserSql);
END
GO
DECLARE @appLogin sysname = N'$(AppUser)';
DECLARE @appRoleSql NVARCHAR(MAX) =
    N'ALTER ROLE db_owner ADD MEMBER ' + QUOTENAME(@appLogin);
EXEC(@appRoleSql);
GO

-- settings
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'settings')
CREATE TABLE dbo.settings (
    [key]   NVARCHAR(200) NOT NULL PRIMARY KEY,
    value   NVARCHAR(MAX) NOT NULL
);
GO

-- db_custom_fields
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'db_custom_fields')
CREATE TABLE dbo.db_custom_fields (
    id        NVARCHAR(400) NOT NULL PRIMARY KEY,  -- '{serverId}/{dbName}'
    alias     NVARCHAR(200) NULL,
    referente NVARCHAR(200) NULL
);
GO

-- metrics_snapshots
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'metrics_snapshots')
CREATE TABLE dbo.metrics_snapshots (
    id           NVARCHAR(36)  NOT NULL PRIMARY KEY,
    server_id    NVARCHAR(36)  NOT NULL,
    collected_at DATETIME2     NOT NULL,
    metrics_json NVARCHAR(MAX) NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.metrics_snapshots') AND name = N'IX_metrics_server_collected')
    CREATE INDEX IX_metrics_server_collected ON dbo.metrics_snapshots(server_id, collected_at DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.metrics_snapshots') AND name = N'IX_metrics_cleanup')
    CREATE INDEX IX_metrics_cleanup ON dbo.metrics_snapshots(collected_at);
GO

-- users
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'users')
CREATE TABLE dbo.users (
    id                   NVARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT LOWER(CONVERT(NVARCHAR(36), NEWID())),
    username             NVARCHAR(200) NOT NULL UNIQUE,
    password             NVARCHAR(500) NOT NULL,
    role                 NVARCHAR(50)  NOT NULL DEFAULT N'viewer',
    created_at           BIGINT        NOT NULL DEFAULT DATEDIFF_BIG(SECOND, '1970-01-01', GETUTCDATE()),
    last_login           BIGINT        NULL,
    must_change_password BIT           NOT NULL DEFAULT 0
);
GO

-- sessions
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'sessions')
CREATE TABLE dbo.sessions (
    token      NVARCHAR(64)  NOT NULL PRIMARY KEY,
    user_id    NVARCHAR(36)  NOT NULL,
    username   NVARCHAR(200) NOT NULL,
    role       NVARCHAR(50)  NOT NULL,
    expires_at BIGINT        NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.sessions') AND name = N'IX_sessions_expires')
    CREATE INDEX IX_sessions_expires ON dbo.sessions(expires_at);
GO

-- rag_documents
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'rag_documents')
CREATE TABLE dbo.rag_documents (
    id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
    filename    NVARCHAR(500) NOT NULL UNIQUE,
    file_size   BIGINT        NOT NULL,
    indexed_at  NVARCHAR(50)  NOT NULL,
    chunk_count INT           NOT NULL DEFAULT 0
);
GO

-- rag_chunks — vector(1536) requires SQL Server 2025
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'rag_chunks')
CREATE TABLE dbo.rag_chunks (
    id          NVARCHAR(36)  NOT NULL PRIMARY KEY,
    document_id NVARCHAR(36)  NOT NULL REFERENCES dbo.rag_documents(id) ON DELETE CASCADE,
    chunk_index INT           NOT NULL,
    text        NVARCHAR(MAX) NOT NULL,
    embedding   vector(1536)  NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.rag_chunks') AND name = N'IX_rag_chunks_doc')
    CREATE INDEX IX_rag_chunks_doc ON dbo.rag_chunks(document_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.rag_chunks') AND name = N'IX_rag_chunks_vec')
BEGIN
    BEGIN TRY
        EXEC(N'CREATE VECTOR INDEX IX_rag_chunks_vec ON dbo.rag_chunks (embedding) USING DISKANN WITH (VECTOR_DISTANCE_FUNCTION = ''cosine'')');
    END TRY
    BEGIN CATCH
        PRINT N'Optional vector index IX_rag_chunks_vec skipped: ' + ERROR_MESSAGE();
    END CATCH
END
GO

-- Default app settings (mirrors SQLite defaults in settings.ts)
IF (SELECT COUNT(*) FROM dbo.settings) = 0
BEGIN
    INSERT INTO dbo.settings ([key], value) VALUES
        (N'retentionMinutes',              N'60'),
        (N'background_enabled',            N'true'),
        (N'background_mode',               N'light'),
        (N'background_interval_minutes',   N'30'),
        (N'background_notifications',      N'true'),
        (N'theme_mode',                    N'system');
END
GO

-- ── Part 2: SentinelAppDB — monitored target for collector testing ──────────

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = N'SentinelAppDB')
    CREATE DATABASE SentinelAppDB;
GO

USE SentinelAppDB;
GO

-- Monitor login (read-only access to DMVs)
USE master;
GO
DECLARE @monitorLogin sysname = N'$(MonitorUser)';
DECLARE @monitorPassword NVARCHAR(128) = N'$(MonitorPassword)';
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @monitorLogin)
BEGIN
    DECLARE @monitorLoginSql NVARCHAR(MAX) =
        N'CREATE LOGIN ' + QUOTENAME(@monitorLogin) +
        N' WITH PASSWORD = ' + QUOTENAME(@monitorPassword, '''') +
        N', CHECK_POLICY = ON';
    EXEC(@monitorLoginSql);
END
GO
DECLARE @monitorLogin sysname = N'$(MonitorUser)';
DECLARE @monitorGrantSql NVARCHAR(MAX) =
    N'GRANT VIEW SERVER STATE TO ' + QUOTENAME(@monitorLogin) + N'; ' +
    N'GRANT VIEW ANY DATABASE TO ' + QUOTENAME(@monitorLogin) + N';';
EXEC(@monitorGrantSql);
GO
USE SentinelAppDB;
GO
DECLARE @monitorLogin sysname = N'$(MonitorUser)';
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @monitorLogin)
BEGIN
    DECLARE @monitorUserSql NVARCHAR(MAX) =
        N'CREATE USER ' + QUOTENAME(@monitorLogin) + N' FOR LOGIN ' + QUOTENAME(@monitorLogin);
    EXEC(@monitorUserSql);
END
GO
DECLARE @monitorLogin sysname = N'$(MonitorUser)';
EXEC sp_addrolemember N'db_datareader', @monitorLogin;
GO
USE msdb;
GO
DECLARE @monitorLogin sysname = N'$(MonitorUser)';
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @monitorLogin)
BEGIN
    DECLARE @monitorMsdbUserSql NVARCHAR(MAX) =
        N'CREATE USER ' + QUOTENAME(@monitorLogin) + N' FOR LOGIN ' + QUOTENAME(@monitorLogin);
    EXEC(@monitorMsdbUserSql);
END
GO
DECLARE @monitorLogin sysname = N'$(MonitorUser)';
EXEC sp_addrolemember N'db_datareader', @monitorLogin;
GO

USE SentinelAppDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'Servers')
CREATE TABLE dbo.Servers (
    Id          INT IDENTITY PRIMARY KEY,
    Hostname    NVARCHAR(200) NOT NULL,
    Port        INT           NOT NULL DEFAULT 1433,
    Environment NVARCHAR(50)  NOT NULL,
    AddedAt     DATETIME2     NOT NULL DEFAULT GETDATE(),
    IsActive    BIT           NOT NULL DEFAULT 1
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'MetricSnapshots')
CREATE TABLE dbo.MetricSnapshots (
    Id              BIGINT IDENTITY PRIMARY KEY,
    ServerId        INT            NOT NULL REFERENCES dbo.Servers(Id),
    CollectedAt     DATETIME2      NOT NULL DEFAULT GETDATE(),
    CpuPercent      DECIMAL(5,2),
    MemoryUsedMb    INT,
    ActiveSessions  INT,
    BlockedSessions INT
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'Alerts')
CREATE TABLE dbo.Alerts (
    Id          BIGINT IDENTITY PRIMARY KEY,
    ServerId    INT           NOT NULL REFERENCES dbo.Servers(Id),
    Severity    NVARCHAR(20)  NOT NULL,
    MetricName  NVARCHAR(100) NOT NULL,
    Threshold   DECIMAL(10,2),
    ActualValue DECIMAL(10,2),
    FiredAt     DATETIME2     NOT NULL DEFAULT GETDATE(),
    ResolvedAt  DATETIME2     NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.MetricSnapshots') AND name = N'IX_MetricSnapshots_ServerId_CollectedAt')
    CREATE INDEX IX_MetricSnapshots_ServerId_CollectedAt ON dbo.MetricSnapshots(ServerId, CollectedAt DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Alerts') AND name = N'IX_Alerts_ServerId_FiredAt')
    CREATE INDEX IX_Alerts_ServerId_FiredAt ON dbo.Alerts(ServerId, FiredAt DESC);
GO

IF (SELECT COUNT(*) FROM dbo.Servers) = 0
BEGIN
    INSERT INTO dbo.Servers (Hostname, Port, Environment) VALUES
        (N'sql-prod',    1433, N'Production'),
        (N'sql-dev',     1433, N'Development'),
        (N'sql-staging', 1433, N'Staging'),
        (N'sql-dr',      1433, N'DR');

    DECLARE @s INT = 0;
    WHILE @s < 200
    BEGIN
        INSERT INTO dbo.MetricSnapshots (ServerId, CollectedAt, CpuPercent, MemoryUsedMb, ActiveSessions, BlockedSessions) VALUES
            (1, DATEADD(minute, -@s,     GETDATE()), ROUND(RAND()*80+5,  2), ROUND(RAND()*4096+512, 0), ROUND(RAND()*20, 0), ROUND(RAND()*2, 0)),
            (2, DATEADD(minute, -@s,     GETDATE()), ROUND(RAND()*30+2,  2), ROUND(RAND()*2048+256, 0), ROUND(RAND()*5,  0), 0),
            (3, DATEADD(minute, -@s * 2, GETDATE()), ROUND(RAND()*50+10, 2), ROUND(RAND()*3072+512, 0), ROUND(RAND()*10, 0), ROUND(RAND()*1, 0));
        SET @s = @s + 1;
    END

    INSERT INTO dbo.Alerts (ServerId, Severity, MetricName, Threshold, ActualValue, FiredAt, ResolvedAt) VALUES
        (1, N'critical', N'cpu_percent',       80,  92.5, DATEADD(hour, -2,  GETDATE()), DATEADD(hour,   -1, GETDATE())),
        (1, N'warning',  N'memory_used_mb',  3072, 3500.0, DATEADD(hour, -5,  GETDATE()), DATEADD(hour,   -4, GETDATE())),
        (2, N'warning',  N'active_sessions',   10,   13.0, DATEADD(day,  -1,  GETDATE()), DATEADD(day,    -1, GETDATE())),
        (1, N'critical', N'blocked_sessions',   3,    7.0, DATEADD(minute,-30, GETDATE()), NULL);
END
GO

-- Seed query plan cache for queryTopQueries collector
CREATE OR ALTER PROCEDURE dbo.usp_SeedQueryCache AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @i INT = 0;
    WHILE @i < 10
    BEGIN
        SELECT COUNT(*) FROM dbo.MetricSnapshots WHERE ServerId = 1 AND CpuPercent > 50;
        SELECT TOP 5 * FROM dbo.Alerts WHERE ResolvedAt IS NULL ORDER BY FiredAt DESC;
        SELECT s.Hostname, COUNT(m.Id) AS cnt, AVG(m.CpuPercent) AS avg_cpu
          FROM dbo.Servers s
          JOIN dbo.MetricSnapshots m ON m.ServerId = s.Id
         WHERE m.CollectedAt > DATEADD(hour, -1, GETDATE())
         GROUP BY s.Hostname;
        SET @i = @i + 1;
    END
END
GO
EXEC dbo.usp_SeedQueryCache;
GO

-- Write smoke-test backups so msdb.dbo.backupset has rows for queryBackupStatus collector
USE master;
GO
BACKUP DATABASE SentinelAppDB TO DISK = N'/var/opt/mssql/data/SentinelAppDB-smoke.bak' WITH FORMAT, INIT, SKIP;
BACKUP DATABASE SQLSentinelDB TO DISK = N'/var/opt/mssql/data/SQLSentinelDB-smoke.bak' WITH FORMAT, INIT, SKIP;
GO
