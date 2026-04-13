import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import { tokens } from '../../styles/tokens'

interface RagDocument {
  id: string
  filename: string
  title: string
  addedAt: string
  chunkCount: number
}

export function RAGStatus(): React.JSX.Element {
  const [documents, setDocuments] = useState<RagDocument[]>([])

  useEffect(() => {
    window.sqlSentinel.rag.getDocuments().then((result) => {
      if (result.ok) setDocuments(result.data)
    })
  }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <MenuBookIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography sx={{ fontSize: tokens.font.sizeSm, fontWeight: tokens.font.weightSemibold }}>
          Libri SQL indicizzati ({documents.length})
        </Typography>
      </Box>

      {documents.length === 0 ? (
        <Box sx={{ py: 2, textAlign: 'center' }}>
          <Typography sx={{ fontSize: tokens.font.sizeSm, color: 'text.disabled' }}>
            Nessun libro indicizzato.
          </Typography>
          <Typography sx={{ fontSize: tokens.font.sizeXs, color: 'text.disabled', mt: 0.5 }}>
            Aggiungi PDF in <code>data/</code> e riavvia l&apos;app.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {documents.map((doc) => (
            <Box
              key={doc.id}
              sx={{
                px: 1.5,
                py: 1,
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper'
              }}
            >
              <Typography
                sx={{
                  fontSize: tokens.font.sizeSm,
                  fontWeight: tokens.font.weightSemibold,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {doc.title}
              </Typography>
              <Typography sx={{ fontSize: tokens.font.sizeXs, color: 'text.secondary' }}>
                {doc.chunkCount} chunk · {doc.filename}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
