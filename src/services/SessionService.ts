export interface ISessionStore {
  create(token: string, userId: number, expiresAt?: Date): Promise<void>;
  getUserId(token: string): Promise<number | undefined>;
  delete(token: string): Promise<void>;
  invalidateAll(userId: number): Promise<void>;
}

export class InMemorySessionStore implements ISessionStore {
  private sessions = new Map<string, { userId: number; expiresAt?: Date }>();

  public async create(token: string, userId: number, expiresAt?: Date): Promise<void> {
    this.sessions.set(token, { userId, expiresAt });
  }

  public async getUserId(token: string): Promise<number | undefined> {
    const session = this.sessions.get(token);
    if (!session) return undefined;
    
    // Periksa kedaluwarsa sesi (TTL)
    if (session.expiresAt && new Date() > session.expiresAt) {
      this.sessions.delete(token);
      return undefined;
    }
    
    return session.userId;
  }

  public async delete(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  public async invalidateAll(userId: number): Promise<void> {
    for (const [token, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        this.sessions.delete(token);
      }
    }
  }
}

class SessionServiceClass {
  private store: ISessionStore = new InMemorySessionStore();

  public setStore(store: ISessionStore): void {
    this.store = store;
  }

  public async createSession(token: string, userId: number, expiresAt?: Date): Promise<void> {
    await this.store.create(token, userId, expiresAt);
  }

  public async getUserId(token: string): Promise<number | undefined> {
    return await this.store.getUserId(token);
  }

  public async deleteSession(token: string): Promise<void> {
    await this.store.delete(token);
  }

  public async invalidateAllUserSessions(userId: number): Promise<void> {
    await this.store.invalidateAll(userId);
  }
}

export const SessionService = new SessionServiceClass();
