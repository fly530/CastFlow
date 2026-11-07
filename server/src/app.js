import express from 'express';
import cors from 'cors';
import { router } from './api.js';
import { liquidsoap } from './telnet.js';

/**
 * 組出 Express app (中介軟體、路由、錯誤處理)。
 * 與 index.js 的「啟動」分開，測試才能用真正的中介軟體設定跑 API，
 * 而不必連 Liquidsoap 或監聽固定 port。
 */
export function createApp() {
  const app = express();

  // 中介軟體設定
  app.use(cors());
  // 上傳備份還原的 JSON 含每個歌單的曲目清單，曲庫一大就超過 express.json 預設的 100kb。
  // 只對這條路由放寬；先掛的 parser 處理過之後，全域 parser 會直接略過。
  app.use('/api/backups/restore-data', express.json({ limit: '20mb' }));
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
    // body-parser / multer 的錯誤帶有 status (413 太大、400 JSON 格式錯)，不要一律變成 500
    const status =
      err.code === 'LIMIT_FILE_SIZE'
        ? 413
        : Number.isInteger(err.status) && err.status >= 400 && err.status < 600
          ? err.status
          : 500;
    if (status >= 500) console.error('[Error]', err);
    const error =
      status === 413 ? '上傳內容超過大小上限' : status === 400 && err.type === 'entity.parse.failed' ? 'JSON 格式錯誤' : err.message;
    res.status(status).json({ success: false, error: error || 'Internal Server Error' });
  });

  return app;
}
