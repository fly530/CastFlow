// hls.js 約占前台 bundle 的一半：改成需要時才下載，播放器頁面先畫出來再載。
// 用 light 版：只少了字幕、DRM、多音軌、CMCD 這些我們用不到的功能，單一 AAC 直播串流不受影響。
// 下載失敗 (離線、被擋) 時清掉快取的 Promise，下次還能重試。
let hlsPromise = null;

export function loadHls() {
  if (!hlsPromise) {
    hlsPromise = import('hls.js/light')
      .then((mod) => mod.default)
      .catch((err) => {
        hlsPromise = null;
        throw err;
      });
  }
  return hlsPromise;
}
