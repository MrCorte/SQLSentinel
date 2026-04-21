import { useRef, useEffect, useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { tokens } from '../../styles/tokens'
import { useAiChatStore } from '../../store/aiChatStore'
import type { AiMessage } from '../../store/aiChatStore'
const PANEL_WIDTH = 420

const WELCOME_MESSAGE =
  "I'm the SQL Sentinel AI assistant.\n\nAsk me:\n• \"Why is CPU usage high?\"\n• \"Which servers have issues?\"\n• \"Critical alerts in the last 24h?\"\n• \"Analyze blocking sessions\""

interface AIPanelProps {
  open: boolean
  onClose: () => void
}

export function AIPanel({ open, onClose }: AIPanelProps): React.JSX.Element {
  const { messages, loading, addMessage, setLoading, clear } = useAiChatStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    const userMsg: AiMessage = { role: 'user', content: text, ts: Date.now() }
    addMessage(userMsg)
    setLoading(true)

    try {
      // Build history from store (last 6 messages for context window)
      const history = useAiChatStore
        .getState()
        .messages.slice(-6)
        .map((m) => ({ role: m.role, content: m.content }))

      const result = await window.sqlSentinel.aiAgentAsk(text, history)
      if (!mountedRef.current) return
      if (result.ok) {
        addMessage({ role: 'assistant', content: result.data, ts: Date.now() })
      } else {
        addMessage({
          role: 'assistant',
          content: `Error: ${result.error}\n\nMake sure Ollama is running:\n  ollama serve\n  ollama pull llama3.2:3b`,
          ts: Date.now()
        })
      }
    } catch {
      if (!mountedRef.current) return
      addMessage({
        role: 'assistant',
        content:
          'Connection to Ollama failed.\n\nMake sure it is running:\n  ollama serve\n  ollama pull llama3.2:3b',
        ts: Date.now()
      })
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [input, loading, addMessage, setLoading])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      PaperProps={{ sx: { width: PANEL_WIDTH, display: 'flex', flexDirection: 'column' } }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 0,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: tokens.color.primary,
          color: '#fff',
          flexShrink: 0
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <SmartToyIcon sx={{ fontSize: 20 }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: tokens.font.sizeMd, fontWeight: tokens.font.weightBold, lineHeight: 1.2 }}>
              AI DBA Assistant
            </Typography>
            <Typography sx={{ fontSize: tokens.font.sizeXs, opacity: 0.85 }}>
              llama3.2:3b · LangGraph agent · fully local
            </Typography>
          </Box>
          <Tooltip title="Clear history">
            <IconButton size="small" onClick={clear} sx={{ color: 'rgba(255,255,255,0.8)' }}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} sx={{ color: 'rgba(255,255,255,0.8)' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <>
        {/* Messages area */}
          <Box
            sx={{
              flex: 1,
              overflowY: 'auto',
              px: 2,
              py: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
              bgcolor: 'background.default'
            }}
          >
            {/* Welcome bubble */}
            <MessageBubble role="assistant" content={WELCOME_MESSAGE} />

            {messages.map((msg, i) => (
              <MessageBubble key={i} role={msg.role} content={msg.content} />
            ))}

            {loading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1 }}>
                <CircularProgress size={14} />
                <Typography sx={{ fontSize: tokens.font.sizeSm, color: 'text.secondary', fontStyle: 'italic' }}>
                  Agent is analyzing…
                </Typography>
              </Box>
            )}

            <div ref={bottomRef} />
          </Box>

          {/* Input area */}
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              flexShrink: 0
            }}
          >
            <TextField
              fullWidth
              multiline
              maxRows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask: 'servers with high CPU?' — Enter to send, Shift+Enter for new line"
              disabled={loading}
              size="small"
              sx={{ '& .MuiInputBase-input': { fontSize: tokens.font.sizeBase } }}
              slotProps={{
                input: {
                  endAdornment: (
                    <Button
                      onClick={sendMessage}
                      disabled={loading || !input.trim()}
                      variant="contained"
                      size="small"
                      sx={{ ml: 1, flexShrink: 0, alignSelf: 'flex-end', mb: 0.25 }}
                    >
                      Send
                    </Button>
                  )
                }
              }}
            />
          </Box>
      </>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Single chat bubble
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
}

function MessageBubble({ role, content }: MessageBubbleProps): React.JSX.Element {
  const isUser = role === 'user'
  return (
    <Box sx={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <Box
        sx={{
          maxWidth: '85%',
          px: 1.5,
          py: 1,
          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          bgcolor: isUser ? `${tokens.color.primary}18` : 'background.paper',
          border: isUser ? `1px solid ${tokens.color.primary}40` : '1px solid',
          borderColor: isUser ? 'transparent' : 'divider',
          boxShadow: isUser ? 'none' : tokens.shadow.card
        }}
      >
        <Typography
          component="pre"
          sx={{
            fontSize: tokens.font.sizeSm,
            fontFamily: 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            m: 0,
            color: 'text.primary'
          }}
        >
          {content}
        </Typography>
      </Box>
    </Box>
  )
}
