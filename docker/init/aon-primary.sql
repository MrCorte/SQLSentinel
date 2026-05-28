USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = N'AonAppDB')
    CREATE DATABASE [AonAppDB];
GO

ALTER DATABASE [AonAppDB] SET RECOVERY FULL;
GO

USE [AonAppDB];
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'Customers')
CREATE TABLE dbo.Customers (
    Id        INT IDENTITY PRIMARY KEY,
    FullName  NVARCHAR(100) NOT NULL,
    Email     NVARCHAR(150) NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'Orders')
CREATE TABLE dbo.Orders (
    Id         INT IDENTITY PRIMARY KEY,
    CustomerId INT NOT NULL REFERENCES dbo.Customers(Id),
    Amount     DECIMAL(10,2) NOT NULL,
    Status     NVARCHAR(20) NOT NULL DEFAULT N'Pending',
    OrderDate  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF (SELECT COUNT(*) FROM dbo.Customers) = 0
BEGIN
    INSERT INTO dbo.Customers (FullName, Email) VALUES
        (N'Nodo AG Customer 1', N'ag-customer-1@example.local'),
        (N'Nodo AG Customer 2', N'ag-customer-2@example.local'),
        (N'Nodo AG Customer 3', N'ag-customer-3@example.local');

    INSERT INTO dbo.Orders (CustomerId, Amount, Status, OrderDate) VALUES
        (1, 149.97, N'Processing', DATEADD(hour, -4, SYSUTCDATETIME())),
        (2,  49.99, N'Shipped',    DATEADD(hour, -2, SYSUTCDATETIME())),
        (3,  24.99, N'Pending',    SYSUTCDATETIME());
END
GO

USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = N'AonReportingDB')
    CREATE DATABASE [AonReportingDB];
GO

ALTER DATABASE [AonReportingDB] SET RECOVERY FULL;
GO

USE [AonReportingDB];
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'ReplicaHealthSamples')
CREATE TABLE dbo.ReplicaHealthSamples (
    Id              INT IDENTITY PRIMARY KEY,
    CapturedAt      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    PrimaryReplica  SYSNAME NOT NULL,
    SecondaryReplica SYSNAME NOT NULL,
    SyncState       NVARCHAR(40) NOT NULL
);
GO

IF (SELECT COUNT(*) FROM dbo.ReplicaHealthSamples) = 0
BEGIN
    INSERT INTO dbo.ReplicaHealthSamples (PrimaryReplica, SecondaryReplica, SyncState) VALUES
        (N'nodo1', N'nodo2', N'SYNCHRONIZED'),
        (N'nodo1', N'nodo2', N'SYNCHRONIZING');
END
GO

USE master;
GO

BACKUP DATABASE [AonAppDB]
    TO DISK = N'/var/opt/mssql/ag-certs/AonAppDB_seed.bak'
    WITH INIT, COMPRESSION;
GO
BACKUP DATABASE [AonReportingDB]
    TO DISK = N'/var/opt/mssql/ag-certs/AonReportingDB_seed.bak'
    WITH INIT, COMPRESSION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.availability_groups WHERE name = N'SQLSentinelAON')
BEGIN
    CREATE AVAILABILITY GROUP [SQLSentinelAON]
        WITH (CLUSTER_TYPE = NONE)
        FOR DATABASE [AonAppDB], [AonReportingDB]
        REPLICA ON
            N'nodo1' WITH (
                ENDPOINT_URL = N'TCP://nodo1:5022',
                AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
                FAILOVER_MODE = MANUAL,
                SEEDING_MODE = AUTOMATIC,
                SECONDARY_ROLE (ALLOW_CONNECTIONS = ALL)
            ),
            N'nodo2' WITH (
                ENDPOINT_URL = N'TCP://nodo2:5022',
                AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
                FAILOVER_MODE = MANUAL,
                SEEDING_MODE = AUTOMATIC,
                SECONDARY_ROLE (ALLOW_CONNECTIONS = ALL)
            );
END
GO
