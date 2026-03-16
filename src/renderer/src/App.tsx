import { useState } from 'react'
import { Box, Tabs, Tab, Paper } from '@mui/material'
import { Discovery } from './pages/Discovery'
import { Dashboard } from './pages/Dashboard'

function App(): React.JSX.Element {
  const [tab, setTab] = useState(0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Paper square elevation={1} sx={{ zIndex: 1 }}>
        <Tabs value={tab} onChange={(_e, v) => setTab(v as number)}>
          <Tab label="Discovery" />
          <Tab label="Dashboard" />
        </Tabs>
      </Paper>
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        {tab === 0 && <Box sx={{ height: '100%', overflow: 'auto' }}><Discovery /></Box>}
        {tab === 1 && <Box sx={{ height: '100%', overflow: 'hidden' }}><Dashboard /></Box>}
      </Box>
    </Box>
  )
}

export default App
