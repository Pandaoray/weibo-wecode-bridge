import WebSocket from 'ws';

export class WeiboClient {
  constructor(config) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.tokenUrl = config.tokenUrl || 'http://open-im.api.weibo.com/open/auth/ws_token';
    this.wsUrl = config.wsUrl || 'ws://open-im.api.weibo.com/ws/stream';

    this.ws = null;
    this.token = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.messageCallbacks = [];
    this.connectCallbacks = [];
    this.disconnectCallbacks = [];
    this.processedMsgs = new Set(); // 消息去重
    this.running = false;
  }

  onMessage(callback) {
    this.messageCallbacks.push(callback);
  }

  onConnect(callback) {
    this.connectCallbacks.push(callback);
  }

  onDisconnect(callback) {
    this.disconnectCallbacks.push(callback);
  }

  async connect() {
    console.log('🔗 Connecting to Weibo...');

    // 获取 token
    await this.fetchToken();

    // 连接 WebSocket
    await this.connectWebSocket();

    this.running = true;
  }

  async fetchToken() {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch token: ${response.status}`);
    }

    const data = await response.json();
    this.token = data.token || data.data?.token;

    if (!this.token) {
      throw new Error('No token in response');
    }

    console.log('🔑 Token fetched successfully');
  }

  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      const url = `${this.wsUrl}?app_id=${this.appId}&token=${this.token}`;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        console.log('📡 WebSocket connected');
        this.startHeartbeat();
        this.connectCallbacks.forEach(cb => cb());
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        console.log('📡 WebSocket closed');
        this.stopHeartbeat();
        this.disconnectCallbacks.forEach(cb => cb(new Error('Connection closed')));
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('❌ WebSocket error:', err.message);
        reject(err);
      });
    });
  }

  handleMessage(data) {
    const rawData = data.toString();

    // 处理纯文本 pong 响应
    if (rawData === 'pong' || rawData === '"pong"') {
      // console.log('💓 Heartbeat pong received');
      return;
    }

    try {
      const msg = JSON.parse(rawData);

      // 调试：打印原始消息
      console.log('📩 Raw message:', JSON.stringify(msg).substring(0, 300));

      // 心跳响应 (JSON 格式)
      if (msg.type === 'pong') {
        return;
      }

      // 系统消息过滤
      if (msg.type === 'connected' || msg.type === 'system' || !msg.type) {
        console.log(`📋 System message: ${msg.type || 'unknown'}`);
        return;
      }

      // 只处理用户消息
      if (msg.type !== 'message' && msg.type !== 'chat') {
        console.log(`📋 Non-chat message type: ${msg.type}`);
        return;
      }

      // 消息去重
      const msgId = msg.id || msg.msgId || msg.messageId || JSON.stringify(msg);
      if (this.processedMsgs.has(msgId)) {
        return;
      }
      this.processedMsgs.add(msgId);

      // 清理旧消息ID（保留最近1000条）
      if (this.processedMsgs.size > 1000) {
        const arr = Array.from(this.processedMsgs);
        this.processedMsgs = new Set(arr.slice(-500));
      }

      // 触发回调
      this.messageCallbacks.forEach(cb => cb(msg));

    } catch (err) {
      console.error('❌ Failed to parse message:', err.message, '| Raw:', rawData.substring(0, 100));
    }
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (!this.running) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      console.log('🔄 Reconnecting...');
      try {
        await this.connect();
      } catch (err) {
        console.error('❌ Reconnect failed:', err.message);
        this.scheduleReconnect();
      }
    }, 5000);
  }

  async send(userId, text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    // 超长消息分块
    const maxLen = 4000;
    if (text.length > maxLen) {
      return this.sendChunks(userId, text, maxLen);
    }

    // 根据微博 API，消息格式需要匹配接收到的格式
    const msg = {
      type: 'message',
      payload: {
        toUserId: userId,
        text: text,
      },
    };

    console.log(`📤 Sending to ${userId}: ${text.substring(0, 50)}...`);
    this.ws.send(JSON.stringify(msg));
    console.log(`✅ Message sent successfully`);
  }

  async sendChunks(userId, text, chunkSize) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    for (let i = 0; i < chunks.length; i++) {
      await this.sendChunk(userId, chunks[i], i, i === chunks.length - 1);
      await new Promise(r => setTimeout(r, 50));
    }
  }

  async sendChunk(userId, text, chunkId, isLast) {
    const msg = {
      type: 'chunk',
      to: userId,
      payload: {
        text: text,
        chunk_id: chunkId,
        is_last: isLast,
      },
    };

    this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.running = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
