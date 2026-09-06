import { WebSocketServer, WebSocket } from 'ws';
import { getRadioStatus } from './scheduler.js';
import { recordTrackHistory } from './db.js';

let wss = null;
let lastBroadcastState = null;
let pollTimer = null;

/**
 * 初始化 WebSocket 伺服器
 */
export function setupWebSocket(httpServer) {
  wss = new WebSocketServer({
    server: httpServer,
    path: '/ws'
  });

  wss.on('connection', async (ws, req) => {
    // 連線成功時立即發送最新廣播狀態
    try {
      const currentStatus = await getRadioStatus();
      ws.send(JSON.stringify({ type: 'RADIO_STATUS', data: currentStatus }));
    } catch {
      // 忽略
    }

    ws.on('message', async (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
        } else if (parsed.type === 'GET_STATUS') {
          const status = await getRadioStatus();
          ws.send(JSON.stringify({ type: 'RADIO_STATUS', data: status }));
        }
      } catch {
        // 忽略無效訊息
      }
    });

    ws.on('error', () => {});
  });

  // 啟動背景狀態輪詢推播迴圈 (每秒檢測變化並推播)
  startRealtimeBroadcastLoop();
}

/**
 * 廣播訊息給所有已連線之聽眾與管理端
 */
export function broadcast(payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

/**
 * 背景高頻檢測廣播狀態變化，一旦曲目或在線人數變動，毫秒級推播至前端
 */
function startRealtimeBroadcastLoop() {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    if (!wss || wss.clients.size === 0) {
      return;
    }

    try {
      const currentStatus = await getRadioStatus();
      const currentTrack = currentStatus.currentTrack;

      // 當曲目有變化時，自動記錄進 SQLite 播放歷史
      if (currentTrack && currentTrack.title) {
        recordTrackHistory(currentTrack);
      }

      // 比對曲目標題、聽眾數或連線狀態是否異動
      const stateHash = `${currentTrack?.title}::${currentTrack?.remaining}::${currentStatus?.icecast?.listeners}::${currentStatus?.online}`;
      
      // 為了維持進度條平滑，每秒推播給在線用戶
      broadcast({ type: 'RADIO_STATUS', data: currentStatus });
      lastBroadcastState = stateHash;
    } catch {
      // 容錯
    }
  }, 1000);
}
