-- Staging server: 1 database, mirrors prod schema, moderate data
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
    Key         NVARCHAR(100) PRIMARY KEY,
    Value       NVARCHAR(500),
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

    INSERT INTO ConfigValues (Key, Value) VALUES
        ('api.timeout_ms',       '5000'),
        ('api.retry_count',      '3'),
        ('feature.new_checkout', 'false'),
        ('db.pool_size',         '10'),
        ('log.level',            'warn');
END
GO

-- Create and immediately update rows to generate fragmentation
CREATE INDEX IF NOT EXISTS IX_Orders_Status ON Orders(Status, OrderDate DESC);
GO

UPDATE Orders SET Status = 'Processing' WHERE Id % 3 = 0;
UPDATE Orders SET Status = 'Shipped'    WHERE Id % 3 = 1;
UPDATE Orders SET Status = 'Delivered'  WHERE Id % 7 = 0;
GO
