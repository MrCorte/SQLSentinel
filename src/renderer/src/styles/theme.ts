import { createTheme, type Theme } from '@mui/material/styles'
import { tokens } from './tokens'

export function buildTheme(mode: 'light' | 'dark'): Theme {
  const isDark = mode === 'dark'

  return createTheme({
    palette: {
      mode,
      primary: {
        main: tokens.color.primary,
        dark: tokens.color.primaryDark,
      },
      success: { main: tokens.color.success },
      warning: { main: tokens.color.warning },
      error: { main: tokens.color.error },
      background: isDark
        ? { default: '#0f172a', paper: '#1e293b' }
        : { default: tokens.color.bgApp, paper: tokens.color.bgCard },
      text: isDark
        ? { primary: '#f1f5f9', secondary: '#94a3b8', disabled: '#475569' }
        : {
            primary: tokens.color.textPrimary,
            secondary: tokens.color.textSecondary,
            disabled: tokens.color.textDisabled,
          },
      divider: isDark ? '#334155' : tokens.color.divider,
    },

    typography: {
      fontFamily: tokens.font.family,
      fontSize: tokens.font.sizeBase,
      h6: { fontSize: tokens.font.sizeLg, fontWeight: tokens.font.weightSemibold },
      subtitle1: { fontSize: tokens.font.sizeMd, fontWeight: tokens.font.weightSemibold },
      subtitle2: { fontSize: tokens.font.sizeBase, fontWeight: tokens.font.weightSemibold },
      body1: { fontSize: tokens.font.sizeBase },
      body2: { fontSize: tokens.font.sizeSm },
      caption: {
        fontSize: tokens.font.sizeXs,
        color: isDark ? '#94a3b8' : tokens.color.textSecondary,
      },
      button: {
        fontSize: tokens.font.sizeBase,
        fontWeight: tokens.font.weightSemibold,
        textTransform: 'none' as const,
      },
    },

    shape: { borderRadius: tokens.radius.sm },

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: isDark ? '#0f172a' : tokens.color.bgApp,
            color: isDark ? '#f1f5f9' : tokens.color.textPrimary,
            fontFamily: tokens.font.family,
          },
          // Scrollbar colours switch with the theme
          '::-webkit-scrollbar': { width: 6, height: 6 },
          '::-webkit-scrollbar-track': { background: 'transparent' },
          '::-webkit-scrollbar-thumb': {
            background: isDark ? '#334155' : '#c8c6c4',
            borderRadius: 3,
            '&:hover': { background: isDark ? '#475569' : '#8a8886' },
          },
        },
      },

      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none', borderRadius: tokens.radius.sm },
          elevation0: {
            ...(isDark && { border: `1px solid ${tokens.color.borderDark}` }),
          },
          elevation1: {
            boxShadow: tokens.shadow.card,
            ...(isDark && { border: `1px solid ${tokens.color.borderDark}` }),
          },
          elevation2: { boxShadow: tokens.shadow.elevated },
          elevation3: { boxShadow: tokens.shadow.cardHover },
        },
      },

      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.sm,
            textTransform: 'none',
            fontWeight: tokens.font.weightSemibold,
            fontSize: tokens.font.sizeBase,
            transition: 'all 0.15s ease',
          },
          contained: {
            boxShadow: '0 2px 8px rgba(0,120,212,0.25)',
            '&:hover': {
              boxShadow: '0 4px 14px rgba(0,120,212,0.35)',
              backgroundColor: tokens.color.primaryHover,
              transform: 'translateY(-1px)',
            },
            '&:active': { transform: 'translateY(0)', boxShadow: '0 1px 4px rgba(0,120,212,0.2)' },
          },
          outlined: {
            '&:hover': { backgroundColor: tokens.color.primaryAlpha12 },
          },
        },
      },

      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: tokens.font.weightSemibold,
            fontSize: tokens.font.sizeBase,
            minHeight: tokens.size.navbarHeight,
            padding: '0 16px',
          },
        },
      },

      MuiTabs: {
        styleOverrides: { indicator: { height: 3, borderRadius: '3px 3px 0 0' } },
      },

      MuiTableCell: {
        styleOverrides: {
          head: {
            fontSize: tokens.font.sizeXs,
            fontWeight: tokens.font.weightSemibold,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            backgroundColor: isDark ? '#0f1f3d' : tokens.color.bgApp,
            color: isDark ? '#94a3b8' : tokens.color.textSecondary,
            borderBottom: `2px solid ${tokens.color.primary}`,
          },
          body: { fontSize: tokens.font.sizeSm },
        },
      },

      MuiListItemButton: {
        // Sidebar is intentionally always dark regardless of theme mode
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.sm,
            margin: '1px 8px',
            width: 'calc(100% - 16px)',
            transition: 'all 0.15s ease',
            '&.Mui-selected': {
              backgroundColor: tokens.color.bgSidebarSelected,
              color: tokens.color.textOnDark,
              boxShadow: `inset 3px 0 0 rgba(255,255,255,0.6), 0 2px 8px rgba(0,120,212,0.4)`,
              '&:hover': { backgroundColor: tokens.color.primaryHover },
            },
            '&:hover': { backgroundColor: tokens.color.bgSidebarHover },
          },
        },
      },

      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.pill,
            fontWeight: tokens.font.weightSemibold,
            fontSize: tokens.font.sizeXs,
            height: 20,
          },
          filled: {
            ...(isDark && { border: `1px solid ${tokens.color.dividerDark}` }),
          },
        },
      },

      MuiDrawer: {
        styleOverrides: { paper: { boxShadow: tokens.shadow.drawer } },
      },

      MuiDivider: {
        styleOverrides: {
          root: { borderColor: isDark ? '#334155' : tokens.color.divider },
        },
      },

      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.sm,
            transition: 'all 0.15s ease',
            '&:hover': { transform: 'scale(1.08)' },
          },
        },
      },

      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: tokens.radius.sm,
            fontSize: tokens.font.sizeSm,
            boxShadow: tokens.shadow.elevated,
          },
        },
      },
    },
  })
}

