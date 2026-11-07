// 必須是第一個 import：ESM 會先執行所有 import，auth.js 在載入時就讀 JWT_SECRET，
// 原本在 import 之後才呼叫 dotenv.config()，.env 裡的值永遠來不及生效。
import 'dotenv/config';
import { createApp } from './app.js';
import { liquidsoap } from './telnet.js';
import { initDatabase } from './db.js';
import { setupWebSocket } from './websocket.js';
import { startAutoDJScheduler, stopAutoDJScheduler } from './scheduler.js';

// 1. 初始化 SQLite 資料庫與安全憑證
initDatabase();

const app = createApp();
const PORT = parseInt(process.env.PORT || '3001', 10);

// 啟動 HTTP 伺服器
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[CastFlow Server] Running on http://0.0.0.0:${PORT}`);
  
  // 啟動即時 WebSocket 服務
  console.log(`[CastFlow Server] Initializing WebSocket engine at ws://0.0.0.0:${PORT}/ws...`);
  setupWebSocket(server);

  // 連線至 Liquidsoap Telnet
  console.log(`[CastFlow Server] Connecting to Liquidsoap Telnet at ${liquidsoap.host}:${liquidsoap.port}...`);
  liquidsoap.connect();
});

liquidsoap.on('connect', () => {
  console.log('[CastFlow Server] Successfully connected to Liquidsoap Telnet!');
  // 啟動 AutoDJ 智慧排程派遣引擎
  startAutoDJScheduler();
});

liquidsoap.on('disconnect', () => {
  console.warn('[CastFlow Server] Disconnected from Liquidsoap Telnet. Will retry...');
  stopAutoDJScheduler();
});

liquidsoap.on('error', (err) => {
  console.error('[CastFlow Server] Liquidsoap Telnet Error:', err.message);
});

// 優雅關閉
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  liquidsoap.disconnect();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  liquidsoap.disconnect();
  server.close(() => process.exit(0));
});
