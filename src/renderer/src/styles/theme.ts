import { createTheme } from '@mui/material/styles'
import { tokens } from './tokens'

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: tokens.color.primary,
      dark: tokens.color.primaryDark,
    },
    success: {
      main: tokens.color.success,
    },
    warning: {
      main: tokens.color.warning,
    },
    error: {
      main: tokens.color.error,
    },
    background: {
      default: tokens.color.bgApp,
      paper: tokens.color.bgCard,
    },
    text: {
      primary: tokens.color.textPrimary,
      secondary: tokens.color.textSecondary,
      disabled: tokens.color.textDisabled,
    },
    divider: tokens.color.divider,
  },

  typography: {
    fontFamily: tokens.font.family,
    fontSize: tokens.font.sizeBase,
    h6: {
      fontSize: tokens.font.sizeLg,
      fontWeight: tokens.font.weightSemibold,
    },
    subtitle1: {
      fontSize: tokens.font.sizeMd,
      fontWeight: tokens.font.weightSemibold,
    },
    subtitle2: {
      fontSize: tokens.font.sizeBase,
      fontWeight: tokens.font.weightSemibold,
    },
    body1: {
      fontSize: tokens.font.sizeBase,
    },
    body2: {
      fontSize: tokens.font.sizeSm,
    },
    caption: {
      fontSize: tokens.font.sizeXs,
      color: tokens.color.textSecondary,
    },
    button: {
      fontSize: tokens.font.sizeBase,
      fontWeight: tokens.font.weightSemibold,
      textTransform: 'none' as const,
    },
  },

  shape: {
    borderRadius: tokens.radius.sm,
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: tokens.color.bgApp,
          color: tokens.color.textPrimary,
          fontFamily: tokens.font.family,
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderRadius: tokens.radius.sm,
        },
        elevation1: {
          boxShadow: tokens.shadow.card,
        },
      },
    },

    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.sm,
          textTransform: 'none',
          fontWeight: tokens.font.weightSemibold,
          fontSize: tokens.font.sizeBase,
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
            backgroundColor: tokens.color.primaryHover,
          },
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
      styleOverrides: {
        indicator: {
          height: 2,
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        head: {
          fontSize: tokens.font.sizeXs,
          fontWeight: tokens.font.weightSemibold,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          backgroundColor: tokens.color.bgApp,
          color: tokens.color.textSecondary,
          borderBottom: `2px solid ${tokens.color.primary}`,
        },
        body: {
          fontSize: tokens.font.sizeSm,
        },
      },
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': {
            backgroundColor: tokens.color.bgSidebarSelected,
            color: tokens.color.textOnDark,
            '&:hover': {
              backgroundColor: tokens.color.primaryHover,
            },
          },
          '&:hover': {
            backgroundColor: tokens.color.bgSidebarHover,
          },
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.sm,
          fontWeight: tokens.font.weightSemibold,
          fontSize: tokens.font.sizeXs,
          height: 20,
        },
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: {
          boxShadow: tokens.shadow.drawer,
        },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: tokens.color.divider,
        },
      },
    },
  },
})
