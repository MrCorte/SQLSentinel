// Dark Pro design tokens — single source of truth for all UI constants

// Actual hex values per mode — injected as CSS custom properties by the theme provider.
// Components use tokens.color.bg*/text* which reference the CSS vars and auto-switch.
export const darkValues = {
  bgBase: '#0d1117',
  bgSurface: '#161b22',
  bgBorder: '#30363d',
  textPrimary: '#e6edf3',
  textMuted: '#8b949e',
} as const

export const lightValues = {
  bgBase: '#ffffff',
  bgSurface: '#f6f8fa',
  bgBorder: '#d0d7de',
  textPrimary: '#1f2328',
  textMuted: '#636c76',
} as const

export interface ThemePalette {
  bgBase: string
  bgSurface: string
  bgBorder: string
  textPrimary: string
  textMuted: string
}

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

    // Adaptive surfaces — resolved via CSS custom properties injected by App
    bgBase: 'var(--t-bg-base)',
    bgSurface: 'var(--t-bg-surface)',
    bgBorder: 'var(--t-bg-border)',

    // Adaptive text — resolved via CSS custom properties injected by App
    textPrimary: 'var(--t-text-primary)',
    textMuted: 'var(--t-text-muted)',
    textOnAccent: '#0d1117',

    // Sidebar selection / hover
    bgSidebarSelected: '#1f6feb',
    bgSidebarHover: 'rgba(255,255,255,0.06)',
    primary: '#1f6feb',
    primaryHover: '#388bfd',

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
    drawer: '0 8px 32px rgba(0,0,0,0.5)',
    dotGlowSuccess: '0 0 4px rgba(63,185,80,0.8)',
    dotGlowWarning: '0 0 4px rgba(210,153,34,0.8)',
    dotGlowError: '0 0 4px rgba(247,129,102,0.8)'
  }
}
