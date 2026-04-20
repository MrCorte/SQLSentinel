# UI Dark Accent Restyling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the "B · Dark Accent" visual direction across the whole app — glow on status dots, accent borders on KPI cards, refined MUI theme overrides — for both light and dark mode.

**Architecture:** All changes are style-only: design tokens → MUI theme cascade → targeted `sx` patches in 4 component files. No structural JSX changes, no new components.

**Tech Stack:** React 19, MUI v5, Emotion, TypeScript strict, Electron renderer

---

## File Map

| File | What changes |
|------|--------------|
| `src/renderer/src/styles/tokens.ts` | Add gradient strings, glow shadow tokens, `borderDark` |
| `src/renderer/src/styles/theme.ts` | MuiPaper border, MuiChip border, MuiTableCell head color, MuiListItemButton inset shadow |
| `src/renderer/src/components/Sidebar.tsx` | `StatusDot` — add `boxShadow` glow |
| `src/renderer/src/components/MetricsPanel.tsx` | `KpiCard` — accent-tinted `borderColor` in dark mode |
| `src/renderer/src/components/HomeDashboard.tsx` | Legend dots — add `boxShadow` glow |
| `src/renderer/src/components/AgDashboard.tsx` | `ReplicaCard` PRIMARY — extend `boxShadow` with glow outline |

---

## Task 1 — Add design tokens

**Files:**
- Modify: `src/renderer/src/styles/tokens.ts`

- [ ] **Step 1: Add gradient + borderDark tokens to `tokens.color`**

In `tokens.ts`, after the `// Status dots` block (lines 51-54), add:

```typescript
    // Gradient accents
    primaryGradient: 'linear-gradient(90deg, #0078d4, #60a5fa)',
    successGradient: 'linear-gradient(90deg, #107c10, #4ade80)',
    warningGradient: 'linear-gradient(90deg, #d83b01, #fb923c)',
    errorGradient:   'linear-gradient(90deg, #a4262c, #f87171)',

    // Dark card border
    borderDark: 'rgba(255,255,255,0.08)',
```

- [ ] **Step 2: Add glow shadow tokens to `tokens.shadow`**

In `tokens.ts`, inside the `shadow` object (currently lines 84-90), add after `drawer`:

```typescript
    dotGlowSuccess: '0 0 6px rgba(78,255,145,0.7)',
    dotGlowError:   '0 0 6px rgba(239,68,68,0.6)',
    dotGlowWarning: '0 0 6px rgba(216,59,1,0.6)',
```

The full `shadow` block becomes:
```typescript
  shadow: {
    card: '0 1px 4px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06)',
    cardHover: '0 4px 16px rgba(0,0,0,0.14), 0 8px 24px rgba(0,0,0,0.08)',
    elevated: '0 2px 8px rgba(0,0,0,0.1), 0 8px 20px rgba(0,0,0,0.08)',
    navbar: '0 2px 8px rgba(0,0,0,0.2)',
    drawer: '0 8px 32px rgba(0,0,0,0.2)',
    dotGlowSuccess: '0 0 6px rgba(78,255,145,0.7)',
    dotGlowError:   '0 0 6px rgba(239,68,68,0.6)',
    dotGlowWarning: '0 0 6px rgba(216,59,1,0.6)',
  },
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles/tokens.ts
git commit -m "feat(ui): add Dark Accent design tokens — gradients, glow shadows, borderDark"
```

---

## Task 2 — MUI theme overrides

**Files:**
- Modify: `src/renderer/src/styles/theme.ts`

- [ ] **Step 1: MuiPaper — add subtle border in dark mode**

Find the `MuiPaper` override (currently lines 70-77):
```typescript
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none', borderRadius: tokens.radius.sm },
```

Change `root` to:
```typescript
          root: {
            backgroundImage: 'none',
            borderRadius: tokens.radius.sm,
            ...(isDark && { border: `1px solid ${tokens.color.borderDark}` }),
          },
```

- [ ] **Step 2: MuiChip — add subtle border in dark mode**

Find the `MuiChip` override (currently lines 153-162):
```typescript
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.pill,
            fontWeight: tokens.font.weightSemibold,
            fontSize: tokens.font.sizeXs,
            height: 20,
          },
        },
      },
```

Change to:
```typescript
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.pill,
            fontWeight: tokens.font.weightSemibold,
            fontSize: tokens.font.sizeXs,
            height: 20,
            ...(isDark && { border: '1px solid rgba(255,255,255,0.12)' }),
          },
        },
      },
```

- [ ] **Step 3: MuiTableCell head — deeper background in dark mode**

Find line:
```typescript
            backgroundColor: isDark ? '#1a2744' : tokens.color.bgApp,
```

Change to:
```typescript
            backgroundColor: isDark ? '#0f1f3d' : tokens.color.bgApp,
```

- [ ] **Step 4: MuiListItemButton selected — inset left accent via boxShadow**

Find the `'&.Mui-selected'` block (currently lines 142-147):
```typescript
            '&.Mui-selected': {
              backgroundColor: tokens.color.bgSidebarSelected,
              color: tokens.color.textOnDark,
              boxShadow: '0 2px 8px rgba(0,120,212,0.4)',
              '&:hover': { backgroundColor: tokens.color.primaryHover },
            },
```

Change `boxShadow` to combine the existing drop shadow with an inset left accent:
```typescript
            '&.Mui-selected': {
              backgroundColor: tokens.color.bgSidebarSelected,
              color: tokens.color.textOnDark,
              boxShadow: `inset 3px 0 0 rgba(255,255,255,0.6), 0 2px 8px rgba(0,120,212,0.4)`,
              '&:hover': { backgroundColor: tokens.color.primaryHover },
            },
```

*(Using `inset` box-shadow avoids any layout shift — no padding adjustment needed.)*

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/styles/theme.ts
git commit -m "feat(ui): Dark Accent MUI theme overrides — Paper border, Chip border, TableCell head, sidebar accent"
```

---

## Task 3 — StatusDot glow (Sidebar)

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx` lines ~86-102

- [ ] **Step 1: Add boxShadow to StatusDot**

Find the `StatusDot` function (lines ~86-102):
```typescript
function StatusDot({ unreachable }: { unreachable?: boolean }): React.JSX.Element {
  const color = unreachable ? tokens.color.dotOffline : tokens.color.dotOnline
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: color,
        flexShrink: 0,
        animation: unreachable ? `${pulseAnim} 1.5s ease-in-out infinite` : 'none'
      }}
    />
  )
}
```

Add `boxShadow` property:
```typescript
function StatusDot({ unreachable }: { unreachable?: boolean }): React.JSX.Element {
  const color = unreachable ? tokens.color.dotOffline : tokens.color.dotOnline
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: color,
        flexShrink: 0,
        boxShadow: unreachable ? tokens.shadow.dotGlowError : tokens.shadow.dotGlowSuccess,
        animation: unreachable ? `${pulseAnim} 1.5s ease-in-out infinite` : 'none'
      }}
    />
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx
git commit -m "feat(ui): add glow shadow to StatusDot in sidebar"
```

---

## Task 4 — KpiCard accent border in dark mode (MetricsPanel)

**Files:**
- Modify: `src/renderer/src/components/MetricsPanel.tsx` lines ~60-82

- [ ] **Step 1: Change borderColor to accent-tinted in dark mode**

Find in `KpiCard`'s `sx` object:
```typescript
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: `4px solid ${accent}`,
```

Change `borderColor` to a theme callback:
```typescript
        border: '1px solid',
        borderColor: (theme) =>
          theme.palette.mode === 'dark' ? `${accent}33` : theme.palette.divider,
        borderLeft: `4px solid ${accent}`,
```

*(`${accent}33` appends hex `33` = 20% opacity to the accent hex color, e.g. `#0078d433`. This works because all accent values are 6-digit hex strings.)*

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/MetricsPanel.tsx
git commit -m "feat(ui): KpiCard accent-tinted border in dark mode"
```

---

## Task 5 — Legend dots glow (HomeDashboard)

**Files:**
- Modify: `src/renderer/src/components/HomeDashboard.tsx` lines ~723-732

- [ ] **Step 1: Add boxShadow to legend dots**

Find the legend dot `Box` (lines ~723-732):
```typescript
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: item.color,
                    flexShrink: 0
                  }}
                />
```

Add `boxShadow`:
```typescript
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: item.color,
                    flexShrink: 0,
                    boxShadow: item.label === 'Online'
                      ? tokens.shadow.dotGlowSuccess
                      : item.label === 'Non raggiungibili'
                        ? tokens.shadow.dotGlowWarning
                        : tokens.shadow.dotGlowError,
                  }}
                />
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/HomeDashboard.tsx
git commit -m "feat(ui): add glow shadow to legend status dots in HomeDashboard"
```

---

## Task 6 — ReplicaCard PRIMARY glow outline (AgDashboard)

**Files:**
- Modify: `src/renderer/src/components/AgDashboard.tsx` lines ~73-86

- [ ] **Step 1: Extend boxShadow on PRIMARY card**

Find in `ReplicaCard`'s `sx` object:
```typescript
          boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.15)' : tokens.shadow.card,
```

Change to a three-way expression:
```typescript
          boxShadow: hovered
            ? '0 4px 12px rgba(0,0,0,0.15)'
            : isPrimary
              ? `${tokens.shadow.card}, 0 0 0 1px rgba(0,120,212,0.25)`
              : tokens.shadow.card,
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AgDashboard.tsx
git commit -m "feat(ui): add glow outline to PRIMARY ReplicaCard in AgDashboard"
```

---

## Task 7 — Final verification

- [ ] **Step 1: Full typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Visual spot-check checklist**

Start `npm run dev` and verify:

**Dark mode:**
- [ ] Paper panels have a subtle `rgba(255,255,255,0.08)` border
- [ ] Chips (HEALTHY, SYNCHRONIZED, PRIMARY, etc.) have a faint white border
- [ ] DataGrid table headers are darker (`#0f1f3d`)
- [ ] Selected sidebar item has a white inset left stripe
- [ ] StatusDot (online) glows green; StatusDot (offline) glows red
- [ ] KpiCard borders are tinted with their accent color (blue/green/orange/red at ~20%)
- [ ] HomeDashboard legend dots glow green/orange/red
- [ ] AG Dashboard PRIMARY card has a blue glow outline ring

**Light mode:**
- [ ] Paper panels have no border (dark-only override)
- [ ] Chips have no border (dark-only override)
- [ ] KpiCard borders remain `divider` gray (unchanged)
- [ ] StatusDot glows still visible (glow is subtle but present on light bg)
- [ ] HomeDashboard legend dots glow
- [ ] AG Dashboard PRIMARY card glow outline still visible
