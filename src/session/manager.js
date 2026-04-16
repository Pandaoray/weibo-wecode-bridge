export class SessionManager {
  constructor(timeout = 3600000) {
    this.timeout = timeout;
    this.sessions = new Map();
  }

  getOrCreate(userId) {
    let session = this.sessions.get(userId);

    if (!session || this.isExpired(session)) {
      session = {
        id: userId,
        ccSessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.sessions.set(userId, session);
      console.log(`📝 New session created for user ${userId}`);
    } else {
      session.lastActivity = Date.now();
    }

    return session;
  }

  get(userId) {
    return this.sessions.get(userId);
  }

  isExpired(session) {
    return Date.now() - session.lastActivity > this.timeout;
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, session] of this.sessions) {
      if (now - session.lastActivity > this.timeout) {
        this.sessions.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned ${cleaned} expired sessions`);
    }
  }

  delete(userId) {
    this.sessions.delete(userId);
  }

  clear() {
    this.sessions.clear();
  }

  size() {
    return this.sessions.size;
  }
}
