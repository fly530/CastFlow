import { useState, useEffect, useCallback, useRef } from 'react';

const MAX_BACKOFF_MS = 30000;

function wsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * 電台即時狀態：WebSocket 推播為主，斷線期間改用 HTTP 輪詢補位。
 *
 * 原本 AdminView / PlayerView 各自寫了一份，cleanup 時 ws.close() 之後 onclose
 * 還會再排一次重連，每切一次「自動更新」或前後台就多一條永遠不會關的連線。
 * 這裡 cleanup 會先拆掉事件處理再關閉，重連改成指數退避 (1s → 30s)，
 * 連線正常時也不再額外輪詢。
 *
 * @param {object} options
 * @param {boolean} options.enabled  false 時暫停所有更新 (後台的「即時更新」開關)
 * @param {number}  options.pollMs   WebSocket 斷線時的輪詢間隔
 * @returns {{ status: object|null, connection: 'live'|'polling'|'paused', refresh: () => Promise<void> }}
 */
export function useRadioStatus({ enabled = true, pollMs = 8000 } = {}) {
  const [status, setStatus] = useState(null);
  const [connection, setConnection] = useState(enabled ? 'polling' : 'paused');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data && mountedRef.current) setStatus(json.data);
    } catch {
      // 網路暫態錯誤：保留上一份狀態
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnection('paused');
      return undefined;
    }

    let ws = null;
    let disposed = false;
    let retryTimer = null;
    let pollTimer = null;
    let attempt = 0;

    const startPolling = () => {
      if (!pollTimer) pollTimer = setInterval(refresh, pollMs);
    };
    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = null;
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) + Math.random() * 500;
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    };

    function connect() {
      if (disposed) return;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        ws = null;
        setConnection('polling');
        startPolling();
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        attempt = 0;
        setConnection('live');
        stopPolling();
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'RADIO_STATUS' && msg.data) setStatus(msg.data);
        } catch {
          // 忽略無法解析的訊息
        }
      };
      ws.onerror = () => {
        // 之後一定會收到 onclose，由 onclose 統一處理重連
      };
      ws.onclose = () => {
        ws = null;
        if (disposed) return;
        setConnection('polling');
        startPolling();
        scheduleReconnect();
        refresh();
      };
    }

    setConnection('polling');
    refresh();
    startPolling();
    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      stopPolling();
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    };
  }, [enabled, pollMs, refresh]);

  return { status, connection, refresh };
}
