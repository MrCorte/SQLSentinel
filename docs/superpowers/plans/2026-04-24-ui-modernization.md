# UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Azure Portal–styled UI with a Dark Pro theme (GitHub Dark palette, teal accent, Inter font) and a new Icon Rail + Breadcrumb layout shell that scales to 200 servers.

**Architecture:** New layout shell (`IconRail` + `BreadcrumbBar` + `ServerTree`) replaces the current 48px `AppBar` + `Tabs`. Server selection state is lifted into `appStore` so `ServerTree` (in the shell) and `Dashboard` (page) share it. `AccentProvider` drives a CSS custom property `--color-accent` that switches teal→red on critical alerts.

**Tech Stack:** React 19, MUI v5, MUI X DataGrid v8, `@tanstack/react-virtual` v3 (already installed), `@fontsource/inter` (new), Zustand, TypeScript strict, Electron + Vite.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/renderer/src/main.tsx` | Add Inter font import |
| Rewrite | `src/renderer/src/styles/tokens.ts` | Dark Pro color/size tokens |
| Rewrite | `src/renderer/src/styles/theme.ts` | Dark-only MUI theme, Inter, new overrides |
| Create | `src/renderer/src/components/layout/AccentProvider.tsx` | CSS var `--color-accent` from alert state |
| Create | `src/renderer/src/components/layout/IconRail.tsx` | 48px vertical nav rail |
| Create | `src/renderer/src/components/layout/BreadcrumbBar.tsx` | 28px top bar |
| Create | `src/renderer/src/components/layout/ServerTree.tsx` | Virtualized server list with search + filters |
| Modify | `src/renderer/src/store/appStore.ts` | Add `selectedServerId` / `setSelectedServerId` |
| Rewrite | `src/renderer/src/App.tsx` | New layout shell, always-dark theme |
| Modify | `src/renderer/src/pages/Dashboard.tsx` | Use `selectedServerId` from store, remove Sidebar |
| Rewrite | `src/renderer/src/components/HomeDashboard.tsx` | 4 KPI cards + MUI X DataGrid dense table |
| Modify | `src/renderer/src/components/AlertsDrawer.tsx` | Token re-skin only |
| Modify | `src/renderer/src/components/ai/AIPanel.tsx` | Token re-skin only |
| Delete | `src/renderer/src/components/Sidebar.tsx` | Absorbed into ServerTree |

---

## Task 1: Install Inter font

**Files:**
- Modify: `package.json` (via npm)
- Modify: `src/renderer/src/main.tsx`

- [ ] **Install the package**

```bash
cd C:\Projects\Claude\Projects\SQLSentinel
npm install @fontsource/inter
```

Expected: package added to `node_modules` and `package.json` dependencies.

- [ ] **Import the font weights in the renderer entry point**

Open `src/renderer/src/main.tsx`. After the existing `import './styles/global.css'` line add:

```ts
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
```

- [ ] **Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no new errors.

- [ ] **Commit**

```bash
git add package.json package-lock.json src/renderer/src/main.tsx
git commit -m "feat(ui): install @fontsource/inter"
```

---

## Task 2: Rewrite `tokens.ts` with Dark Pro palette

**Files:**
- Rewrite: `src/renderer/src/styles/tokens.ts`

- [ ] **Replace the entire file content**

```ts
// Dark Pro design tokens — single source of truth for all UI constants

export const tokens = {
  color: {
    // Accent
    accent: '#00d4aa',
    accentAlert: '#ef4444',
    accentAlpha12: 'rgba(0,212,170,0.12)',
    accentAlpha40: 'rgba(0,212,170,0.40)',

    // Semantic
    success: '#3fb950',
    successAlpha12: 'rgba(63,185,80,0.12)',
    warning: '#d29922',
    warningAlpha12: 'rgba(210,153,34,0.12)',
    danger: '#f78166',
    dangerAlpha12: 'rgba(247,129,102,0.12)',

    // Backgrounds
    bgBase: '#0d1117',
    bgSurface: '#161b22',
    bgBorder: '#30363d',

    // Text
    textPrimary: '#e6edf3',
    textMuted: '#8b949e',
    textOnAccent: '#0d1117',

    // Status dots
    dotOnline: '#3fb950',
    dotOffline: '#f78166',
    dotWarning: '#d29922',
    dotUnknown: '#8b949e',

    // Chart lines
    chartCpu: '#00d4aa',
    chartMemory: '#58a6ff',
    chartGrid: 'rgba(255,255,255,0.06)'
  },

  size: {
    railWidth: 48,
    breadcrumbHeight: 28,
    serverTreeWidth: 180,
    alertsDrawerWidth: 380
  },

  font: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    sizeXs: 11,
    sizeSm: 12,
    sizeBase: 13,
    sizeMd: 14,
    sizeLg: 16,
    sizeXl: 20,
    weightRegular: 400,
    weightMedium: 500,
    weightSemibold: 600,
    weightBold: 700
  },

  radius: {
    none: 0,
    sm: 6,
    md: 10,
    lg: 16
  },

  shadow: {
    card: '0 1px 3px rgba(0,0,0,0.3)',
    elevated: '0 4px 16px rgba(0,0,0,0.4)',
    drawer: '0 8px 32px rgba(0,0,0,0.5)'
  }
}
```

- [ ] **Run typecheck** — expect errors where old token keys are referenced; note them, they are fixed in later tasks

```bash
npm run typecheck 2>&1 | grep "tokens\." | head -40
```

- [ ] **Commit**

```bash
git add src/renderer/src/styles/tokens.ts
git commit -m "feat(ui): Dark Pro color tokens — replaces Azure palette"
```

---

## Task 3: Rewrite `theme.ts` — dark-only, Inter, new overrides

**Files:**
- Rewrite: `src/renderer/src/styles/theme.ts`

- [ ] **Replace the entire file**

```ts
import { createTheme, type Theme } from '@mui/material/styles'
import { tokens } from './tokens'

export function buildTheme(): Theme {
  return createTheme({
    palette: {
      mode: 'dark',
      primary: { main: tokens.color.accent },
      success: { main: tokens.color.success },
      warning: { main: tokens.color.warning },
      error: { main: tokens.color.danger },
      background: {
        default: tokens.color.bgBase,
        paper: tokens.color.bgSurface
      },
      text: {
        primary: tokens.color.textPrimary,
        secondary: tokens.color.textMuted,
        disabled: tokens.color.textMuted
      },
      divider: tokens.color.bgBorder
    },

    typography: {
      fontFamily: tokens.font.family,
      fontSize: tokens.font.sizeBase,
      h6: { fontSize: tokens.font.sizeLg, fontWeight: tokens.font.weightSemibold },
      subtitle1: { fontSize: tokens.font.sizeMd, fontWeight: tokens.font.weightSemibold },
      subtitle2: { fontSize: tokens.font.sizeBase, fontWeight: tokens.font.weightSemibold },
      body1: { fontSize: tokens.font.sizeBase },
      body2: { fontSize: tokens.font.sizeSm },
      caption: { fontSize: tokens.font.sizeXs, color: tokens.color.textMuted },
      button: {
        fontSize: tokens.font.sizeBase,
        fontWeight: tokens.font.weightSemibold,
        textTransform: 'none' as const
      }
    },

    shape: { borderRadius: tokens.radius.sm },

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: tokens.color.bgBase,
            color: tokens.color.textPrimary,
            fontFamily: tokens.font.family
          },
          '::-webkit-scrollbar': { width: 6, height: 6 },
          '::-webkit-scrollbar-track': { background: 'transparent' },
          '::-webkit-scrollbar-thumb': {
            background: tokens.color.bgBorder,
            borderRadius: 3,
            '&:hover': { background: tokens.color.textMuted }
          }
        }
      },

      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderRadius: tokens.radius.sm,
            border: `1px solid ${tokens.color.bgBorder}`
          }
        }
      },

      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.sm,
            textTransform: 'none',
            fontWeight: tokens.font.weightSemibold,
            fontSize: tokens.font.sizeBase,
            boxShadow: 'none',
            '&:hover': { boxShadow: 'none' }
          },
          contained: {
            backgroundColor: tokens.color.accent,
            color: tokens.color.textOnAccent,
            '&:hover': { backgroundColor: '#00b896' }
          },
          outlined: {
            borderColor: tokens.color.bgBorder,
            '&:hover': { backgroundColor: tokens.color.accentAlpha12, borderColor: tokens.color.accent }
          }
        }
      },

      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.sm,
            fontWeight: tokens.font.weightMedium,
            fontSize: tokens.font.sizeXs,
            height: 20,
            border: `1px solid ${tokens.color.bgBorder}`
          }
        }
      },

      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: tokens.color.bgBorder,
            color: tokens.color.textPrimary,
            fontSize: tokens.font.sizeXs,
            borderRadius: tokens.radius.sm
          }
        }
      },

      MuiTableCell: {
        styleOverrides: {
          head: {
            fontSize: tokens.font.sizeXs,
            fontWeight: tokens.font.weightMedium,
            color: tokens.color.textMuted,
            backgroundColor: tokens.color.bgSurface,
            borderBottom: `1px solid ${tokens.color.bgBorder}`
          },
          body: {
            fontSize: tokens.font.sizeSm,
            borderBottom: `1px solid ${tokens.color.bgBorder}`
          }
        }
      },

      MuiDataGrid: {
        styleOverrides: {
          root: {
            border: `1px solid ${tokens.color.bgBorder}`,
            '--DataGrid-rowBorderColor': tokens.color.bgBorder,
            '--DataGrid-containerBackground': tokens.color.bgSurface,
            fontSize: tokens.font.sizeSm,
            '& .MuiDataGrid-columnHeaders': {
              backgroundColor: tokens.color.bgSurface,
              borderBottom: `1px solid ${tokens.color.bgBorder}`,
              minHeight: '36px !important',
              maxHeight: '36px !important',
              lineHeight: '36px !important'
            },
            '& .MuiDataGrid-columnHeaderTitle': {
              fontSize: tokens.font.sizeXs,
              fontWeight: tokens.font.weightMedium,
              color: tokens.color.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em'
            },
            '& .MuiDataGrid-row': {
              '&:hover': { backgroundColor: `${tokens.color.bgSurface}cc` }
            },
            '& .MuiDataGrid-cell': {
              borderBottom: `1px solid ${tokens.color.bgBorder}`,
              padding: '0 8px'
            },
            '& .MuiDataGrid-footerContainer': {
              borderTop: `1px solid ${tokens.color.bgBorder}`,
              backgroundColor: tokens.color.bgSurface
            }
          }
        },
        defaultProps: {
          rowHeight: 32,
          columnHeaderHeight: 36,
          disableRowSelectionOnClick: false,
          hideFooterPagination: false
        }
      },

      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.sm,
            margin: '1px 6px',
            width: 'calc(100% - 12px)',
            '&.Mui-selected': {
              backgroundColor: tokens.color.accentAlpha12,
              borderLeft: `2px solid ${tokens.color.accent}`,
              borderRadius: `0 ${tokens.radius.sm}px ${tokens.radius.sm}px 0`,
              marginLeft: 0,
              paddingLeft: '14px',
              '&:hover': { backgroundColor: tokens.color.accentAlpha12 }
            },
            '&:hover': { backgroundColor: `${tokens.color.bgSurface}aa` }
          }
        }
      },

      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: tokens.color.bgSurface,
            boxShadow: tokens.shadow.drawer,
            border: `1px solid ${tokens.color.bgBorder}`
          }
        }
      },

      MuiDivider: {
        styleOverrides: { root: { borderColor: tokens.color.bgBorder } }
      },

      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.sm,
            '&:hover': { backgroundColor: tokens.color.accentAlpha12 }
          }
        }
      },

      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              '& fieldset': { borderColor: tokens.color.bgBorder },
              '&:hover fieldset': { borderColor: tokens.color.textMuted },
              '&.Mui-focused fieldset': { borderColor: tokens.color.accent }
            }
          }
        }
      }
    }
  })
}
```

- [ ] **Typecheck**

```bash
npm run typecheck 2>&1 | grep "theme\." | head -20
```

- [ ] **Commit**

```bash
git add src/renderer/src/styles/theme.ts
git commit -m "feat(ui): dark-only MUI theme — Inter, teal accent, no gradients"
```

---

## Task 4: Create `AccentProvider.tsx`

**Files:**
- Create: `src/renderer/src/components/layout/AccentProvider.tsx`

The `--color-accent` CSS custom property on the root div lets all child components reference the reactive accent color without React re-renders propagating deeply.

- [ ] **Create the directory and file**

```bash
mkdir -p "C:\Projects\Claude\Projects\SQLSentinel\src\renderer\src\components\layout"
```

```ts
// src/renderer/src/components/layout/AccentProvider.tsx
import { useEffect, type ReactNode } from 'react'
import { useAlertsStore } from '../../store/alertsStore'
import { tokens } from '../../styles/tokens'

interface Props {
  children: ReactNode
}

export function AccentProvider({ children }: Props): React.JSX.Element {
  const hasCritical = useAlertsStore((s) =>
    s.alerts.some((a) => a.severity === 'CRITICAL' && a.acknowledgedAt === null)
  )

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--color-accent',
      hasCritical ? tokens.color.accentAlert : tokens.color.accent
    )
  }, [hasCritical])

  return <>{children}</>
}
```

- [ ] **Typecheck**

```bash
npm run typecheck 2>&1 | head -20
```

Expected: no errors in the new file.

- [ ] **Commit**

```bash
git add src/renderer/src/components/layout/AccentProvider.tsx
git commit -m "feat(ui): AccentProvider — reactive teal/red CSS var on critical alerts"
```

---

## Task 5: Create `IconRail.tsx`

**Files:**
- Create: `src/renderer/src/components/layout/IconRail.tsx`

- [ ] **Create the file**

```ts
// src/renderer/src/components/layout/IconRail.tsx
import { Box, Tooltip } from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import SearchIcon from '@mui/icons-material/Search'
import StorageIcon from '@mui/icons-material/Storage'
import BarChartIcon from '@mui/icons-material/BarChart'
import SettingsIcon from '@mui/icons-material/Settings'
import { tokens } from '../../styles/tokens'

const SECTIONS = [
  { tab: 0, label: 'Overview', icon: DashboardIcon },
  { tab: 1, label: 'Discovery', icon: SearchIcon },
  { tab: 2, label: 'Inventory', icon: StorageIcon },
  { tab: 3, label: 'Dashboard', icon: BarChartIcon }
]

interface Props {
  activeTab: number
  onTabChange: (tab: number) => void
  onSettingsClick: () => void
}

export function IconRail({ activeTab, onTabChange, onSettingsClick }: Props): React.JSX.Element {
  return (
    <Box
      sx={{
        width: tokens.size.railWidth,
        minWidth: tokens.size.railWidth,
        height: '100vh',
        bgcolor: tokens.color.bgSurface,
        borderRight: `1px solid ${tokens.color.bgBorder}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 1,
        gap: 0.5,
        flexShrink: 0,
        zIndex: 200
      }}
    >
      {/* Logo — background reacts to --color-accent */}
      <Box
        onClick={() => onTabChange(0)}
        sx={{
          width: 26,
          height: 26,
          borderRadius: '6px',
          background: 'var(--color-accent, #00d4aa)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 1.5,
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.3s ease'
        }}
      >
        <Box
          component="span"
          sx={{
            fontSize: 9,
            fontWeight: 800,
            color: tokens.color.textOnAccent,
            fontFamily: tokens.font.family,
            lineHeight: 1,
            userSelect: 'none'
          }}
        >
          SS
        </Box>
      </Box>

      {/* Nav icons */}
      {SECTIONS.map(({ tab, label, icon: Icon }) => {
        const isActive = activeTab === tab
        return (
          <Tooltip key={tab} title={label} placement="right" arrow>
            <Box
              onClick={() => onTabChange(tab)}
              sx={{
                width: 34,
                height: 34,
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                bgcolor: isActive ? tokens.color.accentAlpha12 : 'transparent',
                border: isActive
                  ? `1px solid ${tokens.color.accentAlpha40}`
                  : '1px solid transparent',
                color: isActive ? tokens.color.accent : tokens.color.textMuted,
                transition: 'all 0.15s ease',
                '&:hover': {
                  bgcolor: tokens.color.accentAlpha12,
                  color: tokens.color.textPrimary
                }
              }}
            >
              <Icon sx={{ fontSize: 18 }} />
            </Box>
          </Tooltip>
        )
      })}

      {/* Settings — pinned to bottom */}
      <Tooltip title="Settings" placement="right" arrow>
        <Box
          onClick={onSettingsClick}
          sx={{
            mt: 'auto',
            width: 34,
            height: 34,
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            bgcolor: activeTab === 4 ? tokens.color.accentAlpha12 : 'transparent',
            border: activeTab === 4
              ? `1px solid ${tokens.color.accentAlpha40}`
              : '1px solid transparent',
            color: activeTab === 4 ? tokens.color.accent : tokens.color.textMuted,
            transition: 'all 0.15s ease',
            '&:hover': { bgcolor: tokens.color.accentAlpha12, color: tokens.color.textPrimary }
          }}
        >
          <SettingsIcon sx={{ fontSize: 18 }} />
        </Box>
      </Tooltip>
    </Box>
  )
}
```

- [ ] **Typecheck**

```bash
npm run typecheck 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/renderer/src/components/layout/IconRail.tsx
git commit -m "feat(ui): IconRail component — 48px nav rail with teal active state"
```

---

## Task 6: Create `BreadcrumbBar.tsx`

**Files:**
- Create: `src/renderer/src/components/layout/BreadcrumbBar.tsx`

- [ ] **Create the file**

```ts
// src/renderer/src/components/layout/BreadcrumbBar.tsx
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { useAlertsStore } from '../../store/alertsStore'
import { tokens } from '../../styles/tokens'

const SECTION_NAMES: Record<number, string> = {
  0: 'Overview',
  1: 'Discovery',
  2: 'Inventory',
  3: 'Dashboard',
  4: 'Settings'
}

interface Props {
  activeTab: number
  selectedServerName: string | null
  onOpenAlerts: () => void
  onOpenAI: () => void
}

export function BreadcrumbBar({
  activeTab,
  selectedServerName,
  onOpenAlerts,
  onOpenAI
}: Props): React.JSX.Element {
  const criticalCount = useAlertsStore((s) =>
    s.alerts.filter((a) => a.severity === 'CRITICAL' && a.acknowledgedAt === null).length
  )
  const warningCount = useAlertsStore((s) =>
    s.alerts.filter((a) => a.severity === 'WARNING' && a.acknowledgedAt === null).length
  )

  const sectionName = SECTION_NAMES[activeTab] ?? 'SQLSentinel'
  const hasAlerts = criticalCount > 0 || warningCount > 0
  const alertLabel = criticalCount > 0 ? `${criticalCount} critical` : `${warningCount} warning`
  const alertColor = criticalCount > 0 ? tokens.color.danger : tokens.color.warning

  return (
    <Box
      sx={{
        height: tokens.size.breadcrumbHeight,
        minHeight: tokens.size.breadcrumbHeight,
        bgcolor: tokens.color.bgSurface,
        borderBottom: `1px solid ${tokens.color.bgBorder}`,
        display: 'flex',
        alignItems: 'center',
        px: 1.5,
        gap: 0.5,
        flexShrink: 0
      }}
    >
      {/* Breadcrumb left */}
      <Typography sx={{ fontSize: tokens.font.sizeXs, color: tokens.color.textMuted }}>
        {sectionName}
      </Typography>
      {selectedServerName && (
        <>
          <Typography sx={{ fontSize: tokens.font.sizeXs, color: tokens.color.bgBorder, mx: 0.5 }}>
            ›
          </Typography>
          <Typography
            sx={{
              fontSize: tokens.font.sizeXs,
              color: tokens.color.textPrimary,
              fontWeight: tokens.font.weightMedium
            }}
          >
            {selectedServerName}
          </Typography>
        </>
      )}

      {/* Right side */}
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {hasAlerts && (
          <Tooltip title="Open alerts" placement="bottom">
            <Box
              onClick={onOpenAlerts}
              sx={{
                fontSize: tokens.font.sizeXs,
                fontWeight: tokens.font.weightMedium,
                color: alertColor,
                bgcolor: `${alertColor}20`,
                border: `1px solid ${alertColor}40`,
                borderRadius: '10px',
                px: 1,
                py: 0.25,
                cursor: 'pointer',
                userSelect: 'none',
                lineHeight: 1.4,
                '&:hover': { bgcolor: `${alertColor}30` }
              }}
            >
              ● {alertLabel}
            </Box>
          </Tooltip>
        )}

        <Tooltip title="AI Assistant" placement="bottom">
          <IconButton size="small" onClick={onOpenAI} sx={{ color: tokens.color.textMuted }}>
            <SmartToyIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}
```

- [ ] **Typecheck**

```bash
npm run typecheck 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/renderer/src/components/layout/BreadcrumbBar.tsx
git commit -m "feat(ui): BreadcrumbBar — 28px bar with breadcrumb, alert badge, AI button"
```

---

## Task 7: Create `ServerTree.tsx`

**Files:**
- Create: `src/renderer/src/components/layout/ServerTree.tsx`

`ServerTree` wraps the existing `useSidebarTree` hook and `SidebarTree`/`SidebarSearch` components with the new Dark Pro styling and adds severity filter pills. The complex group/AG logic lives in `useSidebarTree` — we don't touch it.

- [ ] **Create the file**

```ts
// src/renderer/src/components/layout/ServerTree.tsx
import { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { SidebarSearch } from '../features/sidebar/SidebarSearch'
import { SidebarTree } from '../features/sidebar/SidebarTree'
import { useSidebarTree } from '../features/sidebar/useSidebarTree'
import { useServersStore } from '../../store/serversStore'
import { useAlertsStore } from '../../store/alertsStore'
import { tokens } from '../../styles/tokens'
import type { StoredServer } from '../../../../preload/index'

type SeverityFilter = 'all' | 'critical' | 'warning' | 'offline'

const FILTERS: { key: SeverityFilter; label: string; color: string }[] = [
  { key: 'all', label: 'All', color: tokens.color.textMuted },
  { key: 'critical', label: 'Critical', color: tokens.color.danger },
  { key: 'warning', label: 'Warning', color: tokens.color.warning },
  { key: 'offline', label: 'Offline', color: tokens.color.textMuted }
]

interface Props {
  selectedServer: StoredServer | null
  selectedAgName: string | null
  onSelectServer: (server: StoredServer) => void
  onSelectAg: (agName: string) => void
  onRemoveServer: (server: StoredServer) => void
}

export function ServerTree({
  selectedServer,
  selectedAgName,
  onSelectServer,
  onSelectAg,
  onRemoveServer
}: Props): React.JSX.Element {
  const servers = useServersStore((s) => s.servers)
  const alerts = useAlertsStore((s) => s.alerts)
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')

  const {
    flatItems,
    sortedGroups,
    serverAliases,
    searchText,
    ctxMenu,
    moveMenuOpen,
    setSearchText,
    toggleCollapse,
    toggleAgCollapse,
    toggleMachineCollapse,
    handleContextMenu,
    handleCloseCtx,
    setMoveMenuOpen,
    handleMoveToGroup,
    setServerAlias
  } = useSidebarTree(servers)

  // Build set of server IDs matching the severity filter
  const filteredIds = new Set<string>()
  if (severityFilter !== 'all') {
    for (const server of servers) {
      if (severityFilter === 'offline' && server.unreachable) {
        filteredIds.add(server.id)
      } else if (severityFilter === 'critical' || severityFilter === 'warning') {
        const sev = severityFilter.toUpperCase() as 'CRITICAL' | 'WARNING'
        const hasAlert = alerts.some(
          (a) => a.serverId === server.id && a.severity === sev && a.acknowledgedAt === null
        )
        if (hasAlert) filteredIds.add(server.id)
      }
    }
  }

  const visibleItems =
    severityFilter === 'all'
      ? flatItems
      : flatItems.filter((item) => {
          if (item.type === 'server') return filteredIds.has(item.server.id)
          if (item.type === 'machine') return item.servers.some((s) => filteredIds.has(s.id))
          // group headers: show only if they have matching servers
          if (item.type === 'group') {
            return item.servers ? item.servers.some((s: StoredServer) => filteredIds.has(s.id)) : true
          }
          return true
        })

  const serversError = useServersStore((s) => (s.initialized ? null : 'Loading…'))

  return (
    <Box
      sx={{
        width: tokens.size.serverTreeWidth,
        minWidth: tokens.size.serverTreeWidth,
        height: '100%',
        bgcolor: tokens.color.bgBase,
        borderRight: `1px solid ${tokens.color.bgBorder}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0
      }}
    >
      {/* Search */}
      <Box sx={{ px: 0.5, pt: 0.5, flexShrink: 0 }}>
        <SidebarSearch value={searchText} onChange={setSearchText} />
      </Box>

      {/* Severity filter pills */}
      <Box sx={{ display: 'flex', gap: 0.5, px: 1, py: 0.5, flexShrink: 0 }}>
        {FILTERS.map(({ key, label, color }) => {
          const isActive = severityFilter === key
          return (
            <Box
              key={key}
              onClick={() => setSeverityFilter(key)}
              sx={{
                fontSize: tokens.font.sizeXs,
                fontWeight: tokens.font.weightMedium,
                color: isActive ? color : tokens.color.textMuted,
                bgcolor: isActive ? `${color}20` : 'transparent',
                border: `1px solid ${isActive ? `${color}40` : tokens.color.bgBorder}`,
                borderRadius: '10px',
                px: 0.75,
                py: 0.25,
                cursor: 'pointer',
                userSelect: 'none',
                lineHeight: 1.4,
                transition: 'all 0.15s ease',
                '&:hover': { bgcolor: `${color}15`, color: color }
              }}
            >
              {label}
            </Box>
          )
        })}
      </Box>

      {/* Server count label */}
      <Typography
        sx={{
          fontSize: tokens.font.sizeXs,
          color: tokens.color.textMuted,
          px: 1,
          pb: 0.5,
          flexShrink: 0,
          letterSpacing: '0.06em',
          textTransform: 'uppercase'
        }}
      >
        {servers.length} servers
      </Typography>

      {/* Tree (virtualized via @tanstack/react-virtual inside SidebarTree) */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <SidebarTree
          items={visibleItems}
          sortedGroups={sortedGroups}
          serverAliases={serverAliases}
          selectedServer={selectedServer}
          selectedAgName={selectedAgName}
          searchText={searchText}
          ctxMenu={ctxMenu}
          moveMenuOpen={moveMenuOpen}
          serversError={serversError}
          onSelectServer={onSelectServer}
          onSelectAg={onSelectAg}
          onRemoveServer={onRemoveServer}
          onToggleCollapse={toggleCollapse}
          onToggleAgCollapse={toggleAgCollapse}
          onToggleMachineCollapse={toggleMachineCollapse}
          onContextMenu={handleContextMenu}
          onCloseCtx={handleCloseCtx}
          onMoveMenuOpen={setMoveMenuOpen}
          onMoveToGroup={handleMoveToGroup}
          onSetAlias={setServerAlias}
        />
      </Box>
    </Box>
  )
}
```

- [ ] **Typecheck to check SidebarTree prop names**

```bash
npm run typecheck 2>&1 | grep "ServerTree\|SidebarTree" | head -30
```

Fix any prop name mismatches by reading `src/renderer/src/components/features/sidebar/SidebarTree.tsx` and aligning the prop names exactly.

- [ ] **Commit when typecheck passes**

```bash
git add src/renderer/src/components/layout/ServerTree.tsx
git commit -m "feat(ui): ServerTree — virtualized server list with severity filter pills"
```

---

## Task 8: Extend `appStore` with `selectedServerId`

**Files:**
- Modify: `src/renderer/src/store/appStore.ts`

- [ ] **Add `selectedServerId` to the store**

Replace the full file:

```ts
import { create } from 'zustand'

interface AppStore {
  /** Server ID to auto-select when Dashboard mounts/activates */
  pendingServerId: string | null
  setPendingServerId: (id: string | null) => void
  /** Currently selected server ID — shared between ServerTree and Dashboard */
  selectedServerId: string | null
  setSelectedServerId: (id: string | null) => void
  /** True while the Electron window is in the background (blurred). */
  isBackground: boolean
  setIsBackground: (v: boolean) => void
}

export const useAppStore = create<AppStore>((set) => ({
  pendingServerId: null,
  setPendingServerId: (id) => set({ pendingServerId: id }),
  selectedServerId: null,
  setSelectedServerId: (id) => set({ selectedServerId: id }),
  isBackground: false,
  setIsBackground: (v) => set({ isBackground: v })
}))
```

- [ ] **Typecheck**

```bash
npm run typecheck 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/renderer/src/store/appStore.ts
git commit -m "feat(ui): add selectedServerId to appStore for shared server selection"
```

---

## Task 9: Refactor `App.tsx` — new layout shell

**Files:**
- Rewrite: `src/renderer/src/App.tsx`

This is the largest change. All IPC/state logic from `AppInner` is preserved. The JSX layout replaces AppBar+Tabs with IconRail+BreadcrumbBar+ServerTree shell.

- [ ] **Read the current `App.tsx` to understand all IPC hooks in `AppInner`** (already done above — preserve them all exactly)

- [ ] **Replace `App.tsx`**

```ts
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Box } from '@mui/material'
import { AIPanel } from './components/ai/AIPanel'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { Discovery } from './pages/Discovery'
import { Inventory } from './pages/Inventory'
import { Dashboard } from './pages/Dashboard'
import { Settings } from './pages/Settings'
import { LoginPage } from './pages/Login'
import { AlertsDrawer } from './components/AlertsDrawer'
import { HomeDashboard } from './components/HomeDashboard'
import { WorkerProvider } from './context/WorkerContext'
import { useWorker } from './context/useWorker'
import { useServersStore } from './store/serversStore'
import { useAlertsStore } from './store/alertsStore'
import { useAppStore } from './store/appStore'
import { useMetricsStore } from './store/metricsStore'
import { useMockData } from './hooks/useMockData'
import { useIpcEvent } from './hooks/useIpcEvent'
import { buildTheme } from './styles/theme'
import { AuthContext } from './context/AuthContext'
import { AccentProvider } from './components/layout/AccentProvider'
import { IconRail } from './components/layout/IconRail'
import { BreadcrumbBar } from './components/layout/BreadcrumbBar'
import { ServerTree } from './components/layout/ServerTree'
import type {
  AuthSession,
  ServerHealthPayload,
  StoredServer,
  ServerUnreachableEvent,
  Alert
} from '../../preload/index'
import { createLogger } from './utils/logger'
import { migrateAliasKeys } from './store/groupsStore'

const log = createLogger('app')
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const TREE_VISIBLE_TABS = new Set([2, 3]) // Inventory + Dashboard

function AppInner({ onLogout }: { onLogout: () => void }): React.JSX.Element {
  const [tab, setTab] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  useMockData()

  const { setRetentionMinutes, seedHistory } = useWorker()
  const { setAlerts, addAlert, acknowledgeAlert: acknowledgeAlertInStore } = useAlertsStore()
  const { selectedServerId, setSelectedServerId } = useAppStore()
  const servers = useServersStore((s) => s.servers)

  // Derive selected server object from id
  const selectedServer = useMemo(
    () => servers.find((s) => s.id === selectedServerId) ?? null,
    [servers, selectedServerId]
  )
  const [selectedAgName, setSelectedAgName] = useState<string | null>(null)

  // Load persisted servers on mount
  useEffect(() => {
    log.info('init — chiamata loadServers')
    const { loadServers } = useServersStore.getState()
    if (!window.sqlSentinel?.servers?.getAll) {
      log.error('sqlSentinel.servers not available!')
      useServersStore.setState({ initialized: true })
      return
    }
    loadServers()
      .then(() => {
        const { servers: srvs } = useServersStore.getState()
        log.info('loadServers completato, servers:', srvs.length)
        migrateAliasKeys(srvs)
        if (srvs.length > 0) {
          window.sqlSentinel
            .workerStart({
              intervalSeconds: 60,
              servers: srvs.map((s) => ({
                ip: s.ip ?? s.host,
                port: s.port,
                instanceName: s.instanceName,
                useWindowsAuth: s.useWindowsAuth ?? false,
                username: s.username,
                password: s.password
              }))
            })
            .then(() => {
              if (typeof window.sqlSentinel?.getHistoryBulk === 'function') {
                window.sqlSentinel
                  .getHistoryBulk()
                  .then((result) => {
                    if (result.ok && Object.keys(result.data).length > 0) seedHistory(result.data)
                  })
                  .catch(() => {})
              }
            })
            .catch((err) => log.error('workerStart failed:', err))
        }
      })
      .catch((err) => log.error('loadServers failed:', err))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync server list with the background worker
  useEffect(() => {
    if (USE_MOCK) return
    return useServersStore.subscribe((state) => {
      if (!state.initialized) return
      window.sqlSentinel.workerSyncServers({
        servers: state.servers.map((s) => ({
          ip: s.ip ?? s.host,
          port: s.port,
          instanceName: s.instanceName,
          useWindowsAuth: s.useWindowsAuth ?? false,
          username: s.username,
          password: s.password
        }))
      })
    })
  }, [])

  const handleServerHealthUpdate = useCallback((...args: unknown[]) => {
    const health = args[0] as ServerHealthPayload
    useMetricsStore.getState().setServerHealth(health)
  }, [])
  useIpcEvent(window.sqlSentinel.onServerHealthUpdate, handleServerHealthUpdate)

  const handleServerConfigUpdated = useCallback((...args: unknown[]) => {
    const updatedServers = args[0] as StoredServer[]
    const { updateServer } = useServersStore.getState()
    for (const srv of updatedServers) {
      updateServer(srv.id, {
        agGroupId: srv.agGroupId,
        agName: srv.agName,
        agRole: srv.agRole,
        logicalCpus: srv.logicalCpus,
        physicalCpus: srv.physicalCpus
      })
    }
  }, [])
  useEffect(() => {
    if (typeof window.sqlSentinel?.onServerConfigUpdated !== 'function') return
    return window.sqlSentinel.onServerConfigUpdated(handleServerConfigUpdated)
  }, [handleServerConfigUpdated])

  const handleServerUnreachable = useCallback((...args: unknown[]) => {
    const data = args[0] as ServerUnreachableEvent
    useServersStore.getState().updateServer(data.serverId, {
      unreachable: true,
      unreachableSince: data.since
    })
  }, [])
  const handleServerRecovered = useCallback((...args: unknown[]) => {
    const serverId = args[0] as string
    useServersStore.getState().updateServer(serverId, {
      unreachable: false,
      unreachableSince: undefined,
      lastSeen: new Date().toISOString()
    })
  }, [])
  useEffect(() => {
    if (typeof window.sqlSentinel?.onServerUnreachable !== 'function') return
    const unsubUnreachable = window.sqlSentinel.onServerUnreachable(handleServerUnreachable)
    const unsubRecovered = window.sqlSentinel.onServerRecovered(handleServerRecovered)
    return () => { unsubUnreachable(); unsubRecovered() }
  }, [handleServerUnreachable, handleServerRecovered])

  useEffect(() => {
    window.sqlSentinel
      .getSettings()
      .then((result) => { if (result.ok) setRetentionMinutes(result.data.retentionMinutes) })
      .catch((err) => log.error('getSettings failed:', err))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.sqlSentinel
      .getAlerts()
      .then((result) => { if (result.ok) setAlerts(result.data) })
      .catch((err) => log.error('getAlerts failed:', err))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAlertNew = useCallback(
    (...args: unknown[]) => { addAlert(args[0] as Alert) },
    [addAlert]
  )
  useIpcEvent(window.sqlSentinel.onAlertNew, handleAlertNew)

  function handleAcknowledge(alertId: string): void {
    window.sqlSentinel
      .acknowledgeAlert({ alertId })
      .then((result) => { if (result.ok) acknowledgeAlertInStore(alertId) })
      .catch((err) => log.error('acknowledgeAlert failed:', err))
  }

  function handleSelectServer(server: StoredServer): void {
    setSelectedServerId(server.id)
    setSelectedAgName(null)
    setTab(3)
  }

  const showTree = TREE_VISIBLE_TABS.has(tab)

  return (
    <AccentProvider>
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {/* Icon Rail */}
        <IconRail
          activeTab={tab}
          onTabChange={setTab}
          onSettingsClick={() => setTab(4)}
        />

        {/* Right of rail: breadcrumb + (tree + content) */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <BreadcrumbBar
            activeTab={tab}
            selectedServerName={selectedServer?.host ?? selectedServer?.ip ?? null}
            onOpenAlerts={() => setDrawerOpen(true)}
            onOpenAI={() => setAiOpen(true)}
          />

          <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Server tree — visible on Inventory + Dashboard tabs */}
            {showTree && (
              <ServerTree
                selectedServer={selectedServer}
                selectedAgName={selectedAgName}
                onSelectServer={handleSelectServer}
                onSelectAg={(agName) => { setSelectedAgName(agName); setTab(3) }}
                onRemoveServer={(server) => {
                  window.sqlSentinel.servers.remove(server.id).catch(() => {})
                  useServersStore.getState().removeServer(server.id)
                  if (selectedServerId === server.id) setSelectedServerId(null)
                }}
              />
            )}

            {/* Main content */}
            <Box sx={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
              {tab === 0 && (
                <Box sx={{ height: '100%', overflow: 'auto' }}>
                  <HomeDashboard
                    onNavigateToServer={(id) => {
                      setSelectedServerId(id)
                      setTab(3)
                    }}
                    onNavigateToDiscovery={() => setTab(1)}
                    onOpenAlerts={() => setDrawerOpen(true)}
                  />
                </Box>
              )}
              {tab === 1 && <Box sx={{ height: '100%', overflow: 'auto' }}><Discovery /></Box>}
              {tab === 2 && (
                <Box sx={{ height: '100%', overflow: 'hidden' }}>
                  <Inventory onNavigateToDashboard={() => setTab(3)} />
                </Box>
              )}
              {tab === 3 && <Box sx={{ height: '100%', overflow: 'hidden' }}><Dashboard /></Box>}
              {tab === 4 && <Box sx={{ height: '100%', overflow: 'auto' }}><Settings /></Box>}
            </Box>
          </Box>
        </Box>
      </Box>

      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} />
      <AlertsDrawer
        open={drawerOpen}
        alerts={useAlertsStore.getState().alerts}
        onClose={() => setDrawerOpen(false)}
        onAcknowledge={handleAcknowledge}
      />
    </AccentProvider>
  )
}

function App(): React.JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  // Theme is always dark — no toggle
  const muiTheme = useMemo(() => buildTheme(), [])

  useEffect(() => {
    window.sqlSentinel
      .checkAuth()
      .then(({ authenticated, session: s }) => { if (authenticated && s) setSession(s) })
      .catch((err) => log.error('checkAuth failed:', err))
      .finally(() => setAuthChecking(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onUnhandledRejection(e: PromiseRejectionEvent): void {
      if (e.reason instanceof Error && e.reason.message.includes('UNAUTHORIZED')) {
        e.preventDefault()
        setSession(null)
      }
    }
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }, [])

  const handleLogout = useCallback(async (): Promise<void> => {
    await window.sqlSentinel.logout()
    setSession(null)
  }, [])

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      {authChecking ? null : !session ? (
        <LoginPage onLogin={setSession} />
      ) : (
        <AuthContext.Provider value={{ session, logout: handleLogout }}>
          <WorkerProvider>
            <AppInner onLogout={handleLogout} />
          </WorkerProvider>
        </AuthContext.Provider>
      )}
    </ThemeProvider>
  )
}

export default App
```

- [ ] **Typecheck — fix any import or prop errors**

```bash
npm run typecheck 2>&1 | head -40
```

Common issues to fix:
- `useAlertsStore.getState().alerts` in `AlertsDrawer` render should use the reactive `alerts` from hook, not `getState()`. Replace with `const { alerts } = useAlertsStore()` at the top of `AppInner` and pass that.
- `window.sqlSentinel.servers.remove` — check the actual API name in `src/preload/index.d.ts` and use the correct call.

- [ ] **Commit once typecheck is clean**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(ui): new layout shell — IconRail + BreadcrumbBar + ServerTree replace AppBar+Tabs"
```

---

## Task 10: Update `Dashboard.tsx` — use `selectedServerId` from store, remove Sidebar

**Files:**
- Modify: `src/renderer/src/pages/Dashboard.tsx`

Currently `Dashboard.tsx` manages its own `selectedServer` state and renders `<Sidebar>`. Now that `ServerTree` lives in the layout shell and `selectedServerId` is in `appStore`, `Dashboard` just reads that value.

- [ ] **Remove local server-selection state and Sidebar usage**

In `Dashboard.tsx`:

1. Remove the `Sidebar` import and its JSX block.
2. Remove the local `selectedServer` / `setSelectedServer` state that was driven by Sidebar.
3. Add at the top of the component:

```ts
import { useAppStore } from '../store/appStore'
import { useServersStore } from '../store/serversStore'
```

4. Inside the component, replace local `selectedServer` state with:

```ts
const selectedServerId = useAppStore((s) => s.selectedServerId)
const servers = useServersStore((s) => s.servers)
const selectedServer = useMemo(
  () => servers.find((s) => s.id === selectedServerId) ?? null,
  [servers, selectedServerId]
)
```

5. Remove the `pendingServerId` effect (now handled in `App.tsx` via `setSelectedServerId`).

6. Remove the outer flex Box that contained Sidebar + content — `Dashboard` now renders only the content area.

- [ ] **Typecheck after changes**

```bash
npm run typecheck 2>&1 | grep "Dashboard" | head -20
```

- [ ] **Commit**

```bash
git add src/renderer/src/pages/Dashboard.tsx
git commit -m "feat(ui): Dashboard reads selectedServerId from appStore, removes embedded Sidebar"
```

---

## Task 11: Rewrite `HomeDashboard.tsx` — KPI cards + DataGrid

**Files:**
- Rewrite: `src/renderer/src/components/HomeDashboard.tsx`

The `useHomeDashboard` hook is unchanged — it provides all the data. We replace the layout and replace `ServerTable` with MUI X DataGrid.

- [ ] **Replace `HomeDashboard.tsx`**

```ts
import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { DataGrid, type GridColDef, type GridRowParams } from '@mui/x-data-grid'
import { useHomeDashboard } from './features/home/useHomeDashboard'
import { tokens } from '../styles/tokens'
import { useAppStore } from '../store/appStore'
import type { StoredServer } from '../../../preload/index'

interface Props {
  onNavigateToServer: (serverId: string) => void
  onNavigateToDiscovery: () => void
  onOpenAlerts: () => void
}

function StatusDot({ color }: { color: string }): React.JSX.Element {
  return (
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: color,
        display: 'inline-block',
        flexShrink: 0
      }}
    />
  )
}

function KpiCard({
  label,
  value,
  color
}: {
  label: string
  value: number
  color: string
}): React.JSX.Element {
  return (
    <Box
      sx={{
        bgcolor: tokens.color.bgSurface,
        border: `1px solid ${tokens.color.bgBorder}`,
        borderRadius: tokens.radius.sm,
        px: 2,
        py: 1.5,
        minWidth: 100,
        flex: 1
      }}
    >
      <Typography
        sx={{
          fontSize: tokens.font.sizeXs,
          fontWeight: tokens.font.weightMedium,
          color: tokens.color.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          mb: 0.5
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 28,
          fontWeight: tokens.font.weightBold,
          color,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

export function HomeDashboard({
  onNavigateToServer,
  onNavigateToDiscovery
}: Props): React.JSX.Element {
  const {
    servers,
    metricsMap,
    summaries,
    alertCountByServer,
    onlineCount,
    offlineCount,
    criticalCount,
    warningCount
  } = useHomeDashboard(onNavigateToServer)

  const setSelectedServerId = useAppStore((s) => s.setSelectedServerId)

  // Build DataGrid rows — one row per server
  const rows = useMemo(
    () =>
      servers.map((s: StoredServer) => {
        const key = `${s.host ?? s.ip}:${s.port}`
        const snap = metricsMap[key]
        const summary = summaries[key]
        const alertCount = alertCountByServer[s.id] ?? 0
        const cpu = snap?.instanceInfo?.cpuUsagePercent ?? null
        const memUsed = snap?.instanceInfo?.memoryUsedMb ?? null
        const memTarget = snap?.instanceInfo?.memoryTargetMb ?? null
        const ramGb = memUsed != null ? (memUsed / 1024).toFixed(1) : null
        const blocking = snap?.activeSessions?.filter((se) => se.blockingSessionId > 0).length ?? 0
        const dbOffline = snap?.databases?.filter((d) => d.stateDesc !== 'ONLINE').length ?? 0
        const lastSeen = summary?.collectedAt ? new Date(summary.collectedAt) : null

        let statusColor = tokens.color.dotUnknown
        if (s.unreachable) statusColor = tokens.color.dotOffline
        else if (snap) statusColor = tokens.color.dotOnline

        return {
          id: s.id,
          serverId: s.id,
          statusColor,
          serverName: s.host ?? s.ip ?? '—',
          cpu,
          ramGb,
          blocking,
          dbOffline,
          alertCount,
          lastSeen
        }
      }),
    [servers, metricsMap, summaries, alertCountByServer]
  )

  const columns: GridColDef[] = [
    {
      field: 'statusColor',
      headerName: '',
      width: 28,
      sortable: false,
      renderCell: (params) => <StatusDot color={params.value as string} />
    },
    {
      field: 'serverName',
      headerName: 'Server',
      flex: 2,
      renderCell: (params) => (
        <Typography sx={{ fontSize: tokens.font.sizeSm, color: tokens.color.textPrimary, fontWeight: tokens.font.weightMedium }}>
          {params.value as string}
        </Typography>
      )
    },
    {
      field: 'cpu',
      headerName: 'CPU %',
      width: 72,
      type: 'number',
      renderCell: (params) => {
        const v = params.value as number | null
        const color = v != null && v > 80 ? tokens.color.danger : v != null && v > 60 ? tokens.color.warning : tokens.color.accent
        return (
          <Typography sx={{ fontSize: tokens.font.sizeSm, color, fontVariantNumeric: 'tabular-nums' }}>
            {v != null ? `${v}%` : '—'}
          </Typography>
        )
      }
    },
    {
      field: 'ramGb',
      headerName: 'RAM GB',
      width: 80,
      renderCell: (params) => (
        <Typography sx={{ fontSize: tokens.font.sizeSm, color: tokens.color.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
          {params.value != null ? `${params.value as string}` : '—'}
        </Typography>
      )
    },
    {
      field: 'blocking',
      headerName: 'Blocking',
      width: 80,
      type: 'number',
      renderCell: (params) => {
        const v = params.value as number
        return (
          <Typography sx={{ fontSize: tokens.font.sizeSm, color: v > 0 ? tokens.color.danger : tokens.color.textMuted, fontVariantNumeric: 'tabular-nums' }}>
            {v}
          </Typography>
        )
      }
    },
    {
      field: 'dbOffline',
      headerName: 'DB Offline',
      width: 90,
      type: 'number',
      renderCell: (params) => {
        const v = params.value as number
        return (
          <Typography sx={{ fontSize: tokens.font.sizeSm, color: v > 0 ? tokens.color.danger : tokens.color.textMuted, fontVariantNumeric: 'tabular-nums' }}>
            {v}
          </Typography>
        )
      }
    },
    {
      field: 'alertCount',
      headerName: 'Alerts',
      width: 68,
      type: 'number',
      renderCell: (params) => {
        const v = params.value as number
        return (
          <Typography sx={{ fontSize: tokens.font.sizeSm, color: v > 0 ? tokens.color.warning : tokens.color.textMuted, fontVariantNumeric: 'tabular-nums' }}>
            {v > 0 ? v : '—'}
          </Typography>
        )
      }
    },
    {
      field: 'lastSeen',
      headerName: 'Last seen',
      flex: 1,
      renderCell: (params) => {
        const d = params.value as Date | null
        if (!d) return <Typography sx={{ fontSize: tokens.font.sizeSm, color: tokens.color.textMuted }}>—</Typography>
        const minAgo = Math.floor((Date.now() - d.getTime()) / 60_000)
        const label = minAgo < 2 ? 'just now' : `${minAgo}m ago`
        const color = minAgo < 5 ? tokens.color.success : minAgo < 15 ? tokens.color.textMuted : tokens.color.danger
        return <Typography sx={{ fontSize: tokens.font.sizeSm, color, fontVariantNumeric: 'tabular-nums' }}>{label}</Typography>
      }
    }
  ]

  if (servers.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
        <Typography sx={{ color: tokens.color.textMuted, fontSize: tokens.font.sizeLg }}>No monitored servers</Typography>
        <Typography
          onClick={onNavigateToDiscovery}
          sx={{ color: tokens.color.accent, fontSize: tokens.font.sizeSm, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
        >
          → Go to Discovery to add servers
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 2, gap: 2 }}>
      {/* KPI row */}
      <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
        <KpiCard label="Total" value={servers.length} color={tokens.color.textPrimary} />
        <KpiCard label="Critical" value={criticalCount} color={criticalCount > 0 ? tokens.color.danger : tokens.color.textMuted} />
        <KpiCard label="Warning" value={warningCount} color={warningCount > 0 ? tokens.color.warning : tokens.color.textMuted} />
        <KpiCard label="Offline" value={offlineCount} color={offlineCount > 0 ? tokens.color.danger : tokens.color.textMuted} />
        <KpiCard label="Online" value={onlineCount} color={tokens.color.success} />
      </Box>

      {/* Dense server table */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          rowHeight={32}
          columnHeaderHeight={36}
          disableRowSelectionOnClick={false}
          hideFooter={rows.length <= 100}
          onRowClick={(params: GridRowParams) => {
            const serverId = params.row.serverId as string
            setSelectedServerId(serverId)
            onNavigateToServer(serverId)
          }}
          initialState={{
            sorting: {
              sortModel: [{ field: 'serverName', sort: 'asc' }]
            }
          }}
          sx={{ height: '100%', border: `1px solid ${tokens.color.bgBorder}` }}
        />
      </Box>
    </Box>
  )
}
```

- [ ] **Verify `useHomeDashboard` exports the fields used** (`metricsMap`, `summaries`, `alertCountByServer`, `criticalCount`, `warningCount`, `onlineCount`, `offlineCount`)

```bash
grep "return {" src/renderer/src/components/features/home/useHomeDashboard.ts
```

If any field is missing from the hook's return, read the hook file and use the correct field names.

- [ ] **Typecheck**

```bash
npm run typecheck 2>&1 | grep "HomeDashboard" | head -20
```

- [ ] **Commit**

```bash
git add src/renderer/src/components/HomeDashboard.tsx
git commit -m "feat(ui): HomeDashboard — 4 KPI cards + MUI X DataGrid (32px rows, 200-server scale)"
```

---

## Task 12: Re-skin `AlertsDrawer.tsx` and `AIPanel.tsx`

**Files:**
- Modify: `src/renderer/src/components/AlertsDrawer.tsx`
- Modify: `src/renderer/src/components/ai/AIPanel.tsx`

Token-only changes — replace old `tokens.color.*` references with new ones. No structural changes.

- [ ] **Update `AlertsDrawer.tsx`** — find all old token references and replace:

| Old | New |
|---|---|
| `tokens.color.error` | `tokens.color.danger` |
| `tokens.color.warning` | `tokens.color.warning` (unchanged key) |
| `tokens.color.bgSidebar` | `tokens.color.bgSurface` |
| `tokens.color.textSecondary` | `tokens.color.textMuted` |
| `tokens.color.primary` | `tokens.color.accent` |
| Any hardcoded `#0078d4` | `tokens.color.accent` |

- [ ] **Find all AIPanel token references**

```bash
grep -n "tokens\." src/renderer/src/components/ai/AIPanel.tsx | head -30
```

Replace with equivalent new token names using the same mapping as above.

- [ ] **Typecheck**

```bash
npm run typecheck 2>&1 | grep -E "AlertsDrawer|AIPanel" | head -20
```

- [ ] **Commit**

```bash
git add src/renderer/src/components/AlertsDrawer.tsx src/renderer/src/components/ai/AIPanel.tsx
git commit -m "feat(ui): re-skin AlertsDrawer and AIPanel with Dark Pro tokens"
```

---

## Task 13: Fix remaining token references and delete `Sidebar.tsx`

**Files:**
- Modify: any files still referencing removed/renamed tokens
- Delete: `src/renderer/src/components/Sidebar.tsx`

- [ ] **Find all remaining old token references across the renderer**

```bash
grep -rn "tokens\.color\.primary\b\|tokens\.color\.bgApp\|tokens\.color\.bgCard\|tokens\.color\.textSecondary\|tokens\.color\.bgSidebar\b" src/renderer/src --include="*.tsx" --include="*.ts" | grep -v "node_modules"
```

For each hit, replace with the correct new token:

| Old | New |
|---|---|
| `tokens.color.primary` | `tokens.color.accent` |
| `tokens.color.primaryDark` | `'#00b896'` |
| `tokens.color.bgApp` | `tokens.color.bgBase` |
| `tokens.color.bgCard` | `tokens.color.bgSurface` |
| `tokens.color.bgSidebar` | `tokens.color.bgSurface` |
| `tokens.color.textSecondary` | `tokens.color.textMuted` |
| `tokens.color.textPrimary` | `tokens.color.textPrimary` (unchanged) |
| `tokens.color.success` | `tokens.color.success` (unchanged) |
| `tokens.color.error` | `tokens.color.danger` |
| `tokens.color.dotOnline` | `tokens.color.dotOnline` (unchanged) |
| `tokens.color.navbarHeight` → `tokens.size.navbarHeight` | no longer needed — remove usages |
| `tokens.size.sidebarWidth` | `tokens.size.serverTreeWidth` |

- [ ] **Delete Sidebar.tsx** (only after Dashboard.tsx no longer imports it)

```bash
grep -rn "from.*Sidebar" src/renderer/src --include="*.tsx" --include="*.ts"
```

Confirm zero imports, then delete:

```bash
rm src/renderer/src/components/Sidebar.tsx
```

- [ ] **Final typecheck — must be clean**

```bash
npm run typecheck
```

Expected: 0 errors (excluding the pre-existing test file errors noted in Task 1).

- [ ] **Commit**

```bash
git add -A
git commit -m "feat(ui): fix remaining token refs, remove Sidebar.tsx — Dark Pro complete"
```

---

## Task 14: Smoke test in dev mode

- [ ] **Start the dev server**

```bash
npm run dev
```

- [ ] **Verify visually** (checklist):

- [ ] App loads, login page has dark background `#0d1117`
- [ ] After login: 48px icon rail on left, `SS` logo in teal
- [ ] Breadcrumb bar 28px below rail, no top AppBar
- [ ] Clicking Discovery/Inventory/Dashboard icons switches content
- [ ] Server Tree appears on Inventory and Dashboard tabs, hidden on others
- [ ] Server Tree search filters the list live
- [ ] Severity filter pills (All/Critical/Warning/Offline) filter the list
- [ ] HomeDashboard (tab 0) shows 4 KPI cards + DataGrid table
- [ ] Clicking a DataGrid row navigates to Dashboard tab with that server
- [ ] Font is Inter (check in DevTools → computed → font-family)
- [ ] No gradients on any surface
- [ ] If a critical alert exists: `SS` logo turns red, breadcrumb badge shows red count

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat(ui): Dark Pro UI modernization complete — Inter font, icon rail, teal/red accent"
```
