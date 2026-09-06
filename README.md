# CastFlow 📻

**English** | [繁體中文](README.zh-TW.md)

> **CastFlow** is a modern, cloud-native automated audio broadcasting and stream scheduling platform with dual Web UIs.  
> Designed for indie artists, radio station hosts, developers, and homelab enthusiasts, CastFlow delivers dual-stream outputs for both IoT hardware (ESP32, VLC) and modern web browsers (Web HLS). It features intuitive visual scheduling, auto-shuffling, hourly interstitials, and broadcast-grade smooth crossfades.

---

## Architecture

```mermaid
flowchart TD
    subgraph Storage [Persistent Storage & Shared Memory]
        MusicVol[("/music (Playlists A~G & Audio Files)")]
        DataVol[("/data (radio.db Database & System Logs)")]
        HLSTmpfs[("RAM Disk (tmpfs / emptyDir)\n(/output/hls Real-time Segments)")]
    end

    subgraph StreamingCore [Streaming Core]
        LS["Liquidsoap v2.2.5\n(Mixing, Smooth Crossfade, Dual Output)"]
        Icecast["Icecast 2.4 (Alpine)\n(MP3 Audio Broadcast Distribution)"]
    end

    subgraph Backend [Backend Control & Scheduling]
        Server["CastFlow Server (Node.js 22)\n(AutoDJ Scheduling, REST API & WebSocket)"]
        SQLite[("Embedded SQLite (WAL Mode)\n/data/radio.db")]
    end

    subgraph GatewayLayer [Unified Access Gateway]
        Gateway["CastFlow Gateway (Nginx)\n(Single Entry Point Port: 80)"]
    end

    subgraph Clients [Client Applications & Listeners]
        Listener["Web Player (React + HLS.js)\nhttp://localhost/"]
        Admin["Admin Console (React + Tailwind + JWT)\nhttp://localhost/admin/"]
        Hardware["ESP32 / Hardware Player / VLC\nhttp://localhost/stream"]
    end

    MusicVol --> LS
    LS -->|MP3 Broadcast| Icecast
    LS -->|In-Memory Writes| HLSTmpfs
    HLSTmpfs -->|"Zero-proxy direct read /hls/"| Gateway

    Server <-->|"Telnet Control (Port: 1234)"| LS
    Server <-->|JSON Stats| Icecast
    Server -->|Playlist Upload & Manage| MusicVol
    Server <-->|"Schedules / History / Auth"| SQLite
    DataVol --> SQLite

    Gateway <-->|"Reverse Proxy /api/ & /ws"| Server
    Gateway -->|"Reverse Proxy /stream"| Icecast
    Gateway -->|"Serve Frontend SPA /"| Listener
    Gateway -->|"Serve Admin SPA /admin/"| Admin
    Icecast -->|Direct Stream| Hardware
```

---

## Key Features

* ☁️ **Cloud-Native Microservices & Dual Deployment**:
  * **Docker Compose**: One-click startup in seconds for standalone servers or homelab.
  * **Kubernetes / K3s**: Production-ready YAML manifests included (Namespace isolation, PVC shared storage, dynamic ConfigMap mounting, and health probes).
* 📻 **Dual-Track Stream Output**:
  * **Icecast MP3 Stream (`/stream`)**: Direct streaming for ESP32/Arduino IoT devices and legacy players (VLC, foobar2000).
  * **Web HLS Stream (`/hls`)**: Powered by HLS.js for low-latency, stutter-free playback across all modern desktop and mobile browsers.
* ⚡ **Real-Time WebSocket Sync (`/ws`)**: Sub-second push notifications for track changes, playback progress, and listener count without polling.
* 🗄️ **Embedded SQLite Database**: Zero external database dependencies; runs WAL mode at `/data/radio.db` for playback history, custom schedule rules, and administrator credentials (isolated from `/music` to prevent conflicts during audio backups).
* 🔐 **Security & Access Control**:
  * Auto-generates a secure random administrator password upon initial boot (e.g., `cf_xxxxxx`).
  * Public endpoints (streams, status, history, album covers) are freely accessible.
  * Administrative operations (track skipping, folder reload, uploads, schedule configuration, full backup/restore) are strictly protected by JWT signatures.
* 🎛️ **Flexible AutoDJ Scheduling Engine**:
  * Supports continuous daily rotation with weighted ratios and specific time windows (including cross-midnight support).
  * Supports hourly / recurring interstitials (e.g., chime or jingle at :00 or :30 past every hour).
  * Features smooth crossfades and high-priority dynamic queue injection via Telnet.
* 🖥️ **Modern Dual Web Applications**:
  * **Listener Player**: Rotating vinyl turntable animation, dynamic album art, upcoming track queue, and keyboard shortcuts (Space to Play/Pause, F for Fullscreen).
  * **Admin Console**: Drag-and-drop playlist management (MP3/ZIP/folders), live audio preview monitoring, visual scheduling manager, real-time log inspector, and comprehensive backup/restore.

---

## Default Playlists & Scheduling Logic

Playlists A through G are preconfigured with intuitive roles:

| Directory | Role | Default Behavior |
| :--- | :--- | :--- |
| **`/music/A`** | Daily Core Rotation | **75% weight** during regular hours; 3:1 rotation ratio with Playlist B |
| **`/music/B`** | Daily Secondary Interstitial | **25% weight** during regular hours; 1 song every 3 songs from A |
| **`/music/C`** | Hourly Dedicated Interstitial | Plays 1 song at the beginning of each hour after current song finishes (`wait_track_end`) |
| **`/music/D`** | 21:30 Timed Interstitial | Smooth crossfade at 21:30 |
| **`/music/E`** | 21:40 Timed Interstitial | Smooth crossfade at 21:40 |
| **`/music/F`** | 21:50 Timed Interstitial | Smooth crossfade at 21:50 |
| **`/music/G`** | Late Night Relaxing Stream | 22:00 ~ 23:00 rotated with Playlist A at **1:1 ratio** |

* General rule: Playlists load in randomized/shuffle mode. All track transitions are protected by broadcast-grade smooth crossfading.

---

## Quick Start (Docker Compose)

### 1. Clone the repository
```bash
git clone https://github.com/fly530/CastFlow.git
cd CastFlow
```

### 2. Create `.env` (REQUIRED — compose refuses to start without it)

Generate the keys on the spot; there is nothing to invent by hand:

```bash
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
ICECAST_SOURCE_PASSWORD=$(openssl rand -hex 16)
ICECAST_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

> Do not just `cp .env.example .env` and run — it holds placeholder strings that
> the server recognises and refuses to start on. The example file documents which
> variables exist; it is not meant to be used as-is.
>
> `JWT_SECRET` signs admin credentials, so a predictable value is the same as no
> authentication at all. `ICECAST_SOURCE_PASSWORD` doubles as the password
> Liquidsoap uses to push the stream — both sides share the one key.

### 3. Start all services
```bash
docker compose up -d
```

### 4. Retrieve Initial Admin Password
On first startup, a secure administrator password is automatically created:
```bash
docker logs castflow-server | grep -E "Password|admin"
```

### 5. Service Access Endpoints (Unified via Port 80 Gateway)
* **Web Player (Listener UI)**: [http://localhost](http://localhost) (Standard Port 80)
* **Admin Dashboard (Console)**: [http://localhost/admin/](http://localhost/admin/)
* **Backend API & WebSocket Server**: `http://localhost/api` / `ws://localhost/ws` (Internal reverse proxy)
* **Icecast MP3 Stream**: `http://localhost/stream` (ESP32 / VLC / Hardware player)
* **HLS Web Stream**: `http://localhost/hls/live.m3u8`

---

## Kubernetes / K3s Deployment

Production-grade Kubernetes manifests are provided in the `k8s/` directory:

```bash
# 1. Create the namespace
kubectl apply -f k8s/00-namespace.yaml

# 2. Create the Secret (REQUIRED — the server refuses to start without it).
#    Keys are generated on the spot; they never touch a file or version control.
kubectl -n castflow create secret generic castflow-secrets \
  --from-literal=jwt-secret="$(openssl rand -hex 32)" \
  --from-literal=icecast-source-password="$(openssl rand -hex 16)" \
  --from-literal=icecast-admin-password="$(openssl rand -hex 16)"

# 3. Validate manifest syntax
kubectl apply -k k8s/ --dry-run=client

# 4. Deploy to Kubernetes cluster (default namespace: castflow)
kubectl apply -k k8s/

# 5. Read the generated initial admin password
kubectl -n castflow logs deploy/server | grep -A4 "CastFlow Security"
```

> **External access**: the Service in `70-gateway.yaml` defaults to `type: LoadBalancer`.
> On clusters without a LoadBalancer controller — K3s installed with `--disable servicelb`,
> or plain bare-metal — the EXTERNAL-IP stays `<pending>` forever and nothing can reach it.
> Switch it to `type: NodePort` and point your existing reverse proxy at that port.

> **Updating images**: the manifests use `:latest` with `imagePullPolicy: IfNotPresent`.
> Rebuilding the same tag does **not** trigger a rollout; run
> `kubectl -n castflow rollout restart deploy/server deploy/gateway`.
> Use versioned tags in production.

Included manifests:
* `00-namespace.yaml`: Creates the dedicated `castflow` namespace.
* `10-configmap.yaml`: Mounts dynamic Liquidsoap scripts (must stay byte-identical to `liquidsoap/radio.liq`; enforced in CI).
* `15-secret.yaml.example`: Secret template and generation commands. **Deliberately not `.yaml`**, so placeholder credentials can never be applied by `kubectl apply -f k8s/`.
* `20-pvc.yaml`: PersistentVolumeClaims for audio files, database, and backups (ReadWriteOnce for local-path).
* `30-icecast.yaml`: Icecast audio streaming server deployment.
* `50-service.yaml`: Core internal ClusterIP service routing (icecast & liquidsoap).
* `60-server.yaml`: Backend Node.js API server Deployment & Service.
* `70-gateway.yaml`: Unified Gateway + Liquidsoap core (Multi-container Pod sharing in-memory tmpfs emptyDir + LoadBalancer Service).
* `90-networkpolicy.yaml`: Restricts the Liquidsoap Telnet port (1234) to the `server` Pod (requires a NetworkPolicy-capable CNI).

### Scheduling runtime dependency

All scheduling decisions live in the backend Node.js AutoDJ scheduler (a 5-second tick),
which pushes tracks into Liquidsoap's `dynamic_queue` over Telnet. `radio.liq` itself only
handles the queue and crossfades — it contains no time-of-day logic. That is what makes
admin-console schedule edits take effect immediately without reloading Liquidsoap.

The trade-off: **when the `server` Pod is down, scheduling stops**. Broadcast does not go
silent (an empty `dynamic_queue` falls back to shuffling playlist A), but it quietly
degrades to A-only with no visible error. Wire `server`'s `/health` into your alerting.

---

## REST API & WebSocket Summary

| Method / Protocol | Endpoint | Authentication | Description |
| :--- | :--- | :--- | :--- |
| `WS` | `/ws` | Public | Real-time push notifications (track changes, progress, listener counts) |
| `GET` | `/health` | Public | Server health status & Telnet connection probe |
| `GET` | `/api/status` | Public | Unified broadcast status (now playing, progress, listeners, stats) |
| `GET` | `/api/history` | Public | Recent playback history (SQLite) |
| `GET` | `/api/current/cover`| Public | Album artwork image for currently playing track |
| `POST`| `/api/auth/login` | Public | Admin login endpoint returning JWT token |
| `GET` | `/api/auth/me` | JWT Required | Returns current authenticated administrator info |
| `POST`| `/api/auth/change-password` | JWT Required | Change administrator password |
| `POST`| `/api/control/skip` | JWT Required | Skip currently playing track |
| `POST`| `/api/control/reload` | JWT Required | Force reload of all playlist audio folders |
| `POST`| `/api/control/telnet` | JWT Required | Execute raw Liquidsoap Telnet commands |
| `GET` | `/api/playlists` | Public | List all playlists and track counts |
| `GET` | `/api/playlists/:id/tracks` | Public | List tracks and ID3 metadata for a playlist |
| `POST`| `/api/playlists/:id/upload` | JWT Required | Upload MP3/ZIP/folders to a playlist |
| `DELETE`| `/api/playlists/:id/tracks/:filename` | JWT Required | Delete a track from a playlist |
| `GET` | `/api/schedules` | Public | Retrieve all visual scheduling rules |
| `POST`| `/api/schedules` | JWT Required | Create a new scheduling rule (continuous or recurring) |
| `PUT` | `/api/schedules/:id` | JWT Required | Update an existing scheduling rule |
| `DELETE`| `/api/schedules/:id` | JWT Required | Delete a scheduling rule |
| `GET` | `/api/backup/export` | JWT Required | Export configuration backup (JSON) |
| `GET` | `/api/backup/export-full` | JWT Required | Export full station backup (ZIP with all MP3s) |
| `POST`| `/api/backup/restore` | JWT Required | Restore station data from backup |

---

## License, Acknowledgements & Disclaimer

* **License**: Custom application code is licensed under the [MIT License](LICENSE).
* **Open Source Software Disclosures**: Detailed list of upstream open-source software (Liquidsoap, Icecast, Nginx, React, HLS.js, SQLite, etc.) and architectural container boundaries are documented in [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).
* **Legal & Copyright Disclaimer**: Complete legal disclaimer regarding audio copyright ownership, public performance broadcast compliance, and "AS IS" software liability is provided in [DISCLAIMER.md](DISCLAIMER.md).
