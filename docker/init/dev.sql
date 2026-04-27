-- Development server: 2 databases, minimal data, frequent schema changes
-- Tests: low-activity server, schema-only DBs, nullable columns

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'DevAppDB')
    CREATE DATABASE DevAppDB;
GO

USE DevAppDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FeatureFlags')
CREATE TABLE FeatureFlags (
    Id          INT IDENTITY PRIMARY KEY,
    FlagName    NVARCHAR(100) NOT NULL UNIQUE,
    IsEnabled   BIT NOT NULL DEFAULT 0,
    Rollout     INT NOT NULL DEFAULT 0,
    UpdatedAt   DATETIME2 DEFAULT GETDATE(),
    UpdatedBy   NVARCHAR(100)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ExperimentResults')
CREATE TABLE ExperimentResults (
    Id          INT IDENTITY PRIMARY KEY,
    ExperimentId NVARCHAR(50) NOT NULL,
    Variant     NVARCHAR(20) NOT NULL,
    UserId      INT NOT NULL,
    ConvertedAt DATETIME2 NULL,
    RecordedAt  DATETIME2 DEFAULT GETDATE()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DevLogs')
CREATE TABLE DevLogs (
    Id          BIGINT IDENTITY PRIMARY KEY,
    Level       NVARCHAR(10) NOT NULL,
    Message     NVARCHAR(MAX),
    Source      NVARCHAR(200),
    CreatedAt   DATETIME2 DEFAULT GETDATE()
);
GO

IF (SELECT COUNT(*) FROM FeatureFlags) = 0
BEGIN
    INSERT INTO FeatureFlags (FlagName, IsEnabled, Rollout, UpdatedBy) VALUES
        ('new-dashboard',     1, 100, 'dev-team'),
        ('ai-suggestions',    0,   0, 'dev-team'),
        ('dark-mode',         1,  50, 'ux-team'),
        ('beta-export',       0,  10, 'dev-team'),
        ('realtime-metrics',  1,  25, 'platform');

    INSERT INTO DevLogs (Level, Message, Source) VALUES
        ('INFO',  'App started',                    'bootstrap'),
        ('WARN',  'Slow query detected (>500ms)',   'query-monitor'),
        ('ERROR', 'Failed to connect to cache',     'cache-service'),
        ('INFO',  'Feature flag refresh completed', 'flags-service');
END
GO

-- ── TestDB ─────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'TestDB')
    CREATE DATABASE TestDB;
GO

USE TestDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TestRuns')
CREATE TABLE TestRuns (
    Id          INT IDENTITY PRIMARY KEY,
    SuiteName   NVARCHAR(200) NOT NULL,
    Status      NVARCHAR(20) NOT NULL,
    PassedCount INT DEFAULT 0,
    FailedCount INT DEFAULT 0,
    Duration_ms INT,
    RunAt       DATETIME2 DEFAULT GETDATE(),
    RunBy       NVARCHAR(100)
);
GO

IF (SELECT COUNT(*) FROM TestRuns) = 0
BEGIN
    INSERT INTO TestRuns (SuiteName, Status, PassedCount, FailedCount, Duration_ms, RunBy) VALUES
        ('unit/auth',       'Passed', 42,  0,  1230, 'ci-runner'),
        ('unit/collectors', 'Passed', 18,  0,   980, 'ci-runner'),
        ('integration/ipc', 'Failed',  9,  2,  5400, 'ci-runner'),
        ('e2e/dashboard',   'Passed', 12,  0, 15200, 'ci-runner');
END
GO
