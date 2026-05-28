USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.certificates WHERE name = N'$(RemoteNodeName)_endpoint_cert')
BEGIN
    CREATE CERTIFICATE [$(RemoteNodeName)_endpoint_cert]
        AUTHORIZATION [sqlsentinel_ag_endpoint]
        FROM FILE = N'/var/opt/mssql/ag-certs/$(RemoteNodeName)_endpoint.cer';
END
GO

GRANT CONNECT ON ENDPOINT::[Hadr_endpoint] TO [sqlsentinel_ag_endpoint];
GO
