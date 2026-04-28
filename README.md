<p align="center">
  <img src="img/sql-sentinel-glyph.svg" alt="SQL Sentinel" width="88" />
</p>

<h1 align="center">SQL Sentinel</h1>

<p align="center">
  Real-time monitoring dashboard for Microsoft SQL Server environments.<br/>
  Built for DBAs managing tens or hundreds of instances.
</p>

---

## Features

- **Global dashboard** — aggregated KPIs, CPU/memory, alarm count, top-server charts
- **Server dashboard** — metrics history, databases, sessions, blocking, Wait Stats, Disks, SQL Agent jobs
- **Always On AG** — PRIMARY/SECONDARY replica status, sync health, real-time connectivity
- **Inventory** — composable filters, custom DB fields (alias, owner), CSV export
- **Alerts** — offline DBs, expired backups, blocked sessions, CPU/memory thresholds; email + Windows toast
- **Discovery** — CIDR subnet scan or manual `host:port:instance`; server groups with drag-and-drop
- **AI Assistant** — LangGraph agent with live server context; RAG knowledge base from PDF/Markdown docs stored with `vector(1536)` embeddings and DiskANN similarity search

<p align="center">
  <img src="img/wiki.jpg" alt="RAG Knowledge Base graph" width="480" />
</p>

- **Background polling** — keeps running in the tray; Light/Full mode; Start with Windows

---

## Requirements

### Storage database *(SQL Sentinel's own data)*

| | |
|---|---|
| SQL Server | **2025** — required for `vector(1536)` and DiskANN |
| Auth | SQL Auth — `db_owner` on the target database |

### Monitored servers

| | |
|---|---|
| SQL Server | 2014 or later |
| Auth | Windows Auth or SQL Auth |
| Network | TCP port reachable from the monitoring host; no SQL Server Browser needed |

### Application host

Windows 10 / 11 x64 — no additional dependencies.

---

## First Launch

### 1 — Storage setup wizard

On first launch, a wizard appears before the login screen. Enter the SQL Server 2025 connection details:

| Field | Default | |
|---|---|---|
| Host | `localhost` | |
| Port | `1437` | non-default to avoid collision with monitored instances |
| Database | `SQLSentinelDB` | created automatically |
| Username | `sqlsentinel_app` | |
| Encrypt (TLS) | off | enable for remote/production |
| Trust cert | on | allow self-signed certificates |

Click **Test Connection**, then **Save & Continue**. Tables are created automatically.
The connection can be changed later in **Settings → Storage Database**.

### 2 — Login

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `Admin1234!` |

A password change is required on first login (min 8 chars, 1 uppercase, 1 number).

### 3 — Add a server

Go to **Discovery → Add server manually**, fill in host, port, auth, and click **Add**.

---

## Building from Source

```bash
git clone https://github.com/MrCorte/SQLSentinel.git
cd SQLSentinel
npm install
npm run dev        # development + HMR
npm run build      # typecheck + production build
npm run build:win  # Windows .exe + NSIS installer
```

**Prerequisites:** Node.js 22+, npm 10+, Windows 10/11 x64, SQL Server 2025 instance.

### Docker (development storage database)

```bash
docker run -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=App@Sentinel2025 \
  -p 1437:1433 --platform linux/amd64 \
  mcr.microsoft.com/mssql/server:2025-latest
```

### Tests

```bash
npm test
# Integration tests (requires running SQL Server 2025):
STORAGE_TEST_HOST=localhost STORAGE_TEST_PORT=1437 npm test
```

---

## Security

| Area | Mechanism |
|---|---|
| Auth | bcrypt 12 rounds; in-memory session 8h; tokens stored as SHA-256 hash |
| Credentials | `safeStorage` (Windows DPAPI / macOS Keychain) |
| TLS | `encrypt` + `trustServerCertificate` configurable per connection |
| IPC | Auth guard on all channels; storage wizard channels explicitly exempt |
| SQL | Parameterized queries only — no string concatenation |
| Sandbox | `contextIsolation: true`, `nodeIntegration: false` |
