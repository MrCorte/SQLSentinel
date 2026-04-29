// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useGroupsStore, migrateAliasKeys, migrateServerGroupKeys } from '../store/groupsStore'
import type { StoredServer } from '../../../preload/index'

// Reset to blank state before each test (bypass persist hydration)
beforeEach(() => {
  localStorage.clear()
  useGroupsStore.setState({
    groups: [],
    serverGroups: {},
    serverAliases: {},
    expandedAGs: [],
    expandedMachines: []
  })
})

// ── Factory ───────────────────────────────────────────────────────────────────

function makeServer(id: string, host: string, port = 1433): StoredServer {
  return {
    id,
    host,
    ip: host,
    port,
    useWindowsAuth: true,
    addedAt: new Date().toISOString()
  }
}

// ── addGroup ──────────────────────────────────────────────────────────────────

describe('addGroup', () => {
  it('adds a new group with correct fields', () => {
    useGroupsStore.getState().addGroup('Prod', '#ff0000')
    const groups = useGroupsStore.getState().groups
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('Prod')
    expect(groups[0].color).toBe('#ff0000')
    expect(groups[0].collapsed).toBe(false)
    expect(typeof groups[0].id).toBe('string')
  })

  it('assigns order = current group count', () => {
    useGroupsStore.getState().addGroup('A', '#000')
    useGroupsStore.getState().addGroup('B', '#111')
    const groups = useGroupsStore.getState().groups
    expect(groups[0].order).toBe(0)
    expect(groups[1].order).toBe(1)
  })
})

// ── removeGroup ───────────────────────────────────────────────────────────────

describe('removeGroup', () => {
  it('removes the group from the list', () => {
    useGroupsStore.getState().addGroup('Dev', '#green')
    const id = useGroupsStore.getState().groups[0].id
    useGroupsStore.getState().removeGroup(id)
    expect(useGroupsStore.getState().groups).toHaveLength(0)
  })

  it('unassigns servers that belonged to the removed group', () => {
    useGroupsStore.getState().addGroup('Dev', '#000')
    const id = useGroupsStore.getState().groups[0].id
    useGroupsStore.setState({ serverGroups: { srv1: id, srv2: 'other-group' } })
    useGroupsStore.getState().removeGroup(id)
    const sg = useGroupsStore.getState().serverGroups
    expect(sg['srv1']).toBeUndefined()
    expect(sg['srv2']).toBe('other-group')
  })
})

// ── renameGroup ───────────────────────────────────────────────────────────────

describe('renameGroup', () => {
  it('updates the name of the matching group', () => {
    useGroupsStore.getState().addGroup('Old Name', '#000')
    const id = useGroupsStore.getState().groups[0].id
    useGroupsStore.getState().renameGroup(id, 'New Name')
    expect(useGroupsStore.getState().groups[0].name).toBe('New Name')
  })

  it('does not affect other groups', () => {
    useGroupsStore.getState().addGroup('A', '#000')
    useGroupsStore.getState().addGroup('B', '#111')
    const groups = useGroupsStore.getState().groups
    useGroupsStore.getState().renameGroup(groups[0].id, 'A-renamed')
    expect(useGroupsStore.getState().groups[1].name).toBe('B')
  })
})

// ── toggleCollapse ────────────────────────────────────────────────────────────

describe('toggleCollapse', () => {
  it('flips collapsed from false to true', () => {
    useGroupsStore.getState().addGroup('G', '#000')
    const id = useGroupsStore.getState().groups[0].id
    expect(useGroupsStore.getState().groups[0].collapsed).toBe(false)
    useGroupsStore.getState().toggleCollapse(id)
    expect(useGroupsStore.getState().groups[0].collapsed).toBe(true)
  })

  it('flips back to false on second call', () => {
    useGroupsStore.getState().addGroup('G', '#000')
    const id = useGroupsStore.getState().groups[0].id
    useGroupsStore.getState().toggleCollapse(id)
    useGroupsStore.getState().toggleCollapse(id)
    expect(useGroupsStore.getState().groups[0].collapsed).toBe(false)
  })
})

// ── reorderGroups ─────────────────────────────────────────────────────────────

describe('reorderGroups', () => {
  it('updates order field to match new array position', () => {
    useGroupsStore.getState().addGroup('A', '#000')
    useGroupsStore.getState().addGroup('B', '#111')
    const [a, b] = useGroupsStore.getState().groups
    useGroupsStore.getState().reorderGroups([b, a]) // swap
    const reordered = useGroupsStore.getState().groups
    expect(reordered[0].id).toBe(b.id)
    expect(reordered[0].order).toBe(0)
    expect(reordered[1].id).toBe(a.id)
    expect(reordered[1].order).toBe(1)
  })
})

// ── setServerGroup ────────────────────────────────────────────────────────────

describe('setServerGroup', () => {
  it('assigns a server to a group', () => {
    useGroupsStore.getState().setServerGroup('srv1', 'grp1')
    expect(useGroupsStore.getState().serverGroups['srv1']).toBe('grp1')
  })

  it('removes assignment when groupId is undefined', () => {
    useGroupsStore.setState({ serverGroups: { srv1: 'grp1' } })
    useGroupsStore.getState().setServerGroup('srv1', undefined)
    expect(useGroupsStore.getState().serverGroups['srv1']).toBeUndefined()
  })

  it('overwrites an existing assignment', () => {
    useGroupsStore.setState({ serverGroups: { srv1: 'grp1' } })
    useGroupsStore.getState().setServerGroup('srv1', 'grp2')
    expect(useGroupsStore.getState().serverGroups['srv1']).toBe('grp2')
  })
})

// ── setServerAlias ────────────────────────────────────────────────────────────

describe('setServerAlias', () => {
  it('sets an alias for a server', () => {
    useGroupsStore.getState().setServerAlias('srv1', 'My Server')
    expect(useGroupsStore.getState().serverAliases['srv1']).toBe('My Server')
  })

  it('trims whitespace', () => {
    useGroupsStore.getState().setServerAlias('srv1', '  DB01  ')
    expect(useGroupsStore.getState().serverAliases['srv1']).toBe('DB01')
  })

  it('removes alias when set to empty string', () => {
    useGroupsStore.setState({ serverAliases: { srv1: 'Old Name' } })
    useGroupsStore.getState().setServerAlias('srv1', '')
    expect(useGroupsStore.getState().serverAliases['srv1']).toBeUndefined()
  })

  it('removes alias when set to whitespace-only', () => {
    useGroupsStore.setState({ serverAliases: { srv1: 'Old Name' } })
    useGroupsStore.getState().setServerAlias('srv1', '   ')
    expect(useGroupsStore.getState().serverAliases['srv1']).toBeUndefined()
  })
})

// ── toggleAgCollapse ──────────────────────────────────────────────────────────

describe('toggleAgCollapse', () => {
  it('adds agName to expandedAGs on first call', () => {
    useGroupsStore.getState().toggleAgCollapse('AG_PROD')
    expect(useGroupsStore.getState().expandedAGs).toContain('AG_PROD')
  })

  it('removes agName from expandedAGs on second call', () => {
    useGroupsStore.getState().toggleAgCollapse('AG_PROD')
    useGroupsStore.getState().toggleAgCollapse('AG_PROD')
    expect(useGroupsStore.getState().expandedAGs).not.toContain('AG_PROD')
  })
})

// ── toggleMachineCollapse ─────────────────────────────────────────────────────

describe('toggleMachineCollapse', () => {
  it('adds machineName to expandedMachines on first call', () => {
    useGroupsStore.getState().toggleMachineCollapse('SQL-SERVER-01')
    expect(useGroupsStore.getState().expandedMachines).toContain('SQL-SERVER-01')
  })

  it('removes machineName from expandedMachines on second call', () => {
    useGroupsStore.getState().toggleMachineCollapse('SQL-SERVER-01')
    useGroupsStore.getState().toggleMachineCollapse('SQL-SERVER-01')
    expect(useGroupsStore.getState().expandedMachines).not.toContain('SQL-SERVER-01')
  })
})

// ── migrateAliasKeys ──────────────────────────────────────────────────────────

describe('migrateAliasKeys', () => {
  it('remaps ip:port alias keys to server UUID', () => {
    const servers = [makeServer('uuid-1', '10.0.0.1', 1433)]
    useGroupsStore.setState({ serverAliases: { '10.0.0.1:1433': 'My Server' } })
    migrateAliasKeys(servers)
    const aliases = useGroupsStore.getState().serverAliases
    expect(aliases['uuid-1']).toBe('My Server')
    expect(aliases['10.0.0.1:1433']).toBeUndefined()
  })

  it('preserves UUID-keyed aliases without modification', () => {
    const servers = [makeServer('uuid-1', '10.0.0.1', 1433)]
    useGroupsStore.setState({ serverAliases: { 'uuid-1': 'Already Migrated' } })
    migrateAliasKeys(servers)
    expect(useGroupsStore.getState().serverAliases['uuid-1']).toBe('Already Migrated')
  })

  it('is a no-op when there are no legacy keys', () => {
    useGroupsStore.setState({ serverAliases: { 'uuid-1': 'Alias' } })
    migrateAliasKeys([])
    expect(useGroupsStore.getState().serverAliases['uuid-1']).toBe('Alias')
  })

  it('preserves unmatched ip:port keys (conservative — no data loss)', () => {
    useGroupsStore.setState({ serverAliases: { '99.99.99.99:1433': 'Orphan' } })
    migrateAliasKeys([makeServer('uuid-1', '10.0.0.1')])
    // Server at 99.99.99.99 not found → keep old key
    expect(useGroupsStore.getState().serverAliases['99.99.99.99:1433']).toBe('Orphan')
  })
})

// ── migrateServerGroupKeys ────────────────────────────────────────────────────

describe('migrateServerGroupKeys', () => {
  it('remaps ip:port serverGroups keys to server UUID', () => {
    const servers = [makeServer('uuid-2', '192.168.1.5', 1433)]
    useGroupsStore.setState({ serverGroups: { '192.168.1.5:1433': 'grp-prod' } })
    migrateServerGroupKeys(servers)
    const sg = useGroupsStore.getState().serverGroups
    expect(sg['uuid-2']).toBe('grp-prod')
    expect(sg['192.168.1.5:1433']).toBeUndefined()
  })

  it('is a no-op when all keys are already UUIDs', () => {
    useGroupsStore.setState({ serverGroups: { 'uuid-2': 'grp-dev' } })
    migrateServerGroupKeys([makeServer('uuid-2', '192.168.1.5')])
    expect(useGroupsStore.getState().serverGroups['uuid-2']).toBe('grp-dev')
  })
})
