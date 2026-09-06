# CastFlow - Technical Specifications for Developers & AI Agents

**English** | [繁體中文](project-context.md)

## 1. Project Overview
CastFlow is a modern, lightweight, cloud-native automated radio broadcasting and stream scheduling platform equipped with dual Web UIs.
It is engineered to provide developers, station administrators, and homelab hobbyists with a highly customizable, low-resource audio broadcasting architecture. It supports dual-stream outputs for IoT hardware (ESP32 / VLC) and modern browsers (Web HLS), with precision scheduling, dynamic shuffling, and broadcast-grade smooth crossfading.

## 2. Core Architecture
Based on a microservice architecture, CastFlow can be operated locally via Docker Compose or deployed onto K3s/Kubernetes clusters (isolated within the `castflow` namespace):

### Audio Engine Core:
* **Icecast 2.4**: Responsible for audio distribution (MP3 stream output for ESP32 and external players).
* **Liquidsoap v2.2.5**: Core audio processing engine. Manages MP3 loading, dynamic scheduling, crossfades, playlist shuffling, HLS segment creation, and pushing MP3 streams to Icecast. Exposes a Telnet port for Node.js control.
* **Nginx HLS**: Distributes HLS m3u8 playlists and audio segments with CORS enabled.

### Backend API Server:
* Interacts with Liquidsoap via Telnet to send control commands and read real-time status (metadata, queue, remaining, skip, reload).
* Queries Icecast JSON statistics for listener metrics.
* Handles file uploads (MP3 / ZIP recursive extraction), playlist organization, visual schedule configuration, and station backup/restore.
* Embedded SQLite with WAL mode persists admin credentials (JWT), playback history, and scheduling rules.
* Sub-second WebSocket (`/ws`) broadcast push service.

### Admin Dashboard:
* Built with React, TailwindCSS, and Lucide Icons.
* Features drag-and-drop file uploads, playlist management, visual schedule CRUD, audio preview monitoring, real-time log inspector, and password management.

### Listener Player:
* Built with React and HLS.js.
* Features vinyl turntable animation, dynamic album art, track progress bar, upcoming track queue, and keyboard shortcuts.

## 3. Tech Stack
* **Infrastructure**: Docker Compose / Kubernetes (K3s), modular YAMLs (namespace, pvc, configmap, deployment, service).
* **Streaming Core**: `savonet/liquidsoap:v2.2.5`, `libretime/icecast:2.4.4-alpine`.
* **Backend API**: Node.js (Express), SQLite (better-sqlite3 WAL), WebSocket (`ws`), JWT (`jsonwebtoken`), `music-metadata`.
* **Frontend**: React 18, Vite, TailwindCSS, Lucide Icons, HLS.js.
* **Licensing**: Custom frontend and backend code is released under the MIT License; GPL components are isolated across container boundaries.

## 4. Key Scheduling Rules
* **Daily Rotation**: Playlist A and B rotate at a 3:1 ratio.
* **Hourly Interstitial**: Plays 1 track from Playlist C at the top of the hour after the current song completes.
* **Night Stream**: 22:00 ~ 23:00 rotates Playlist A and G at a 1:1 ratio.
* **General Behavior**: Playlists load in randomized/shuffled order; all track transitions are protected by smooth crossfading to prevent audio clipping.

## 5. Directory Structure
```plaintext
/k8s                  # K3s / Kubernetes manifests (00-namespace through 80-admin)
/gateway              # Unified Nginx Gateway & reverse proxy service
/server               # Backend API & WebSocket service (Node.js)
/frontend             # Unified Frontend (React + TailwindCSS + HLS.js, dual view switcher)
/liquidsoap           # Liquidsoap radio.liq core script
/music                # Shared audio storage (A~G playlists, SQLite radio.db, backups)
docker-compose.yml    # Local development & standalone production compose
```
