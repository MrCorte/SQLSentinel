# UI Restyling — Dark Accent Direction

**Date:** 2026-04-20
**Scope:** Visual polish, no structural JSX changes
**Theme coverage:** Both light and dark mode

---

## Goal

Rendere la UI di SQLSentinel più accattivante visivamente mantenendo la stessa struttura dei componenti.
La direzione scelta è **B · Dark Accent**: bordi colorati sui card, glow sui dot di stato, gradient accent.
Livello di cambiamento: **medio** — nuovi stili su componenti esistenti, nessun cambio di layout.

---

## 1. Design Tokens (`src/renderer/src/styles/tokens.ts`)

Aggiungere i seguenti token al file esistente, senza rimuovere nulla.

### Nuovi gradient strings (per accent e progress bar future)

```ts
// Gradient accents
primaryGradient: 'linear-gradient(90deg, #0078d4, #60a5fa)',
successGradient: 'linear-gradient(90deg, #107c10, #4ade80)',
warningGradient: 'linear-gradient(90deg, #d83b01, #fb923c)',
errorGradient:   'linear-gradient(90deg, #a4262c, #f87171)',
```

### Nuovi glow shadows (in `tokens.shadow`, per status dot)

```ts
dotGlowSuccess: '0 0 6px rgba(78,255,145,0.7)',
dotGlowError:   '0 0 6px rgba(239,68,68,0.6)',
dotGlowWarning: '0 0 6px rgba(216,59,1,0.6)',
```

### Nuovo token border dark (in `tokens.color`)

```ts
borderDark: 'rgba(255,255,255,0.08)',
```

---

## 2. MUI Theme (`src/renderer/src/styles/theme.ts`)

Modifiche agli `styleOverrides` esistenti. Nessun componente nuovo.

### MuiPaper (dark mode only)
Aggiungere bordo sottile per dare profondità ai panel:
```ts
// In MuiPaper.styleOverrides.root, condizionale su isDark:
...(isDark && { border: '1px solid rgba(255,255,255,0.08)' })
```

### MuiChip (dark mode only)
Chip semantici (health, sync state) con bordo accent più pronunciato:
```ts
// Aggiungere in MuiChip.styleOverrides.root:
...(isDark && { border: '1px solid rgba(255,255,255,0.12)' })
```

### MuiTableCell head (dark mode)
Sfondo header tabella più contrastato:
```ts
// Cambiare '#1a2744' → '#0f1f3d' per dark mode in MuiTableCell.head backgroundColor
```

### MuiListItemButton selected (sidebar)
Aggiungere `borderLeft` accent sulla voce attiva:
```ts
'&.Mui-selected': {
  // aggiungere a quelli esistenti:
  borderLeft: `3px solid ${tokens.color.primary}`,
  paddingLeft: '13px', // compensa il border per evitare layout shift
}
```

---

## 3. Component-level sx changes

### `src/renderer/src/components/Sidebar.tsx` — `StatusDot`

Aggiungere `boxShadow` dal token glow:

```tsx
sx={{
  // ...esistenti...
  boxShadow: unreachable ? tokens.shadow.dotGlowError : tokens.shadow.dotGlowSuccess,
}}
```

### `src/renderer/src/components/MetricsPanel.tsx` — `KpiCard`

In dark mode, il `borderColor: 'divider'` generico diventa un bordo tinted dall'accent:

```tsx
// Sostituire borderColor: 'divider' con:
borderColor: (theme) =>
  theme.palette.mode === 'dark'
    ? `${accent}33`   // accent a 20% opacità
    : theme.palette.divider,
```

Il `borderLeft: '4px solid ${accent}'` e il `backgroundImage` gradient esistenti rimangono invariati.

### `src/renderer/src/components/HomeDashboard.tsx` — legend dots

I dot della legenda stato server prendono glow coerente con StatusDot:

```tsx
// Aggiungere boxShadow condizionale al Box dot della legenda:
boxShadow: item.label === 'Online'
  ? tokens.shadow.dotGlowSuccess
  : item.label === 'Non raggiungibili'
    ? tokens.shadow.dotGlowWarning
    : tokens.shadow.dotGlowError,
```

### `src/renderer/src/components/AgDashboard.tsx` — `ReplicaCard` PRIMARY

Aggiungere glow outline al card PRIMARY per coerenza con la direzione B:

```tsx
// In ReplicaCard sx, aggiungere a border esistente:
boxShadow: isPrimary
  ? `${tokens.shadow.card}, 0 0 0 1px rgba(0,120,212,0.25)`
  : tokens.shadow.card,
```

---

## 4. File modificati

| File | Tipo di modifica |
|------|-----------------|
| `src/renderer/src/styles/tokens.ts` | Aggiunta token gradient + glow + borderDark |
| `src/renderer/src/styles/theme.ts` | Override MuiPaper, MuiChip, MuiTableCell, MuiListItemButton |
| `src/renderer/src/components/Sidebar.tsx` | `StatusDot` glow |
| `src/renderer/src/components/MetricsPanel.tsx` | `KpiCard` border dark mode |
| `src/renderer/src/components/HomeDashboard.tsx` | Legend dots glow |
| `src/renderer/src/components/AgDashboard.tsx` | `ReplicaCard` PRIMARY glow outline |

---

## 5. Vincoli

- Nessuna modifica alla struttura JSX dei componenti
- Nessun nuovo componente
- Compatibile con light e dark mode
- `npm run typecheck` deve passare senza errori dopo le modifiche

---

## 6. Verifica post-implementazione

1. `npm run typecheck` — zero errori TS
2. Visual check light mode: KpiCard borders visibili, dots con glow, sidebar item selezionato con borderLeft
3. Visual check dark mode: Paper con bordo sottile, chip con border, KpiCard con accent border, StatusDot con glow
4. AG Dashboard: ReplicaCard PRIMARY con glow outline
