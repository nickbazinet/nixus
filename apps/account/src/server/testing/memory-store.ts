import type {
  PreAuthRecord,
  SessionRecord,
  SessionStore,
  SessionTokens,
} from "../store.ts";

/**
 * In-memory session store.
 *
 * A real implementation of the interface, not a mock: the security gates run the
 * production `sessions.ts` / `auth-flow.ts` logic against it, so a test fails when
 * the LOGIC is wrong rather than when a call pattern changes. The single-use
 * consume is modelled the way DynamoDB's conditional delete behaves, because that
 * atomicity is the property the replay gate depends on.
 */
export class MemorySessionStore implements SessionStore {
  readonly preauth = new Map<string, PreAuthRecord>();
  readonly sessions = new Map<string, SessionRecord>();

  async putPreAuth(record: PreAuthRecord): Promise<void> {
    this.preauth.set(record.id, record);
  }

  async consumePreAuth(id: string): Promise<PreAuthRecord | null> {
    const record = this.preauth.get(id);
    if (!record) return null;
    this.preauth.delete(id);
    return record;
  }

  async putSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.id, record);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async extendSession(id: string, idleExpiresAt: number): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) return;
    this.sessions.set(id, {
      ...record,
      idle_expires_at: idleExpiresAt,
      expires_at: idleExpiresAt,
    });
  }

  async replaceTokens(id: string, tokens: SessionTokens): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) return;
    this.sessions.set(id, { ...record, tokens });
  }
}
