-- Staging server: 2 databases, mirrors prod schema, moderate data
-- Tests: mid-size server, index fragmentation scenario

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'StagingAppDB')
    CREATE DATABASE StagingAppDB;
GO

USE StagingAppDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Customers')
CREATE TABLE Customers (
    Id          INT IDENTITY PRIMARY KEY,
    FullName    NVARCHAR(100) NOT NULL,
    Email       NVARCHAR(150) NOT NULL,
    Country     NVARCHAR(50),
    CreatedAt   DATETIME2 DEFAULT GETDATE(),
    IsActive    BIT DEFAULT 1
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Orders')
CREATE TABLE Orders (
    Id          INT IDENTITY PRIMARY KEY,
    CustomerId  INT NOT NULL REFERENCES Customers(Id),
    Amount      DECIMAL(10,2) NOT NULL,
    Status      NVARCHAR(20) NOT NULL DEFAULT 'Pending',
    OrderDate   DATETIME2 DEFAULT GETDATE()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ConfigValues')
CREATE TABLE ConfigValues (
    [Key]       NVARCHAR(100) PRIMARY KEY,
    [Value]     NVARCHAR(500),
    Environment NVARCHAR(20) NOT NULL DEFAULT 'staging',
    UpdatedAt   DATETIME2 DEFAULT GETDATE()
);
GO

IF (SELECT COUNT(*) FROM Customers) = 0
BEGIN
    DECLARE @i INT = 0;
    WHILE @i < 25
    BEGIN
        INSERT INTO Customers (FullName, Email, Country) VALUES
            ('Test User ' + CAST(@i AS NVARCHAR), 'test' + CAST(@i AS NVARCHAR) + '@staging.local', 'TestLand');
        SET @i = @i + 1;
    END

    DECLARE @j INT = 0;
    WHILE @j < 60
    BEGIN
        INSERT INTO Orders (CustomerId, Amount, Status, OrderDate) VALUES
            ((@j % 25) + 1, ROUND(RAND()*300+10, 2), 'Pending', DATEADD(hour, -@j * 2, GETDATE()));
        SET @j = @j + 1;
    END

    INSERT INTO ConfigValues ([Key], [Value]) VALUES
        ('api.timeout_ms',       '5000'),
        ('api.retry_count',      '3'),
        ('feature.new_checkout', 'false'),
        ('db.pool_size',         '10'),
        ('log.level',            'warn');
END
GO

-- Create and immediately update rows to generate fragmentation
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Orders') AND name = N'IX_Orders_Status')
    CREATE INDEX IX_Orders_Status ON dbo.Orders(Status, OrderDate DESC);
GO

UPDATE Orders SET Status = 'Processing' WHERE Id % 3 = 0;
UPDATE Orders SET Status = 'Shipped'    WHERE Id % 3 = 1;
UPDATE Orders SET Status = 'Delivered'  WHERE Id % 7 = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'StagingReportingDB')
    CREATE DATABASE StagingReportingDB;
GO

USE StagingReportingDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ReleaseValidationRuns')
CREATE TABLE ReleaseValidationRuns (
    Id             INT IDENTITY PRIMARY KEY,
    ReleaseName    NVARCHAR(100) NOT NULL,
    StartedAt      DATETIME2 NOT NULL DEFAULT GETDATE(),
    CompletedAt    DATETIME2 NULL,
    PassedChecks   INT NOT NULL DEFAULT 0,
    FailedChecks   INT NOT NULL DEFAULT 0,
    Status         NVARCHAR(20) NOT NULL DEFAULT 'Running'
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SyntheticTraffic')
CREATE TABLE SyntheticTraffic (
    Id             INT IDENTITY PRIMARY KEY,
    Endpoint       NVARCHAR(200) NOT NULL,
    Requests       INT NOT NULL,
    ErrorCount     INT NOT NULL DEFAULT 0,
    AvgLatency_ms  INT NOT NULL,
    CapturedAt     DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF (SELECT COUNT(*) FROM ReleaseValidationRuns) = 0
BEGIN
    INSERT INTO ReleaseValidationRuns (ReleaseName, StartedAt, CompletedAt, PassedChecks, FailedChecks, Status) VALUES
        ('2026.05.0-rc1', DATEADD(day, -3, GETDATE()), DATEADD(day, -3, DATEADD(minute, 42, GETDATE())), 118, 2, 'Failed'),
        ('2026.05.0-rc2', DATEADD(day, -2, GETDATE()), DATEADD(day, -2, DATEADD(minute, 37, GETDATE())), 121, 0, 'Passed'),
        ('2026.05.1-rc1', DATEADD(hour, -6, GETDATE()), DATEADD(hour, -5, GETDATE()), 96, 1, 'Failed');

    INSERT INTO SyntheticTraffic (Endpoint, Requests, ErrorCount, AvgLatency_ms, CapturedAt) VALUES
        ('/api/orders',      4200, 12, 118, DATEADD(hour, -4, GETDATE())),
        ('/api/customers',   2100,  1,  74, DATEADD(hour, -4, GETDATE())),
        ('/api/config',       650,  0,  42, DATEADD(hour, -4, GETDATE())),
        ('/api/checkout',    1800, 24, 164, DATEADD(hour, -3, GETDATE()));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.SyntheticTraffic') AND name = N'IX_SyntheticTraffic_CapturedAt')
    CREATE INDEX IX_SyntheticTraffic_CapturedAt ON dbo.SyntheticTraffic(CapturedAt DESC);
GO
