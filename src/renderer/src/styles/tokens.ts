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
