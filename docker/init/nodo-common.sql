USE master;
GO

DECLARE @dockLogin sysname = N'$(DockUser)';
DECLARE @dockPassword NVARCHAR(128) = N'$(DockPassword)';
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @dockLogin)
BEGIN
    DECLARE @sql NVARCHAR(MAX) =
        N'CREATE LOGIN ' + QUOTENAME(@dockLogin) +
        N' WITH PASSWORD = ' + QUOTENAME(@dockPassword, '''') +
        N', CHECK_POLICY = OFF';
    EXEC(@sql);
END
GO
DECLARE @dockLogin sysname = N'$(DockUser)';
IF IS_SRVROLEMEMBER(N'sysadmin', @dockLogin) <> 1
BEGIN
    DECLARE @roleSql NVARCHAR(MAX) =
        N'ALTER SERVER ROLE sysadmin ADD MEMBER ' + QUOTENAME(@dockLogin);
    EXEC(@roleSql);
END
GO

DECLARE @agLogin sysname = N'sqlsentinel_ag_endpoint';
DECLARE @agPassword NVARCHAR(128) = N'$(AgEndpointPassword)';
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @agLogin)
BEGIN
    DECLARE @loginSql NVARCHAR(MAX) =
        N'CREATE LOGIN ' + QUOTENAME(@agLogin) +
        N' WITH PASSWORD = ' + QUOTENAME(@agPassword, '''') +
        N', CHECK_POLICY = OFF';
    EXEC(@loginSql);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'sqlsentinel_ag_endpoint')
    CREATE USER [sqlsentinel_ag_endpoint] FOR LOGIN [sqlsentinel_ag_endpoint];
GO

IF NOT EXISTS (SELECT 1 FROM sys.symmetric_keys WHERE name = N'##MS_DatabaseMasterKey##')
    CREATE MASTER KEY ENCRYPTION BY PASSWORD = N'$(AgCertPassword)';
GO

IF NOT EXISTS (SELECT 1 FROM sys.certificates WHERE name = N'$(NodeName)_endpoint_cert')
BEGIN
    CREATE CERTIFICATE [$(NodeName)_endpoint_cert]
        WITH SUBJECT = N'SQLSentinel $(NodeName) HADR endpoint certificate',
             EXPIRY_DATE = '20361231';
END
GO

DECLARE @certFile NVARCHAR(260) = N'/var/opt/mssql/ag-certs/$(NodeName)_endpoint.cer';
DECLARE @exists INT;
EXEC master.dbo.xp_fileexist @certFile, @exists OUTPUT;
IF @exists = 0
    BACKUP CERTIFICATE [$(NodeName)_endpoint_cert]
        TO FILE = N'/var/opt/mssql/ag-certs/$(NodeName)_endpoint.cer';
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_mirroring_endpoints WHERE name = N'Hadr_endpoint')
BEGIN
    CREATE ENDPOINT [Hadr_endpoint]
        STATE = STARTED
        AS TCP (LISTENER_PORT = 5022, LISTENER_IP = ALL)
        FOR DATABASE_MIRRORING (
            ROLE = ALL,
            AUTHENTICATION = CERTIFICATE [$(NodeName)_endpoint_cert],
            ENCRYPTION = REQUIRED ALGORITHM AES
        );
END
ELSE
BEGIN
    ALTER ENDPOINT [Hadr_endpoint] STATE = STARTED;
END
GO
