// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { StoredServer } from '../../../preload/index'

// react-virtual renders nothing in jsdom (the scroll container has 0 height),
// so stub useVirtualizer to lay out every row at a fixed height. This lets us
// assert on the actual AG header DOM that ServerTable produces.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: {
    count: number
    getItemKey?: (i: number) => string | number
  }) => ({
    getTotalSize: () => opts.count * 48,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_v, index) => ({
        index,
        key: opts.getItemKey ? opts.getItemKey(index) : index,
        start: index * 48,
        size: 48
      }))
  })
}))

import { ServerTable } from '../components/features/home/ServerTable'

function srv(id: string, opts: Partial<StoredServer> = {}): StoredServer {
  return {
    id,
    host: id,
    ip: id,
    port: 1433,
    useWindowsAuth: true,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...opts
  }
}

function renderTable(servers: StoredServer[], onNavigateToAg = vi.fn()) {
  render(
    <ServerTable
      servers={servers}
      metricsMap={{}}
      summaries={{}}
      alertCountByServer={{}}
      groupByServerKey={{}}
      serverAliases={{}}
      now={Date.now()}
      onNavigate={vi.fn()}
      onNavigateToAg={onNavigateToAg}
    />
  )
  return onNavigateToAg
}

describe('ServerTable — AG header click', () => {
  it('invokes onNavigateToAg with the AG name when the header is clicked', () => {
    const onNavigateToAg = renderTable([
      srv('node-a', { agName: 'AG-PROD-01', agRole: 'PRIMARY' }),
      srv('node-b', { agName: 'AG-PROD-01', agRole: 'SECONDARY' })
    ])

    fireEvent.click(screen.getByText('AG-PROD-01'))

    expect(onNavigateToAg).toHaveBeenCalledTimes(1)
    expect(onNavigateToAg).toHaveBeenCalledWith('AG-PROD-01')
  })

  it('renders no AG header (and never calls onNavigateToAg) for a lone replica', () => {
    const onNavigateToAg = renderTable([
      srv('solo', { agName: 'AG-SOLO', agRole: 'PRIMARY' }),
      srv('plain')
    ])

    // A single replica stays inline — no clickable group header.
    expect(screen.queryByText('AG-SOLO')).toBeNull()
    expect(onNavigateToAg).not.toHaveBeenCalled()
  })
})
