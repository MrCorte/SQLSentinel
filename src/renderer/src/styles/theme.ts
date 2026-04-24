import { createTheme, alpha, type Theme } from '@mui/material/styles'
import '@mui/x-data-grid/themeAugmentation'
import { tokens } from './tokens'
import type { ThemePalette } from './tokens'

export function buildTheme(mode: 'light' | 'dark', palette: ThemePalette): Theme {
  return createTheme({
    palette: {
      mode,
      primary: { main: tokens.color.accent },
      success: { main: tokens.color.success },
      warning: { main: tokens.color.warning },
      error: { main: tokens.color.danger },
      background: {
        default: palette.bgBase,
        paper: palette.bgSurface
      },
      text: {
        primary: palette.textPrimary,
        secondary: palette.textMuted,
        disabled: palette.textMuted
      },
      divider: palette.bgBorder
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
              '&:hover': { backgroundColor: alpha(palette.bgSurface, mode === 'dark' ? 0.8 : 0.06) }
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
            '&:hover': { backgroundColor: alpha(palette.bgSurface, mode === 'dark' ? 0.67 : 0.06) }
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
