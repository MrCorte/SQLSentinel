// Azure Portal design tokens — single source of truth for all UI constants

export const tokens = {
  color: {
    // Brand / primary
    primary: '#0078d4',
    primaryDark: '#005a9e',
    primaryHover: '#106ebe',

    // Brand alpha accents (for gradients and tinted backgrounds)
    primaryAlpha12: 'rgba(0,120,212,0.12)',
    primaryAlpha20: 'rgba(0,120,212,0.20)',
    successAlpha12: 'rgba(16,124,16,0.12)',
    errorAlpha12: 'rgba(164,38,44,0.12)',
    warningAlpha12: 'rgba(216,59,1,0.12)',

    // Semantic
    success: '#107c10',
    successLight: '#dff6dd',
    warning: '#d83b01',
    warningLight: '#fed9cc',
    error: '#a4262c',
    errorLight: '#fde7e9',
    info: '#0078d4',
    infoLight: '#deecf9',

    // Backgrounds
    bgApp: '#f3f2f1',
    bgCard: '#ffffff',
    bgSidebar: '#1b1b1b',
    bgSidebarHover: '#2d2d2d',
    bgSidebarSelected: '#0078d4',

    // Borders / dividers
    border: '#edebe9',
    divider: '#e1dfdd',
    dividerDark: 'rgba(255,255,255,0.12)',

    // Text
    textPrimary: '#323130',
    textSecondary: '#605e5c',
    textDisabled: '#a19f9d',
    textOnDark: '#ffffff',
    textOnDarkSecondary: 'rgba(255,255,255,0.6)',

    // Chart
    chartCpu: '#0078d4',
    chartMemory: '#107c10',
    chartGrid: 'rgba(0,0,0,0.08)',

    // Status dots
    dotOnline: '#107c10',
    dotOffline: '#a4262c',
    dotUnknown: '#605e5c',

    // Gradient accents
    primaryGradient: 'linear-gradient(90deg, #0078d4, #60a5fa)',
    successGradient: 'linear-gradient(90deg, #107c10, #4ade80)',
    warningGradient: 'linear-gradient(90deg, #d83b01, #fb923c)',
    errorGradient:   'linear-gradient(90deg, #a4262c, #f87171)',

    // Dark card border
    borderDark: 'rgba(255,255,255,0.08)',
  },

  size: {
    navbarHeight: 48,
    sidebarWidth: 220,
    alertsDrawerWidth: 380,
  },

  font: {
    family: "'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    sizeXs: 11,
    sizeSm: 12,
    sizeBase: 13,
    sizeMd: 14,
    sizeLg: 16,
    sizeXl: 20,
    weightRegular: 400,
    weightSemibold: 600,
    weightBold: 700,
  },

  radius: {
    none: 0,
    sm: 6,
    md: 10,
    lg: 16,
    pill: 9999,
  },

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
}
