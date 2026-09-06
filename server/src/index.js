import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { router } from './api.js';
import { liquidsoap } from './telnet.js';
import { initDatabase } from './db.js';
import { setupWebSocket } from './websocket.js';
import { startAutoDJScheduler, stopAutoDJScheduler } from './scheduler.js';

dotenv.config();

// 1. 初始化 SQLite 資料庫與安全憑證
initDatabase();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// 中介軟體設定
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 健康檢查
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    liquidsoapConnected: liquidsoap.isConnected
  });
});

// 掛載 API 路由
app.use('/api', router);

// 全域錯誤處理
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

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
