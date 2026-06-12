import type { StoredServer } from '../../../preload/index'

/**
 * Sceglie il membro AG da cui eseguire le query (gruppi/repliche/database).
 * I DMV AG mostrano lo stato completo solo sul PRIMARY: interrogare una
 * secondaria fa apparire le repliche remote come RESOLVING/DISCONNECTED
 * (ruolo NULL coalizzato dal collector). Preferenza:
 *   1. PRIMARY raggiungibile
 *   2. qualsiasi membro raggiungibile
 *   3. primo membro (tutti irraggiungibili — meglio tentare che niente)
 */
export function pickAgQueryMember(members: StoredServer[]): StoredServer | undefined {
  const reachable = members.filter((s) => !s.unreachable)
  return reachable.find((s) => s.agRole === 'PRIMARY') ?? reachable[0] ?? members[0]
}
