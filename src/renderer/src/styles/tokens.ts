// Azure Portal design tokens — single source of truth for all UI constants

export const tokens = {
  color: {
    // Brand / primary
    primary: '#0078d4',
    primaryDark: '#005a9e',
    primaryHover: '#106ebe',

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
    sm: 2,
    md: 4,
  },

  shadow: {
    card: '0 1px 3px rgba(0,0,0,0.1)',
    navbar: '0 2px 4px rgba(0,0,0,0.08)',
    drawer: '0 4px 16px rgba(0,0,0,0.15)',
  },
}
