# 開源軟體宣告與致謝 (Open Source Disclosures & Acknowledgements)

[English](ACKNOWLEDGEMENTS.md) | **繁體中文**

**CastFlow** 是一個自研開源專案，深深受益於全球開源社群的技術累積。在此特別向以下為 CastFlow 提供核心驅動力與技術基礎的開源專案與維護者致上誠摯的感謝：

---

## 1. 核心串流與廣播引擎 (Core Streaming Engines)

| 開源專案 | 主要作者 / 組織 | 授權條款 | 角色與用途 |
| :--- | :--- | :--- | :--- |
| **[Liquidsoap](https://www.liquidsoap.info/)** | Savonet Team | GPL-2.0-or-later | 核心音訊腳本語言與混音引擎。負責動態排程、智慧轉場淡入淡出（Crossfade）、打亂播放、Telnet 控制介面以及 HLS 切片產生。 |
| **[Icecast](https://icecast.org/)** | Xiph.Org Foundation | GPL-2.0 | 高效能音訊廣播分發伺服器。在 CastFlow 中負責分發標準 MP3 廣播串流，為硬體播放器（ESP32 / VLC）提供低延遲且穩定的音訊源。 |
| **[Nginx](https://nginx.org/)** | NGINX, Inc. | 2-Clause BSD-like | 高效能 Web 伺服器。用於對現代瀏覽器提供 Web HLS 切片分發與跨來源資源共用（CORS）標頭。 |

---

## 2. 後端通訊與核心庫 (Backend Runtime & Libraries)

| 開源庫 | 授權條款 | 用途說明 |
| :--- | :--- | :--- |
| **[Node.js](https://nodejs.org/)** | MIT | 後端微服務執行環境 |
| **[Express](https://expressjs.com/)** | MIT | 輕量且靈活的後端 RESTful API 路由框架 |
| **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** | MIT | 高效能同步 SQLite 驅動，啟用 WAL 模式實現低延遲持久化 |
| **[ws](https://github.com/websockets/ws)** | MIT | 毫秒級雙向即時廣播推播引擎 |
| **[music-metadata](https://github.com/Borewit/music-metadata)** | MIT | 音訊 ID3v2 標籤、演出者、專輯名稱與內嵌專輯封面解析庫 |
| **[jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)** | MIT | 管理員權限驗證之安全 JWT 簽名與鑑權工具 |
| **[bcryptjs](https://github.com/dcodeIO/bcrypt.js)** | MIT | 安全單向雜湊密碼加密函式庫 |
| **[multer](https://github.com/expressjs/multer)** | MIT | 處理多檔案、資料夾與 ZIP 上傳中介軟體 |

---

## 3. Web 前端界面技術棧 (Web Frontend Stack)

| 開源庫 | 授權條款 | 用途說明 |
| :--- | :--- | :--- |
| **[React](https://react.dev/)** | MIT | 管理後台與聽眾前台之宣告式 UI 建構框架 |
| **[Vite](https://vitejs.dev/)** | MIT | 下一代極速前端建置與模組熱重載工具 |
| **[HLS.js](https://github.com/video-dev/hls.js/)** | Apache-2.0 | 於現代瀏覽器實現低延遲、無卡頓之 HLS 音訊串流播放 |
| **[Tailwind CSS](https://tailwindcss.com/)** | MIT | 現代化實用導向 CSS 樣式框架 |
| **[Lucide React](https://lucide.dev/)** | ISC | 精美現代化 SVG 圖標庫 |
| **[clsx](https://github.com/lukeed/clsx) & [tailwind-merge](https://github.com/dcastil/tailwind-merge)** | MIT | 動態 Tailwind 類別合併與衝突處理工具 |

---

## 4. 架構設計靈感 (Inspiration)

* **[AzuraCast](https://www.azuracast.com/)** (GPL-3.0)  
  功能完備的成熟開源電台管理軟體。CastFlow 源於對更輕量化、容器原生（Docker Compose / K3s / Kubernetes 導向）、配置完全透明可控且高度模組化的廣播架構之追求，AzuraCast 的優秀實踐給予本專案許多啟發。

---

## 5. 授權邊界與容器隔離說明 (License & Architectural Boundary)

1. **自研程式碼**：CastFlow 自行研發之應用層程式碼，包含後端服務（`/server`）、管理面板（`/frontend-admin`）與聽眾播放器（`/frontend-player`）均以 **MIT License** 授權開源。
2. **容器邊界與隔離**：底層音訊引擎（Liquidsoap 與 Icecast）具有 GPL 授權相容性規範。CastFlow 嚴格遵循雲原生微服務標準，所有模組運行於各自獨立的容器（Container）或 Pod 中。後端僅透過標準 TCP 網路協議（Telnet 介面與 HTTP JSON API）調用廣播引擎，保持架構與授權層面的乾淨隔離。
3. **法律免責**：關於音訊內容版權責任、公播授權與軟體無擔保條款，請詳閱 [DISCLAIMER.zh-TW.md](DISCLAIMER.zh-TW.md)。
