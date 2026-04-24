# SQLSentinel UI Modernization — Design Spec

**Date:** 2026-04-24  
**Status:** Approved  
**Scope:** Full visual overhaul of the Electron renderer — theme, layout shell, server list scalability. No changes to main process, IPC, or data logic.

---

## 1. Design Direction

**Dark Pro** — full dark theme inspired by GitHub Dark, Grafana, Datadog.  
Zero gradients, minimal chrome, data-first. Optimized for DBA workflows with up to 200 monitored servers.

---

## 2. Color Palette

All colors defined as CSS custom properties on `:root` and mirrored in the MUI theme palette.

| Token | Light alias | Value | Usage |
|---|---|---|---|
| `--bg-base` | `background.default` | `#0d1117` | Page background |
| `--bg-surface` | `background.paper` | `#161b22` | Cards, panels, rail, tree |
| `--bg-border` | — | `#30363d` | Borders, dividers |
| `--text-primary` | `text.primary` | `#e6edf3` | Body text, server names |
| `--text-muted` | `text.secondary` | `#8b949e` | Labels, timestamps, subtitles |
| `--accent` | `primary.main` | `#00d4aa` (teal) | Active tab underline, logo bg, KPI primary, progress bars, buttons |
| `--accent-alert` | — | `#ef4444` | Replaces `--accent` on brand elements when `hasCriticalAlert === true` |
| `--success` | `success.main` | `#3fb950` | Server online, healthy state |
| `--warning` | `warning.main` | `#d29922` | Warning alerts, caution states |
| `--danger` | `error.main` | `#f78166` | Critical alerts, blocking sessions, offline DBs |

### Alert-reactive accent

A Zustand selector `hasCriticalAlert` (true when any unresolved CRITICAL alert exists) drives an `AccentProvider` React context. This context sets `--color-accent` on the root element. Elements that use the reactive accent:

- Logo `SS` background in the icon rail
- Breadcrumb bar alert badge background

Navigation indicators (icon rail active state border/background, any tab underline) remain teal at all times — only the logo and the alert badge switch to red. This avoids confusion between "I'm on this page" and "there is a critical alert".

---

## 3. Typography

**Font family:** Inter, loaded via `@fontsource/inter` (npm package — works offline in Electron, no CDN dependency).

| Role | Size | Weight | Notes |
|---|---|---|---|
| Body / UI text | 13px | 400 | Base, unchanged from current |
| Emphasized text | 13px | 500 | Server names, section headers |
| KPI values | 22–28px | 700 | `font-variant-numeric: tabular-nums` for column alignment |
| Labels / uppercase | 11px | 500 | `letter-spacing: 0.06em`, `text-transform: uppercase` |
| Timestamps / muted | 11px | 400 | `color: text.muted` |

No secondary monospace font. Tabular numerics via `font-variant-numeric` keep numbers aligned in dense tables without switching typeface.

---

## 4. Layout Shell

### Structure

```
┌──────────────────────────────────────────────────────────┐
│ icon rail (48px) │ breadcrumb bar (28px)                 │
│                  ├───────────────┬───────────────────────┤
│                  │ server tree   │ main content          │
│                  │ (180px,       │ (fills remainder)     │
│                  │  collapsible) │                       │
│                  │               │                       │
└──────────────────────────────────────────────────────────┘
```

The current `AppBar` + `Tabs` (48px) is removed entirely. Total chrome height drops from 48px to 28px.

### Icon Rail — `IconRail.tsx` (new)

- Fixed left, 48px wide, full viewport height
- Background: `bg-surface`, right border: `bg-border`
- **Logo** (top): 26×26px rounded square, background = `--color-accent`. Reacts to `hasCriticalAlert`.
- **Nav icons** (middle): MUI icons for each section — Dashboard, Inventory, Discovery, AI, Settings
  - Active state: background `accent 12% opacity` + `1px solid accent 40% opacity`
  - Inactive: icon color `text.muted`, hover `text.primary`
  - Tooltip on hover (MUI `Tooltip` placement `right`) showing section name
- **Settings icon** (bottom): pinned with `margin-top: auto`
- Drives routing via existing tab index state (0–4)

### Breadcrumb Bar — `BreadcrumbBar.tsx` (new)

- Fixed top (after rail), 28px height, full width minus 48px rail
- Background: `bg-surface`, bottom border: `bg-border`
- **Left:** `Section name › Server name` — section name is plain `text.muted`, separator `›`, server name is `text.primary`. Clicking server name focuses server tree. Shows only section name when no server is selected.
- **Right:** Alert badge + AI button
  - Alert badge: `N critical` (red) or `N warning` (amber) — hidden when zero alerts. Click opens `AlertsDrawer`.
  - AI button: icon button, opens `AIPanel` drawer

### Server Tree — `ServerTree.tsx` (refactor of `Sidebar.tsx`)

Visible in Dashboard and Inventory sections; hidden in Discovery, Settings, AI.

- 180px width, full height below breadcrumb bar
- Background: `bg-base`, right border: `bg-border`
- **Search bar** (top, 36px): filter live on server name — MUI `TextField` size `small`
- **Quick filter pills**: `All` · `Critical` · `Warning` · `Offline` — filter the list, pill color matches severity
- **Server list**: virtualized with `react-window` `FixedSizeList`, row height 28px — supports 200+ servers with no DOM penalty
  - Each row: `6px status dot` (green/amber/red) + server name (13px, truncated) + optional alert count badge
  - Selected row: `bg-surface` background + left `2px solid accent` indicator
- **Groups**: collapsible sections if servers are tagged — group header 24px with chevron

### Main Content

Fills remaining space. Each section renders its existing page component, re-skinned.

---

## 5. Dashboard — Dense Table View

The current card-per-server layout does not scale to 200 servers. The home dashboard is restructured:

**Row 1 — Global KPIs (4 cards):**

| Card | Value | Color |
|---|---|---|
| Total Servers | count | `text.primary` |
| Critical | count | `danger` |
| Warning | count | `warning` |
| Offline | count | `text.muted` |

**Row 2 — Server Table (MUI X DataGrid):**

- Row height: 32px
- Virtualized — only visible rows in DOM
- Columns: `Status` (dot) · `Server` (name) · `CPU %` · `RAM GB` · `Blocking` · `DB Offline` · `Last seen`
- Default sort: Status severity desc, then Server name asc
- Click row → selects server in tree, loads `ServerDashboard` in main content
- Column sorting on all numeric columns
- No pagination — full virtual scroll

---

## 6. Component Inventory

### New components

| Component | Location | Responsibility |
|---|---|---|
| `IconRail.tsx` | `components/layout/` | 48px nav rail, accent-reactive logo |
| `BreadcrumbBar.tsx` | `components/layout/` | 28px top bar, breadcrumb + alerts badge + AI button |
| `AccentProvider.tsx` | `components/layout/` | React context, sets `--color-accent` CSS var from alert state |
| `ServerTree.tsx` | `components/layout/` | Virtualized server list with search + filters |

### Refactored components

| Component | Change |
|---|---|
| `theme.ts` | Complete rewrite: new palette, Inter font, remove gradient overrides, update all MUI component overrides |
| `App.tsx` | Remove `AppBar` + `Tabs`, add `IconRail` + `BreadcrumbBar` + `ServerTree` layout shell |
| `HomeDashboard.tsx` | Replace card grid with 4 KPI cards + MUI X DataGrid dense table |
| `Sidebar.tsx` | Absorbed into `ServerTree.tsx` — remove original file |
| `ServerDashboard.tsx` | Re-skin tokens only, no structural change |
| `AIPanel.tsx` | Re-skin tokens only |
| `AlertsDrawer.tsx` | Re-skin tokens only |

### Unchanged

- All main process code (`src/main/`)
- All IPC handlers and types
- Zustand stores (alert state, server state, metrics state)
- Routing logic (tab index 0–4)

---

## 7. MUI Theme Overrides

Key changes to `buildTheme()` in `theme.ts`:

- Remove `mode: 'light'` path — app is dark-only after this redesign
- `typography.fontFamily`: `'Inter', -apple-system, sans-serif`
- `typography.fontSize`: 13 (unchanged)
- Remove all gradient strings from component overrides
- `MuiButton`: `borderRadius: 6`, no `boxShadow`, `textTransform: 'none'`
- `MuiChip`: `borderRadius: 4`
- `MuiTooltip`: `backgroundColor: '#30363d'`, `fontSize: 11`
- `MuiTableCell`: remove `textTransform: uppercase` from header override
- `MuiDataGrid`: `rowHeight: 32`, `columnHeaderHeight: 36`, border color `#30363d`
- `MuiListItemButton`: updated active/hover colors to new palette
- `MuiCssBaseline`: update scrollbar colors to match new palette

---

## 8. Out of Scope

- Light mode — removed. App becomes dark-only. Toggle UI element hidden.
- Animations / transitions beyond existing MUI defaults
- Recharts chart re-styling (follow-up task)
- Settings page visual overhaul (re-skin only, no layout change)

---

## 9. New npm Dependencies

| Package | Version | Reason |
|---|---|---|
| `@fontsource/inter` | latest | Inter font, offline-safe for Electron |
| `react-window` | latest | Virtual scroll for ServerTree (200 servers) |
| `@types/react-window` | latest | TypeScript types for react-window |

---

## 10. Constraints

- Electron — no CDN. Inter loaded via `@fontsource/inter` npm package.
- 200 server target — all list/tree components must use virtual scroll.
- `contextIsolation: true` — no changes to preload or IPC surface.
- Prettier: single quotes, no semicolons, width 100, LF.
- TypeScript strict — no `any`, no casting.
