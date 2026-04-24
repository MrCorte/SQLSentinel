# Overview Charts — Design Spec

**Date:** 2026-04-24
**Status:** Approved

## Summary

Add a fixed-height chart section above the server DataGrid in `HomeDashboard.tsx`. Three widgets provide at-a-glance operational visibility: server status distribution, top CPU consumers, and alert breakdown.

---

## Layout

A new `DashboardCharts` component is inserted between the KPI cards and the DataGrid in `HomeDashboard.tsx`.

```
HomeDashboard.tsx
  └── <KPI cards>            (existing)
  └── <DashboardCharts>      ← new
        ├── StatusDonutCard   (~20% width)
        ├── TopCpuCard        (~35% width)
        └── AlertsRecapCard   (~45% width)
  └── <DataGrid>             (existing)
```

**Grid:** CSS Grid, `grid-template-columns: 1fr 1.75fr 2.25fr`, height fixed at 220px, gap `12px`, padding `12px 0`. Cards use `bgSurface` background, `bgBorder` border, `borderRadius.md`.

Each card has a small uppercase label header (same style as sidebar group headers: `fontSize: 10, fontWeight: 600, color: textMuted, letterSpacing: 0.8px`).

---

## Widget 1 — StatusDonutCard

**Reuses:** `src/renderer/src/components/features/home/StatusDonutChart.tsx` (no changes)

**Data source:** `serversStore` — already wired inside the component.

**Card title:** "Servers"

No modifications needed to the existing component.

---

## Widget 2 — TopCpuCard

**Reuses:** `src/renderer/src/components/features/home/CpuBarChart.tsx` (no changes)

**Data source:** `metricsStore.summaries` — read in `DashboardCharts`, sorted descending by `cpuUsagePercent`, sliced to top 5, passed as prop.

**Card title:** "Top 5 CPU"

**Edge case:** If fewer than 1 server has a summary available, render a centered placeholder: `"No data yet"` in `textMuted`.

The top-5 filtering is done in the parent (`DashboardCharts`) via `useMemo` — the chart component itself is unchanged.

---

## Widget 3 — AlertsRecapCard

**New component:** `src/renderer/src/components/features/home/AlertsRecapCard.tsx`

**Data source:** `alertsStore.alerts` + `serversStore.servers` + `groupsStore.serverAliases`

**Card title:** "Alerts"

### Zone A — Category badge grid (upper)

Five pill badges, one per alert category:

| Category key | Display label |
|---|---|
| `cpu_high` | CPU High |
| `blocking_sessions` | Blocking |
| `database_offline` | DB Offline |
| `backup_overdue` | Backup |
| `disk_space_low` | Disk |

Each pill shows:
- Label
- CRITICAL count (red `danger` token, hidden if 0)
- WARNING count (yellow `warning` token, hidden if 0)

Pills with no alerts are rendered in `textMuted` / dimmed. Layout: `display: flex, flexWrap: wrap, gap: 6px`.

### Zone B — Recent alerts list (lower)

Last 5 alerts ordered by `detectedAt` descending, unacknowledged first.

Each row:
- Colored severity dot (CRITICAL → `danger`, WARNING → `warning`)
- Server display name — resolved via `serverAliases[server.id]` → fallback to `ip:port`
- Alert message, truncated with `textOverflow: ellipsis`
- Relative timestamp (e.g. "5m ago") right-aligned in `textMuted`

**Empty state:** Centered text `"No alerts"` in `textMuted`.

**Scrollable:** `overflowY: auto` if content exceeds available height.

---

## Data Flow

```
metricsStore.summaries  ──► DashboardCharts (useMemo top-5) ──► TopCpuCard
serversStore.servers    ──► StatusDonutCard (internal)
alertsStore.alerts      ──► AlertsRecapCard
serversStore.servers    ──► AlertsRecapCard (name resolution)
groupsStore.serverAliases ► AlertsRecapCard (alias resolution)
```

No new IPC channels required. All data is already collected by existing workers.

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| No CPU summaries available | TopCpuCard shows "No data yet" placeholder |
| Fewer than 5 servers with metrics | Bar chart shows however many are available |
| No alerts | AlertsRecapCard shows "No alerts" empty state |
| Server deleted but alert still in store | Falls back gracefully to `ip:port` label |
| Very long alert message | Truncated with ellipsis, full text available on hover (Tooltip) |

---

## Files Changed

| File | Change |
|---|---|
| `src/renderer/src/components/HomeDashboard.tsx` | Import + render `DashboardCharts` between KPI cards and DataGrid |
| `src/renderer/src/components/features/home/DashboardCharts.tsx` | New — 3-column grid container, top-5 CPU logic |
| `src/renderer/src/components/features/home/AlertsRecapCard.tsx` | New — badges + recent list |
| `src/renderer/src/components/features/home/StatusDonutChart.tsx` | No changes |
| `src/renderer/src/components/features/home/CpuBarChart.tsx` | No changes |
