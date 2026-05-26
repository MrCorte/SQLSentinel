-- DR / Replica server: 2 databases, read-heavy, simulates a DR standby
-- Tests: server with lower activity, old backup scenario

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'AppDB_DR')
    CREATE DATABASE AppDB_DR;
GO

USE AppDB_DR;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Customers')
CREATE TABLE Customers (
    Id          INT NOT NULL PRIMARY KEY,
    FullName    NVARCHAR(100) NOT NULL,
    Email       NVARCHAR(150) NOT NULL,
    Country     NVARCHAR(50),
    CreatedAt   DATETIME2,
    IsActive    BIT DEFAULT 1
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Orders')
CREATE TABLE Orders (
    Id          INT NOT NULL PRIMARY KEY,
    CustomerId  INT NOT NULL,
    Amount      DECIMAL(10,2) NOT NULL,
    Status      NVARCHAR(20) NOT NULL,
    OrderDate   DATETIME2,
    ShippedDate DATETIME2 NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Products')
CREATE TABLE Products (
    Id          INT NOT NULL PRIMARY KEY,
    SKU         NVARCHAR(50) NOT NULL,
    Name        NVARCHAR(200) NOT NULL,
    Price       DECIMAL(10,2) NOT NULL,
    Stock       INT NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SyncStatus')
CREATE TABLE SyncStatus (
    Id              INT IDENTITY PRIMARY KEY,
    SourceServer    NVARCHAR(100) NOT NULL,
    LastSyncAt      DATETIME2 DEFAULT GETDATE(),
    RowsSynced      INT,
    SyncDuration_ms INT,
    Status          NVARCHAR(20) DEFAULT 'OK'
);
GO

IF (SELECT COUNT(*) FROM Customers) = 0
BEGIN
    -- Simulate data copied from prod at a point in time (6h ago)
    INSERT INTO Customers (Id, FullName, Email, Country, CreatedAt) VALUES
        (1, 'Alice Rossi',  'alice@example.com',  'Italy',   DATEADD(day, -30, GETDATE())),
        (2, 'Bob Müller',   'bob@example.com',    'Germany', DATEADD(day, -25, GETDATE())),
        (3, 'Carol Santos', 'carol@example.com',  'Brazil',  DATEADD(day, -20, GETDATE())),
        (4, 'David Chen',   'david@example.com',  'China',   DATEADD(day, -15, GETDATE())),
        (5, 'Eva Petrov',   'eva@example.com',    'Russia',  DATEADD(day, -10, GETDATE()));

    INSERT INTO Products (Id, SKU, Name, Price, Stock) VALUES
        (1, 'P001', 'Widget Alpha',    9.99,  250),
        (2, 'P002', 'Gadget Beta',    24.99,  100),
        (3, 'P003', 'Component Gamma', 4.50, 1000);

    -- Orders synced up to 6 hours ago (latest order missing = lag simulation)
    INSERT INTO Orders (Id, CustomerId, Amount, Status, OrderDate) VALUES
        (1, 1, 149.97, 'Shipped',   DATEADD(day, -10, GETDATE())),
        (2, 2,  49.99, 'Delivered', DATEADD(day,  -5, GETDATE()));

    INSERT INTO SyncStatus (SourceServer, RowsSynced, SyncDuration_ms, Status) VALUES
        ('sql-prod', 7,   342, 'OK'),
        ('sql-prod', 12, 1205, 'OK'),
        ('sql-prod', 0,     0, 'NoChanges'),
        ('sql-prod', 3,  4820, 'SlowSync');
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'AppDB_DR_Archive')
    CREATE DATABASE AppDB_DR_Archive;
GO

USE AppDB_DR_Archive;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'RestorePoints')
CREATE TABLE RestorePoints (
    Id              INT IDENTITY PRIMARY KEY,
    SourceDatabase  NVARCHAR(128) NOT NULL,
    BackupType      NVARCHAR(20) NOT NULL,
    BackupStartedAt DATETIME2 NOT NULL,
    BackupFinishedAt DATETIME2 NOT NULL,
    BackupSizeMb    DECIMAL(10,2) NOT NULL,
    IsRestorable    BIT NOT NULL DEFAULT 1
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FailoverExercises')
CREATE TABLE FailoverExercises (
    Id              INT IDENTITY PRIMARY KEY,
    ExerciseName    NVARCHAR(100) NOT NULL,
    StartedAt       DATETIME2 NOT NULL,
    CompletedAt     DATETIME2 NULL,
    RpoSeconds      INT NOT NULL,
    RtoSeconds      INT NOT NULL,
    Outcome         NVARCHAR(20) NOT NULL
);
GO

IF (SELECT COUNT(*) FROM RestorePoints) = 0
BEGIN
    INSERT INTO RestorePoints (SourceDatabase, BackupType, BackupStartedAt, BackupFinishedAt, BackupSizeMb, IsRestorable) VALUES
        ('AppDB',       'FULL', DATEADD(day, -7, GETDATE()), DATEADD(day, -7, DATEADD(minute, 18, GETDATE())), 5120.50, 1),
        ('AppDB',       'DIFF', DATEADD(day, -1, GETDATE()), DATEADD(day, -1, DATEADD(minute,  6, GETDATE())),  820.75, 1),
        ('ReportingDB', 'FULL', DATEADD(day, -7, GETDATE()), DATEADD(day, -7, DATEADD(minute, 12, GETDATE())), 1840.25, 1),
        ('ArchiveDB',   'FULL', DATEADD(day, -14, GETDATE()), DATEADD(day, -14, DATEADD(minute, 25, GETDATE())), 9100.00, 0);

    INSERT INTO FailoverExercises (ExerciseName, StartedAt, CompletedAt, RpoSeconds, RtoSeconds, Outcome) VALUES
        ('monthly-dr-check', DATEADD(day, -30, GETDATE()), DATEADD(day, -30, DATEADD(minute, 22, GETDATE())), 180, 1320, 'Passed'),
        ('patch-window-dr',  DATEADD(day, -10, GETDATE()), DATEADD(day, -10, DATEADD(minute, 35, GETDATE())), 420, 2100, 'Warning');
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.RestorePoints') AND name = N'IX_RestorePoints_SourceDatabase')
    CREATE INDEX IX_RestorePoints_SourceDatabase ON dbo.RestorePoints(SourceDatabase, BackupStartedAt DESC);
GO
