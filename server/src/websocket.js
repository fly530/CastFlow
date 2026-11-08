import { WebSocketServer, WebSocket } from 'ws';
import { getRadioStatus } from './scheduler.js';

let wss = null;
let pollTimer = null;
let heartbeatTimer = null;

// 每 30 秒 ping 一次，下一輪還沒收到 pong 就斷開。
// 手機切到背景、Wi-Fi 換手、筆電闔上時 TCP 不一定會收到關閉，
// 沒有心跳的話這些死連線會一直留在 wss.clients，推播迴圈也就永遠停不下來。
const HEARTBEAT_MS = 30000;
// 客戶端只會送 PING / GET_STATUS 這種小訊息；ws 預設上限是 100MB
const MAX_PAYLOAD_BYTES = 4096;
// 送不出去的資料堆超過這個量 (網路很慢的客戶端) 就先跳過推播，不要在記憶體裡越堆越多
const MAX_BUFFERED_BYTES = 256 * 1024;

function sendStatus(ws, status) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'RADIO_STATUS', data: status }));
  }
}

/**
 * 初始化 WebSocket 伺服器
 */
export function setupWebSocket(httpServer) {
  wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: MAX_PAYLOAD_BYTES
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // 連線成功時立即發送最新廣播狀態 (共用狀態快取，大量同時連線不會各算一次)
    getRadioStatus()
      .then((status) => sendStatus(ws, status))
      .catch(() => {});

    ws.on('message', async (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
        } else if (parsed.type === 'GET_STATUS') {
          sendStatus(ws, await getRadioStatus());
        }
      } catch {
        // 忽略無效訊息
      }
    });

    ws.on('error', () => {});
  });

  startHeartbeat();
  // 啟動背景狀態推播迴圈 (每秒一次)
  startRealtimeBroadcastLoop();
}

/**
 * 廣播訊息給所有已連線之聽眾與管理端
 */
export function broadcast(payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.bufferedAmount < MAX_BUFFERED_BYTES) {
      client.send(msg);
    }
  }
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, HEARTBEAT_MS);
}

/**
 * 每秒推播一次狀態 (維持前端進度條平滑)。
 * 沒有任何連線時不計算；狀態每秒重新計算一次，同一秒內其他地方要狀態時共用這份結果。
 */
let isBroadcasting = false;
function startRealtimeBroadcastLoop() {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    if (!wss || wss.clients.size === 0 || isBroadcasting) {
      return;
    }
    // Telnet 卡住時一次計算可能超過 1 秒：上一輪還沒好就跳過，不要排隊越疊越多
    isBroadcasting = true;
    try {
      const currentStatus = await getRadioStatus({ maxAgeMs: 500 });
      broadcast({ type: 'RADIO_STATUS', data: currentStatus });
    } catch {
      // 容錯
    } finally {
      isBroadcasting = false;
    }
  }, 1000);
}

/**
 * 優雅關閉：停止推播與心跳，通知所有客戶端伺服器要重啟 (1001 Going Away)，
 * 前端收到後會依退避策略自動重連。
 */
export function closeWebSocket() {
  clearInterval(pollTimer);
  clearInterval(heartbeatTimer);
  pollTimer = null;
  heartbeatTimer = null;
  if (!wss) return Promise.resolve();
  const server = wss;
  wss = null;
  for (const ws of server.clients) {
    try {
      ws.close(1001, 'Server restarting');
    } catch {
      ws.terminate();
    }
  }
  return new Promise((resolve) => {
    server.close(() => resolve());
    // 不肯完成關閉握手的客戶端，1 秒後直接切斷
    setTimeout(() => {
      for (const ws of server.clients) ws.terminate();
      resolve();
    }, 1000).unref();
  });
}
