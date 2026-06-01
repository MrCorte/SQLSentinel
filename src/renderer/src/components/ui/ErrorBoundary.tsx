import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  label?: string
}

interface State {
  error: Error | null
  retries: number
}

const MAX_RETRIES = 3

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retries: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.label ?? 'unknown'}]`, error, info.componentStack)
  }

  private reset = (): void => {
    this.setState((s) => ({ error: null, retries: s.retries + 1 }))
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    // fallback={null} callers (AIPanel, AlertsDrawer) accept silent failure
    if (this.props.fallback !== undefined) return this.props.fallback

    const exhausted = this.state.retries >= MAX_RETRIES

    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 2,
          p: 4,
          color: 'text.secondary'
        }}
      >
        <Typography variant="h6" color="error">
          Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}
        </Typography>
        <Typography variant="body2" sx={{ maxWidth: 420, textAlign: 'center', opacity: 0.7 }}>
          {this.state.error.message}
        </Typography>
        {!exhausted && (
          <Button variant="outlined" size="small" onClick={this.reset}>
            Try again ({MAX_RETRIES - this.state.retries} left)
          </Button>
        )}
        {exhausted && (
          <Typography variant="caption" color="error">
            Reload the application to recover.
          </Typography>
        )}
      </Box>
    )
  }
}
