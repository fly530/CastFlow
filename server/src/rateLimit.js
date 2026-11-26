/**
 * 記憶體內的固定視窗計數器 (單一 Node 行程，不需要 Redis)。
 *
 * 用在登入與聽眾端日誌回報：key 通常是 req.ip (需要 app 的 trust proxy 設定正確，
 * 否則經過 nginx 之後所有人都是同一個 IP)。key 數量有上限，避免偽造大量來源把記憶體撐爆。
 *
 * @param {object} options
 * @param {number} options.windowMs 視窗長度
 * @param {number} options.max      視窗內允許的次數
 * @param {number} [options.maxKeys] 同時追蹤的 key 上限
 */
export function createRateLimiter({ windowMs, max, maxKeys = 10000 }) {
  const hits = new Map(); // key -> { count, resetAt }

  function prune(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return {
    /**
     * 記一次並回報是否超過上限。先記再判斷：同時湧入的請求不會全部在「還沒記到」之前通過。
     * @returns {{ limited: boolean, retryAfterSec: number }}
     */
    hit(key, now = Date.now()) {
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        if (hits.size >= maxKeys) {
          prune(now);
          // 仍然滿：丟掉最舊的 (Map 依插入順序)
          if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
        }
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return {
        limited: entry.count > max,
        retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
      };
    },
    reset(key) {
      hits.delete(key);
    },
    clear() {
      hits.clear();
    }
  };
}
