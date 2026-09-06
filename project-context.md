# CastFlow - 開發者與 AI Agent 技術規格書

[English](project-context.en.md) | **繁體中文**

## 1. 專案概述 (Project Overview)
本專案為一個現代化、輕量、雲原生（Cloud-Native）、且具備雙前端 Web UI 的自動化廣播電台與排程串流平台。
旨在提供開發者、站長與自架愛好者一個可高度客製化且資源佔用極低的廣播架構。系統支援物聯網硬體播放器（ESP32 / VLC）與現代瀏覽器（Web HLS）的雙軌串流輸出，並具備精準的排程插播、打亂與廣播級智慧淡入淡出（Crossfade）功能。

## 2. 核心架構 (Core Architecture)
本系統基於雲原生微服務架構，主要分為四個核心模組，可透過 Docker Compose 本地運行或部署於 K3s/Kubernetes 叢集（隔離於 `castflow` 命名空間內）：

### 廣播引擎底層 (Streaming Engine):
* **Icecast 2.4**：負責音訊串流分發（輸出 MP3 供 ESP32 / 外部播放器使用）。
* **Liquidsoap v2.2.5**：核心音訊處理引擎。負責讀取 MP3、動態排程、轉場淡入淡出、打亂歌單、產生 HLS 切片，並將 MP3 串流推給 Icecast。開啟 Telnet 埠供後端 Node.js 控制。
* **Nginx HLS**：提供 Web HLS 切片與 CORS 標頭。

### 後端 API 伺服器 (Backend API):
* 與 Liquidsoap 的 Telnet 介面溝通，發送控制指令與獲取即時狀態（metadata, queue, remaining, skip, reload）。
* 從 Icecast 獲取 JSON 聽眾統計資料。
* 處理前端的 MP3 檔案/ZIP 解壓上傳、歌單管理、智慧排程配置、全站備份與還原。
* 內嵌 SQLite (WAL 模式)，持久化管理員帳號 (JWT)、播放歷史與排程規則。
* 毫秒級 WebSocket (`/ws`) 廣播推播服務。

### 管理者前端面板 (Admin UI):
* 基於 React + TailwindCSS + Lucide Icons。
* 提供拖曳式檔案上傳、歌單管理、視覺化排程增刪改查、即時音訊監聽切換、即時系統日誌與密碼修改。

### 聽眾播放器前端 (Player UI):
* 基於 React + HLS.js。
* 擬真黑膠唱片旋轉封面、當前歌名/演出者、動態播放進度條、即將播放佇列 (Upcoming Tracks) 與鍵盤快捷鍵。

## 3. 技術棧 (Tech Stack)
* **基礎設施**：Docker Compose / Kubernetes (K3s)，標準分離 YAML（namespace, pvc, configmap, deployment, service）。
* **廣播底層**：`savonet/liquidsoap:v2.2.5` (排程與混音核心), `libretime/icecast:2.4.4-alpine` (MP3 串流廣播分發)。
* **後端 API**：Node.js (Express), SQLite (better-sqlite3 WAL), WebSocket (`ws`), JWT (`jsonwebtoken`), `music-metadata`。
* **前端 UI**：React 18, Vite, TailwindCSS, Lucide Icons, HLS.js。
* **授權**：自研前端與後端採用 MIT 授權開源；底層 GPL 組件於容器邊界隔離。

## 4. 關鍵排程規則 (Scheduling Rules)
* **日常時段**：A 歌單與 B 歌單依 3:1 比例輪替（rotate）。
* **每小時循環**：整點等待目前歌曲播完，插播 1 首 C 歌單。
* **夜間時段**：22:00 ~ 23:00，A 歌單與 G 歌單以 1:1 輪替。
* **通用原則**：歌單以打亂（shuffle）模式載入，曲目切換皆等待前曲播畢並通過平滑淡入淡出（crossfade）防爆音保護。

## 5. 專案目錄結構 (Directory Structure)
```plaintext
/k8s                  # K3s / Kubernetes 部署 YAML (00-namespace 至 80-admin)
/gateway              # 統一 Nginx 網關與反向代理服務
/server               # 後端 API 與 WebSocket 服務 (Node.js)
/frontend             # 單一統合前端 (React + TailwindCSS + HLS.js，雙視圖切換)
/liquidsoap           # Liquidsoap radio.liq 核心腳本
/music                # 共享音訊資料夾 (A~G 歌單、SQLite radio.db、backups)
docker-compose.yml    # 本地開發與單機生產環境配置
```
