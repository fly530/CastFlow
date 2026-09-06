# 開源鳴謝與技術致謝 (Acknowledgements & Open Source Credits)

[English](ACKNOWLEDGEMENTS.md) | **繁體中文**

**CastFlow** 是基於開源社群技術打造的現代化雲原生（Cloud-Native）微服務廣播系統。在此特別感謝以下核心開源專案與技術社群的卓越貢獻與支援：

## 核心音訊與廣播技術 (Core Streaming & Broadcasting)

* **[Liquidsoap](https://www.liquidsoap.info/)** (GPL-2.0-or-later)
  由 Savonet 開發的強大音訊腳本語言與串流混音引擎。CastFlow 使用 Liquidsoap 實現動態排程、智慧轉場（Crossfade）、打亂播放、Telnet 控制介面以及 HLS 切片產生。
* **[Icecast](https://icecast.org/)** (GPL-2.0)
  由 Xiph.Org Foundation 維護的高效能音訊串流伺服器。在 CastFlow 中負責分發 MP3 廣播串流，為硬體播放器（例如 ESP32）提供低延遲且穩定的音訊源。

## 架構設計靈感 (Architectural Inspiration)

* **[AzuraCast](https://www.azuracast.com/)** (GPL-3.0)
  功能完備的開源電台管理軟體。CastFlow 的誕生源於對更輕量化、容器原生（Docker / K3s / Kubernetes 導向）、配置可控且模組化現代廣播系統的追求，AzuraCast 的優秀實踐給予本專案許多啟發。

## Web 播放與媒體解析 (Web Media & Utilities)

* **[hls.js](https://github.com/video-dev/hls.js/)** (Apache-2.0)
  在不依賴 Flash 與瀏覽器原生 HLS 支援（如 Chrome/Firefox 桌面版）的情況下，於現代瀏覽器中實現穩定且流暢的 HLS 音訊播放。
* **[music-metadata](https://github.com/Borewit/music-metadata)** (MIT)
  強大高效的音訊 Metadata 與 ID3 標籤解析庫，用於獲取曲目名稱、演出者與專輯封面圖片。

---

## 授權宣告與隔離架構說明 (License & Architectural Boundary)

1. **模組授權**：CastFlow 的自研後端服務 (`/server`)、管理後台 (`/frontend-admin`) 與聽眾播放器 (`/frontend-player`) 均以 **MIT License** 授權開源。
2. **容器邊界與隔離**：底層音訊引擎（Liquidsoap 與 Icecast）具有 GPL 授權相容性規範。CastFlow 採用雲原生微服務架構，各模組運行於各自獨立的 Container/Pod 中，後端僅透過標準網路協議（Telnet 介面與 HTTP JSON API）與音訊引擎進行控制與資料交換，保持架構與授權層面的乾淨隔離。
