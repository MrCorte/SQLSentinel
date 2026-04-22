import { useRef, useEffect, useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import Accordion from '@mui/material/Accordion'
import AccordionSummary from '@mui/material/AccordionSummary'
import AccordionDetails from '@mui/material/AccordionDetails'
import Chip from '@mui/material/Chip'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import CancelIcon from '@mui/icons-material/Cancel'
import { tokens } from '../../styles/tokens'
import { useAiChatStore } from '../../store/aiChatStore'
import type { ToolStep } from '../../store/aiChatStore'

type AiStreamEvent = Parameters<Parameters<typeof window.sqlSentinel.onAiStreamEvent>[0]>[0]

const PANEL_WIDTH = 420

const WELCOME_MESSAGE =
  'I\'m the SQL Sentinel AI assistant.\n\nAsk me:\n• "Why is CPU usage high?"\n• "Which servers have issues?"\n• "Critical alerts in the last 24h?"\n• "Analyze blocking sessions"'

interface AIPanelProps {
  open: boolean
  onClose: () => void
}

export function AIPanel({ open, onClose }: AIPanelProps): React.JSX.Element {
  const {
    messages,
    loading,
    addMessage,
    setLoading,
    clear,
    streamingText,
    toolSteps,
    startStreaming,
    appendToken,
    addToolStep,
    completeToolStep,
    finalizeStreaming,
    resetStreaming
  } = useAiChatStore()
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
    addMessage({ role: 'user', content: text, ts: Date.now() })
    setLoading(true)
    startStreaming()

    const history = useAiChatStore
      .getState()
      .messages.slice(-6)
      .map((m) => ({ role: m.role, content: m.content }))

    const unsubscribe = window.sqlSentinel.onAiStreamEvent((ev: AiStreamEvent) => {
      if (!mountedRef.current) return
      if (ev.type === 'token') {
        appendToken(ev.text)
      } else if (ev.type === 'tool_start') {
        addToolStep(ev.name)
      } else if (ev.type === 'tool_end') {
        completeToolStep(ev.name, ev.output)
      } else if (ev.type === 'done') {
        unsubscribe()
        finalizeStreaming()
        if (mountedRef.current) setLoading(false)
      } else if (ev.type === 'error') {
        unsubscribe()
        if (ev.message === 'Cancelled') {
          finalizeStreaming()
        } else {
          resetStreaming(ev.message)
        }
        if (mountedRef.current) setLoading(false)
      }
    })

    const result = await window.sqlSentinel.aiAgentStream(text, history)
    if (!result.ok) {
      unsubscribe()
      resetStreaming(result.error)
      if (mountedRef.current) setLoading(false)
    }
  }, [input, loading, addMessage, setLoading, startStreaming, appendToken, addToolStep, completeToolStep, finalizeStreaming, resetStreaming])

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
            <Typography
              sx={{
                fontSize: tokens.font.sizeMd,
                fontWeight: tokens.font.weightBold,
                lineHeight: 1.2
              }}
            >
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

          {/* Tool timeline — shown while agent is calling tools */}
          {toolSteps.length > 0 && <ToolTimeline steps={toolSteps} />}

          {/* Streaming bubble — shows tokens as they arrive */}
          {streamingText && <StreamingBubble text={streamingText} loading={loading} />}

          {/* Fallback spinner when loading but no content yet */}
          {loading && !streamingText && toolSteps.length === 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1 }}>
              <CircularProgress size={14} />
              <Typography sx={{ fontSize: tokens.font.sizeSm, color: 'text.secondary', fontStyle: 'italic' }}>
                Agent is starting…
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
                endAdornment: loading ? (
                  <Button
                    onClick={() => window.sqlSentinel.aiAgentCancel()}
                    variant="outlined"
                    color="error"
                    size="small"
                    sx={{ ml: 1, flexShrink: 0, alignSelf: 'flex-end', mb: 0.25 }}
                    startIcon={<CancelIcon fontSize="small" />}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    onClick={sendMessage}
                    disabled={!input.trim()}
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

// ---------------------------------------------------------------------------
// Tool timeline
// ---------------------------------------------------------------------------

interface ToolTimelineProps {
  steps: ToolStep[]
}

function ToolTimeline({ steps }: ToolTimelineProps): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {steps.map((step, i) => (
        <Accordion
          key={i}
          disableGutters
          elevation={0}
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: '8px !important',
            '&:before': { display: 'none' },
            bgcolor: 'background.paper'
          }}
        >
          <AccordionSummary
            expandIcon={step.output ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : undefined}
            sx={{ minHeight: 32, py: 0, px: 1.5, '& .MuiAccordionSummary-content': { my: 0.5 } }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {step.status === 'running' ? (
                <CircularProgress size={12} />
              ) : (
                <CheckCircleOutlineIcon sx={{ fontSize: 14, color: 'success.main' }} />
              )}
              <Typography sx={{ fontSize: tokens.font.sizeXs, fontFamily: 'monospace' }}>
                {step.name}
              </Typography>
              <Chip
                label={step.status}
                size="small"
                color={step.status === 'done' ? 'success' : 'default'}
                sx={{ height: 16, fontSize: 10 }}
              />
            </Box>
          </AccordionSummary>
          {step.output && (
            <AccordionDetails sx={{ px: 1.5, pb: 1, pt: 0 }}>
              <ToolOutput output={step.output} />
            </AccordionDetails>
          )}
        </Accordion>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Tool output (expandable)
// ---------------------------------------------------------------------------

interface ToolOutputProps {
  output: string
}

function ToolOutput({ output }: ToolOutputProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const truncated = output.length > 500
  const displayed = truncated && !expanded ? output.slice(0, 500) + '…' : output
  return (
    <Box>
      <Typography
        component="pre"
        sx={{
          fontSize: 10,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          m: 0,
          color: 'text.secondary',
          maxHeight: 200,
          overflowY: 'auto'
        }}
      >
        {displayed}
      </Typography>
      {truncated && (
        <Button size="small" onClick={() => setExpanded((v) => !v)} sx={{ mt: 0.5, fontSize: 10, p: 0 }}>
          {expanded ? 'show less' : 'show all'}
        </Button>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Streaming bubble
// ---------------------------------------------------------------------------

interface StreamingBubbleProps {
  text: string
  loading: boolean
}

function StreamingBubble({ text, loading }: StreamingBubbleProps): React.JSX.Element {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
      <Box
        sx={{
          maxWidth: '85%',
          px: 1.5,
          py: 1,
          borderRadius: '12px 12px 12px 2px',
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          boxShadow: tokens.shadow.card
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
          {text}
          {loading && (
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                width: 8,
                height: '1em',
                bgcolor: 'text.primary',
                ml: '2px',
                verticalAlign: 'text-bottom',
                animation: 'blink 1s step-end infinite',
                '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } }
              }}
            />
          )}
        </Typography>
      </Box>
    </Box>
  )
}
