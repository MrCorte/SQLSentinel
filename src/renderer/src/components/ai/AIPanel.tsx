import { useRef, useEffect, useState, useCallback } from 'react'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { tokens } from '../../styles/tokens'
import { useAiChatStore } from '../../store/aiChatStore'
import type { AiMessage } from '../../store/aiChatStore'
import { RAGStatus } from './RAGStatus'

const PANEL_WIDTH = 420

const WELCOME_MESSAGE =
  "Sono l'assistente AI di SQL Sentinel.\n\nChiedimi:\n• \"Perché la CPU è alta?\"\n• \"Quali server hanno problemi?\"\n• \"Alert critici nelle ultime 24h?\"\n• \"Analizza le sessioni bloccanti\""

interface AIPanelProps {
  open: boolean
  onClose: () => void
}

export function AIPanel({ open, onClose }: AIPanelProps): React.JSX.Element {
  const { messages, loading, addMessage, setLoading, clear } = useAiChatStore()
  const [input, setInput] = useState('')
  const [activeTab, setActiveTab] = useState<'chat' | 'books'>('chat')
  const bottomRef = useRef<HTMLDivElement>(null)

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
      if (result.ok) {
        addMessage({ role: 'assistant', content: result.data, ts: Date.now() })
      } else {
        addMessage({
          role: 'assistant',
          content: `Errore: ${result.error}\n\nVerifica che Ollama sia in esecuzione:\n  ollama serve\n  ollama pull deepseek-coder:1.3b`,
          ts: Date.now()
        })
      }
    } catch {
      addMessage({
        role: 'assistant',
        content:
          'Connessione ad Ollama fallita.\n\nAssicurati che sia in esecuzione:\n  ollama serve\n  ollama pull deepseek-coder:1.3b',
        ts: Date.now()
      })
    } finally {
      setLoading(false)
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
              Assistente AI DBA
            </Typography>
            <Typography sx={{ fontSize: tokens.font.sizeXs, opacity: 0.85 }}>
              deepseek-coder · LangGraph agent · tutto locale
            </Typography>
          </Box>
          {activeTab === 'chat' && (
            <Tooltip title="Cancella cronologia">
              <IconButton size="small" onClick={clear} sx={{ color: 'rgba(255,255,255,0.8)' }}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Chiudi">
            <IconButton size="small" onClick={onClose} sx={{ color: 'rgba(255,255,255,0.8)' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v as 'chat' | 'books')}
          sx={{
            minHeight: 32,
            '& .MuiTab-root': {
              minHeight: 32,
              fontSize: tokens.font.sizeXs,
              color: 'rgba(255,255,255,0.7)',
              py: 0.5
            },
            '& .Mui-selected': { color: '#fff !important' },
            '& .MuiTabs-indicator': { backgroundColor: '#fff' }
          }}
        >
          <Tab value="chat" label="Chat" />
          <Tab value="books" label="Libri" />
        </Tabs>
      </Box>

      {activeTab === 'chat' ? (
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
                  L&apos;agente sta analizzando…
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
              placeholder="Chiedi: 'server con CPU alta?' — Invio per inviare, Shift+Invio per andare a capo"
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
                      Invia
                    </Button>
                  )
                }
              }}
            />
          </Box>
        </>
      ) : (
        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2, bgcolor: 'background.default' }}>
          <RAGStatus />
        </Box>
      )}
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
