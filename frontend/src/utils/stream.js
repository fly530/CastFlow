// 串流端點與相關小工具 (前台「硬體與外部串流指南」與後台「外部串流端點」共用)

// 與 liquidsoap/radio.liq 的 %mp3(bitrate=256) 一致；只在還沒拿到 Icecast 狀態時當預設值顯示。
// 原本前台寫 128、後台寫 256，同一個電台兩邊顯示不一樣。
export const DEFAULT_BITRATE_KBPS = 256;

export function streamEndpoints(origin = window.location.origin) {
  return {
    mp3: `${origin}/stream`,
    hls: `${origin}/hls/coolradio/live.m3u8`,
    meta: `${origin}/api/nowplaying/coolradio`
  };
}

/**
 * 複製文字到剪貼簿。navigator.clipboard 只在 HTTPS 或 localhost 存在；
 * 用區網 IP (http://192.168.x.x) 開後台時原本按「複製」完全沒反應，這裡退回舊的 execCommand 做法。
 * @returns {Promise<boolean>} 是否成功
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 權限被拒等情況：改用下面的備援
  }
  // 暫時把焦點移到隱藏的 textarea；複製完放回原處 (在對話框裡時焦點才不會掉到頁面上)
  const previous = document.activeElement;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  } finally {
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  }
}
