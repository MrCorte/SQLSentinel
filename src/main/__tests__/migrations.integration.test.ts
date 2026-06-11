/**
 * Test di integrazione: schema init + migrazioni eseguiti su un SQL Server REALE.
 *
 * I test unitari non possono validare il T-SQL (tre errori di sintassi nelle
 * migration hanno bloccato lo storage al boot senza che la suite se ne
 * accorgesse). Questo test crea un database scratch, esegue initSchema() (che
 * include runMigrations), verifica che tutte le migration risultino applicate
 * e che una seconda esecuzione sia idempotente.
 *
 * Opt-in: gira solo se le env sono presenti (serve un SQL Server raggiungibile).
 *
 *   SQLSENTINEL_IT_HOST=localhost SQLSENTINEL_IT_PORT=1437 \
 *   SQLSENTINEL_IT_USER=sa SQLSENTINEL_IT_PASSWORD=... \
 *   npm test -- src/main/__tests__/migrations.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import mssql from 'mssql'

const HOST = process.env.SQLSENTINEL_IT_HOST
const PORT = Number(process.env.SQLSENTINEL_IT_PORT ?? 1433)
const USER = process.env.SQLSENTINEL_IT_USER ?? 'sa'
const PASSWORD = process.env.SQLSENTINEL_IT_PASSWORD

const enabled = !!HOST && !!PASSWORD
const SCRATCH_DB = `SQLSentinelIT_${Date.now()}`

// Pool amministrativo su master per creare/droppare il DB scratch.
let admin: mssql.ConnectionPool | null = null

function adminConfig(database: string): mssql.config {
  return {
    server: HOST!,
    port: PORT,
    database,
    user: USER,
    password: PASSWORD!,
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 15000 },
    requestTimeout: 60000
  }
}

describe.skipIf(!enabled)('schema init + migrations su SQL Server reale', () => {
  beforeAll(async () => {
    admin = await new mssql.ConnectionPool(adminConfig('master')).connect()
    await admin.request().query(`CREATE DATABASE [${SCRATCH_DB}]`)
  }, 60000)

  afterAll(async () => {
    const { closeStoragePool } = await import('../store/sqlserver/connection')
    await closeStoragePool().catch(() => {})
    if (admin) {
      await admin
        .request()
        .query(
          `ALTER DATABASE [${SCRATCH_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${SCRATCH_DB}]`
        )
        .catch(() => {})
      await admin.close()
    }
  }, 60000)

  it('applica schema e tutte le migration su un DB vuoto, due volte (idempotenza)', async () => {
    const { initStoragePoolFromParams, getPool } = await import('../store/sqlserver/connection')
    const { initSchema } = await import('../store/sqlserver/database')

    await initStoragePoolFromParams({
      host: HOST!,
      port: PORT,
      database: SCRATCH_DB,
      username: USER,
      password: PASSWORD!,
      encrypt: false,
      trustServerCertificate: true
    })

    // Prima esecuzione: schema + migration da zero. Qualunque errore di
    // sintassi T-SQL nelle migration fa fallire QUI, non al boot dal cliente.
    await initSchema()

    const pool = getPool()
    const applied = await pool
      .request()
      .query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.schema_migrations`)
    expect(applied.recordset[0].n).toBeGreaterThanOrEqual(6)

    // Migration 6: colonne chart presenti
    const cols = await pool.request().query<{ name: string }>(
      `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.metrics_snapshots')`
    )
    const colNames = new Set(cols.recordset.map((c) => c.name))
    expect(colNames.has('cpu_pct')).toBe(true)
    expect(colNames.has('mem_pct')).toBe(true)

    // Tabelle portanti presenti
    const tables = await pool.request().query<{ name: string }>(
      `SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo')`
    )
    const names = new Set(tables.recordset.map((r) => r.name))
    for (const t of ['servers', 'metrics_snapshots', 'users', 'settings', 'incidents']) {
      expect(names.has(t), `tabella mancante: ${t}`).toBe(true)
    }

    // Migration 1: layout finale di metrics_snapshots (clustered sul percorso
    // time-series, PK non-clustered)
    const idx = await pool.request().query<{ name: string; type_desc: string }>(
      `SELECT name, type_desc FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.metrics_snapshots')`
    )
    const clustered = idx.recordset.find((i) => i.type_desc === 'CLUSTERED')
    expect(clustered?.name).toBe('CX_metrics_server_collected')

    // Seconda esecuzione: deve essere un no-op pulito
    await initSchema()
    const applied2 = await pool
      .request()
      .query<{ n: number }>(`SELECT COUNT(*) AS n FROM dbo.schema_migrations`)
    expect(applied2.recordset[0].n).toBe(applied.recordset[0].n)
  }, 120000)

  it('migration 6 sul percorso UPGRADE: tabella esistente con dati, colonne assenti', async () => {
    // Lo schema nuovo nasce già con le colonne, quindi il primo test non
    // esercita il caso reale dei clienti: tabella esistente, ALTER + backfill
    // nella stessa migration. Qui simuliamo l'installazione vecchia: righe
    // presenti, colonne droppate, migration 6 ri-eseguita.
    const { getPool } = await import('../store/sqlserver/connection')
    const { initSchema } = await import('../store/sqlserver/database')
    const pool = getPool()

    await pool.request().query(`
      INSERT INTO dbo.metrics_snapshots (id, server_id, collected_at, metrics_json, cpu_pct, mem_pct)
      VALUES ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000b001',
              SYSUTCDATETIME(),
              N'{"instanceInfo":{"cpuUsagePercent":42.5,"memoryUsedMb":3000,"memoryTargetMb":4000}}',
              NULL, NULL)`)
    await pool.request().query(`
      ALTER TABLE dbo.metrics_snapshots DROP COLUMN cpu_pct, mem_pct;
      DELETE FROM dbo.schema_migrations WHERE id = 6`)

    await initSchema() // ri-applica la 6 su tabella esistente popolata

    const r = await pool.request().query<{ cpu_pct: number; mem_pct: number }>(
      `SELECT cpu_pct, mem_pct FROM dbo.metrics_snapshots WHERE id = '00000000-0000-0000-0000-00000000a001'`
    )
    expect(Number(r.recordset[0].cpu_pct)).toBeCloseTo(42.5, 1)
    expect(Number(r.recordset[0].mem_pct)).toBeCloseTo(75.0, 1)
  }, 120000)
})
