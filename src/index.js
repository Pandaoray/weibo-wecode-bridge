import dotenv from 'dotenv';
import { WeiboClient } from './weibo/client.js';
import { CCConnectBridge } from './bridge/cc-connect.js';
import { SessionManager } from './session/manager.js';

dotenv.config();

class WeiboWeCodeBridge {
  constructor() {
    this.config = {
      weibo: {
        appId: process.env.WEIBO_APP_ID,
        appSecret: process.env.WEIBO_APP_Secret,
        tokenUrl: process.env.WEIBO_TOKEN_URL || 'http://open-im.api.weibo.com/open/auth/ws_token',
        wsUrl: process.env.WEIBO_WS_URL || 'ws://open-im.api.weibo.com/ws/stream',
      },
      ccConnect: {
        project: process.env.CC_CONNECT_PROJECT || 'AI',
        socket: process.env.CC_CONNECT_SOCKET || '/Users/kanayama/.cc-connect/run/api.sock',
      },
      session: {
        timeout: parseInt(process.env.SESSION_TIMEOUT) || 3600000,
        heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000,
      },
    };

    this.weiboClient = null;
    this.ccConnectBridge = null;
    this.sessionManager = new SessionManager(this.config.session.timeout);
    this.running = false;
  }

  async start() {
    console.log('🚀 Starting Weibo-WeCode Bridge...');

    // 验证配置
    if (!this.config.weibo.appId || !this.config.weibo.appSecret) {
      console.error('❌ Missing Weibo credentials. Please set WEIBO_APP_ID and WEIBO_APP_Secret in .env');
      process.exit(1);
    }

    // 创建 cc-connect 桥接
    this.ccConnectBridge = new CCConnectBridge(this.config.ccConnect);

    // 创建微博客户端
    this.weiboClient = new WeiboClient(this.config.weibo);

    // 设置消息回调
    this.weiboClient.onMessage(async (msg) => {
      await this.handleWeiboMessage(msg);
    });

    this.weiboClient.onConnect(() => {
      console.log('✅ Connected to Weibo server');
    });

    this.weiboClient.onDisconnect((err) => {
      console.error('❌ Disconnected from Weibo:', err.message);
    });

    // 连接微博
    try {
      await this.weiboClient.connect();
    } catch (err) {
      console.error('❌ Failed to connect to Weibo:', err.message);
      process.exit(1);
    }

    this.running = true;
    console.log('✅ Bridge started successfully');

    // 定期清理过期会话
    setInterval(() => {
      this.sessionManager.cleanup();
    }, 60000);
  }

  async handleWeiboMessage(msg) {
    // 打印完整消息以便调试
    console.log('📨 Full message:', JSON.stringify(msg, null, 2));

    // 适配多种消息格式
    const payload = msg.payload || msg.data || msg;
    const fromUserId = payload.fromUserId || payload.from_user_id || payload.senderId || payload.sender_id || 'unknown';
    const text = payload.text || payload.content || payload.message || payload.msg || '';

    if (!text || text.trim() === '') {
      console.log('⚠️ Empty message, skipping');
      return;
    }

    console.log(`📨 Message from ${fromUserId}: ${text.substring(0, 50)}...`);

    // 获取或创建会话
    const session = this.sessionManager.getOrCreate(fromUserId);

    try {
      // 通过 cc-connect 发送到 WeCode
      const response = await this.ccConnectBridge.sendMessage({
        project: this.config.ccConnect.project,
        session: session.ccSessionId,
        message: text,
      });

      // 发送回复到微博
      await this.sendReply(fromUserId, response, session);

    } catch (err) {
      console.error(`❌ Error processing message: ${err.message}`);
      // 发送错误提示
      await this.weiboClient.send(fromUserId, `处理消息时出错: ${err.message}`);
    }
  }

  async sendReply(userId, response, session) {
    // 检查是否是流式响应
    if (typeof response === 'string') {
      // 单次响应
      await this.weiboClient.send(userId, response);
    } else if (response.chunks) {
      // 流式响应
      let chunkId = 0;
      for (const chunk of response.chunks) {
        await this.weiboClient.sendChunk(userId, chunk, chunkId++, false);
        // 小延迟，避免发送太快
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      // 发送结束标记
      await this.weiboClient.sendChunk(userId, '', chunkId, true);
    }
  }

  stop() {
    console.log('🛑 Stopping bridge...');
    this.running = false;

    if (this.weiboClient) {
      this.weiboClient.close();
    }

    if (this.ccConnectBridge) {
      this.ccConnectBridge.close();
    }

    console.log('✅ Bridge stopped');
  }
}

// 主入口
const bridge = new WeiboWeCodeBridge();

// 处理退出信号
process.on('SIGINT', () => {
  bridge.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bridge.stop();
  process.exit(0);
});

// 启动
bridge.start().catch(err => {
  console.error('❌ Bridge failed to start:', err);
  process.exit(1);
});
