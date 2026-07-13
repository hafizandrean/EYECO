"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = exports.InMemorySessionStore = void 0;
class InMemorySessionStore {
    sessions = new Map();
    async create(token, userId, expiresAt) {
        this.sessions.set(token, { userId, expiresAt });
    }
    async getUserId(token) {
        const session = this.sessions.get(token);
        if (!session)
            return undefined;
        // Periksa kedaluwarsa sesi (TTL)
        if (session.expiresAt && new Date() > session.expiresAt) {
            this.sessions.delete(token);
            return undefined;
        }
        return session.userId;
    }
    async delete(token) {
        this.sessions.delete(token);
    }
    async invalidateAll(userId) {
        for (const [token, session] of this.sessions.entries()) {
            if (session.userId === userId) {
                this.sessions.delete(token);
            }
        }
    }
}
exports.InMemorySessionStore = InMemorySessionStore;
class SessionServiceClass {
    store = new InMemorySessionStore();
    setStore(store) {
        this.store = store;
    }
    async createSession(token, userId, expiresAt) {
        await this.store.create(token, userId, expiresAt);
    }
    async getUserId(token) {
        return await this.store.getUserId(token);
    }
    async deleteSession(token) {
        await this.store.delete(token);
    }
    async invalidateAllUserSessions(userId) {
        await this.store.invalidateAll(userId);
    }
}
exports.SessionService = new SessionServiceClass();
