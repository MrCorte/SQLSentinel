import { useState } from 'react'
import { TextField, IconButton, InputAdornment } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import type { TextFieldProps } from '@mui/material'

/**
 * Drop-in replacement for `<TextField type="password">` with a built-in
 * visibility toggle. Use this everywhere a password field is rendered so the
 * affordance is consistent and the toggle button always carries an aria-label.
 *
 * Forwards all props to the underlying TextField except `type` (locked) and
 * `InputProps.endAdornment` (overridden by the toggle).
 */
export function PasswordField(props: Omit<TextFieldProps, 'type'>): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const { InputProps, ...rest } = props

  return (
    <TextField
      {...rest}
      type={visible ? 'text' : 'password'}
      InputProps={{
        ...InputProps,
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              size="small"
              onClick={() => setVisible((v) => !v)}
              edge="end"
              tabIndex={-1}
              aria-label={visible ? 'Hide password' : 'Show password'}
            >
              {visible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
            </IconButton>
          </InputAdornment>
        )
      }}
    />
  )
}
