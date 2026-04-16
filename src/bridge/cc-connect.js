import { EventEmitter } from 'events';

export class CCConnectBridge extends EventEmitter {
  constructor(config) {
    super();
    this.project = config.project || 'AI';
    this.socketPath = config.socket;
    this.sessions = new Map();
  }

  async sendMessage({ project, session, message }) {
    // 如果没有 cc-connect 服务运行，返回模拟响应
    // 实际部署时需要连接到 cc-connect 的 Unix Socket

    const sessionId = session || this.createSession();

    console.log(`📤 Sending to cc-connect [${sessionId}]: ${message.substring(0, 50)}...`);

    // 模拟响应（实际应通过 socket 与 cc-connect 通信）
    const response = await this.callAgent(sessionId, message);

    return response;
  }

  async callAgent(sessionId, message) {
    // 尝试连接 cc-connect socket
    try {
      const response = await this.callSocket(sessionId, message);
      return response;
    } catch (err) {
      console.log('⚠️ cc-connect socket not available, using mock response');
      // 返回模拟响应用于测试
      return this.mockResponse(message);
    }
  }

  async callSocket(sessionId, message) {
    // 实际实现需要使用 net 模块连接 Unix Socket
    // 这里提供框架，实际部署时需要完善
    throw new Error('Socket connection not implemented');
  }

  mockResponse(message) {
    // 测试用模拟响应
    return `收到消息: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"\n\n这是测试响应。请确保 cc-connect 服务正在运行以获得真实响应。`;
  }

  createSession() {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.sessions.set(sessionId, {
      id: sessionId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    });
    return sessionId;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  closeSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  close() {
    this.sessions.clear();
  }
}
