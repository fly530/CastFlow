// 必須是第一個 import：ESM 會先執行所有 import，auth.js 在載入時就讀 JWT_SECRET，
// 原本在 import 之後才呼叫 dotenv.config()，.env 裡的值永遠來不及生效。
import 'dotenv/config';
import { createApp } from './app.js';
import { liquidsoap } from './telnet.js';
import { initDatabase, closeDatabase } from './db.js';
import { setupWebSocket, closeWebSocket } from './websocket.js';
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

// 優雅關閉。
// 原本只呼叫 server.close()：它會等所有連線自己結束，但 WebSocket 與 keep-alive 連線不會自己斷，
// 所以永遠等不到，最後被 docker 在 10 秒後 SIGKILL —— SQLite 的 WAL 沒寫回、排程計時器也沒停。
const SHUTDOWN_TIMEOUT_MS = 8000; // 要比 docker 預設的 stop timeout (10 秒) 短
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Shutting down gracefully...`);

  const forceTimer = setTimeout(() => {
    console.warn('[CastFlow Server] Graceful shutdown timed out, forcing exit.');
    server.closeAllConnections?.();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  stopAutoDJScheduler();
  liquidsoap.disconnect();
  await closeWebSocket().catch(() => {});
  await new Promise((resolve) => {
    server.close(() => resolve());
    // 閒置的 keep-alive 連線直接關；進行中的請求 (例如上傳) 讓它跑完
    server.closeIdleConnections?.();
  });
  try {
    closeDatabase();
  } catch (err) {
    console.error('[CastFlow Server] Failed to close database:', err.message);
  }
  clearTimeout(forceTimer);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
