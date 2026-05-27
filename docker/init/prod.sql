-- Production server: 3 databases, realistic schema + data
-- Tests: multi-DB listing, metrics per DB, fragmentation, wait stats

USE master;
GO

DECLARE @dockLogin sysname = N'$(DockUser)';
DECLARE @dockPassword NVARCHAR(128) = N'$(DockPassword)';
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @dockLogin)
BEGIN
    DECLARE @sql NVARCHAR(MAX) =
        N'CREATE LOGIN ' + QUOTENAME(@dockLogin) +
        N' WITH PASSWORD = ' + QUOTENAME(@dockPassword, '''') +
        N', CHECK_POLICY = ON';
    EXEC(@sql);
END
GO
IF IS_SRVROLEMEMBER(N'sysadmin', @dockLogin) <> 1
BEGIN
    DECLARE @roleSql NVARCHAR(MAX) =
        N'ALTER SERVER ROLE sysadmin ADD MEMBER ' + QUOTENAME(@dockLogin);
    EXEC(@roleSql);
END
GO

-- ── AppDB ──────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'AppDB')
    CREATE DATABASE AppDB;
GO

USE AppDB;
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
    OrderDate   DATETIME2 DEFAULT GETDATE(),
    ShippedDate DATETIME2 NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Products')
CREATE TABLE Products (
    Id          INT IDENTITY PRIMARY KEY,
    SKU         NVARCHAR(50) NOT NULL,
    Name        NVARCHAR(200) NOT NULL,
    Price       DECIMAL(10,2) NOT NULL,
    Stock       INT NOT NULL DEFAULT 0,
    CategoryId  INT
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'OrderLines')
CREATE TABLE OrderLines (
    Id          INT IDENTITY PRIMARY KEY,
    OrderId     INT NOT NULL REFERENCES Orders(Id),
    ProductId   INT NOT NULL REFERENCES Products(Id),
    Qty         INT NOT NULL,
    UnitPrice   DECIMAL(10,2) NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AuditLog')
CREATE TABLE AuditLog (
    Id          BIGINT IDENTITY PRIMARY KEY,
    TableName   NVARCHAR(100),
    Action      NVARCHAR(10),
    RecordId    INT,
    ChangedBy   NVARCHAR(100),
    ChangedAt   DATETIME2 DEFAULT GETDATE()
);
GO

-- Seed data
IF (SELECT COUNT(*) FROM Customers) = 0
BEGIN
    INSERT INTO Customers (FullName, Email, Country) VALUES
        ('Alice Rossi',    'alice@example.com',   'Italy'),
        ('Bob Müller',     'bob@example.com',     'Germany'),
        ('Carol Santos',   'carol@example.com',   'Brazil'),
        ('David Chen',     'david@example.com',   'China'),
        ('Eva Petrov',     'eva@example.com',     'Russia'),
        ('Frank Lopez',    'frank@example.com',   'Spain'),
        ('Grace Kim',      'grace@example.com',   'Korea'),
        ('Hans Weber',     'hans@example.com',    'Germany'),
        ('Irina Novak',    'irina@example.com',   'Slovenia'),
        ('James Wilson',   'james@example.com',   'USA');

    INSERT INTO Products (SKU, Name, Price, Stock, CategoryId) VALUES
        ('P001', 'Widget Alpha',   9.99,  250, 1),
        ('P002', 'Gadget Beta',   24.99,  100, 1),
        ('P003', 'Component Gamma',4.50, 1000, 2),
        ('P004', 'Module Delta',  49.99,   50, 2),
        ('P005', 'Device Epsilon',99.99,   20, 3);

    INSERT INTO Orders (CustomerId, Amount, Status, OrderDate) VALUES
        (1, 149.97, 'Shipped',    DATEADD(day, -10, GETDATE())),
        (2,  49.99, 'Delivered',  DATEADD(day,  -5, GETDATE())),
        (3,  24.99, 'Pending',    DATEADD(day,  -1, GETDATE())),
        (1,  99.99, 'Processing', GETDATE()),
        (4, 199.98, 'Shipped',    DATEADD(day,  -3, GETDATE()));

    INSERT INTO OrderLines (OrderId, ProductId, Qty, UnitPrice) VALUES
        (1, 1, 5,  9.99), (1, 3, 10, 4.50), (1, 2, 2, 24.99),
        (2, 4, 1, 49.99),
        (3, 2, 1, 24.99),
        (4, 5, 1, 99.99),
        (5, 1, 10, 9.99), (5, 3, 20, 4.50);

    INSERT INTO AuditLog (TableName, Action, RecordId, ChangedBy) VALUES
        ('Customers', 'INSERT', 1, 'system'),
        ('Orders',    'INSERT', 1, 'system'),
        ('Orders',    'UPDATE', 1, 'admin');
END
GO

-- Index to generate realistic index stats
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Orders') AND name = N'IX_Orders_CustomerId')
    CREATE INDEX IX_Orders_CustomerId ON dbo.Orders(CustomerId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Orders') AND name = N'IX_Orders_Status')
    CREATE INDEX IX_Orders_Status ON dbo.Orders(Status, OrderDate DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Products') AND name = N'IX_Products_SKU')
    CREATE INDEX IX_Products_SKU ON dbo.Products(SKU);
GO

-- ── ReportingDB ────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'ReportingDB')
    CREATE DATABASE ReportingDB;
GO

USE ReportingDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SalesSummary')
CREATE TABLE SalesSummary (
    Id          INT IDENTITY PRIMARY KEY,
    ReportDate  DATE NOT NULL,
    Region      NVARCHAR(50),
    TotalSales  DECIMAL(14,2),
    OrderCount  INT,
    AvgOrder    DECIMAL(10,2)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'KpiSnapshots')
CREATE TABLE KpiSnapshots (
    Id          INT IDENTITY PRIMARY KEY,
    SnapshotAt  DATETIME2 DEFAULT GETDATE(),
    MetricName  NVARCHAR(100),
    MetricValue DECIMAL(14,4),
    Source      NVARCHAR(50)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ReportQueue')
CREATE TABLE ReportQueue (
    Id          INT IDENTITY PRIMARY KEY,
    ReportType  NVARCHAR(50),
    RequestedBy NVARCHAR(100),
    RequestedAt DATETIME2 DEFAULT GETDATE(),
    CompletedAt DATETIME2 NULL,
    Status      NVARCHAR(20) DEFAULT 'Queued'
);
GO

IF (SELECT COUNT(*) FROM SalesSummary) = 0
BEGIN
    DECLARE @i INT = 0;
    WHILE @i < 30
    BEGIN
        INSERT INTO SalesSummary (ReportDate, Region, TotalSales, OrderCount, AvgOrder) VALUES
            (DATEADD(day, -@i, CAST(GETDATE() AS DATE)), 'EMEA',    ROUND(RAND()*50000+10000, 2), ROUND(RAND()*200+50, 0), ROUND(RAND()*200+50, 2)),
            (DATEADD(day, -@i, CAST(GETDATE() AS DATE)), 'AMERICAS',ROUND(RAND()*80000+20000, 2), ROUND(RAND()*300+80, 0), ROUND(RAND()*250+60, 2)),
            (DATEADD(day, -@i, CAST(GETDATE() AS DATE)), 'APAC',    ROUND(RAND()*40000+8000,  2), ROUND(RAND()*150+30, 0), ROUND(RAND()*180+40, 2));
        SET @i = @i + 1;
    END
END
GO

-- ── ArchiveDB ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = 'ArchiveDB')
    CREATE DATABASE ArchiveDB;
GO

USE ArchiveDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ArchivedOrders')
CREATE TABLE ArchivedOrders (
    Id          INT NOT NULL,
    CustomerId  INT NOT NULL,
    Amount      DECIMAL(10,2) NOT NULL,
    Status      NVARCHAR(20) NOT NULL,
    OrderDate   DATETIME2 NOT NULL,
    ArchivedAt  DATETIME2 DEFAULT GETDATE(),
    PRIMARY KEY (Id, ArchivedAt)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ArchivedAuditLog')
CREATE TABLE ArchivedAuditLog (
    Id          BIGINT NOT NULL,
    TableName   NVARCHAR(100),
    Action      NVARCHAR(10),
    RecordId    INT,
    ChangedAt   DATETIME2,
    ArchivedAt  DATETIME2 DEFAULT GETDATE(),
    PRIMARY KEY (Id, ArchivedAt)
);
GO

IF (SELECT COUNT(*) FROM ArchivedOrders) = 0
BEGIN
    DECLARE @j INT = 0;
    WHILE @j < 50
    BEGIN
        INSERT INTO ArchivedOrders (Id, CustomerId, Amount, Status, OrderDate) VALUES
            (@j + 1000, (@j % 10) + 1, ROUND(RAND()*500+10, 2), 'Delivered', DATEADD(day, -365 - @j, GETDATE()));
        SET @j = @j + 1;
    END
END
GO
