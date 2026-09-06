# Open Source Software Disclosures & Acknowledgements

**English** | [繁體中文](ACKNOWLEDGEMENTS.zh-TW.md)

**CastFlow** is an open-source project that stands on the shoulders of the global open-source community. We gratefully acknowledge and credit the following open-source projects, libraries, and maintainers that power the CastFlow platform:

---

## 1. Core Streaming & Audio Engines

| Project | Organization / Maintainer | License | Role & Purpose |
| :--- | :--- | :--- | :--- |
| **[Liquidsoap](https://www.liquidsoap.info/)** | Savonet Team | GPL-2.0-or-later | Core audio script language and streaming engine. Powers dynamic AutoDJ scheduling, smooth crossfading, playlist shuffling, Telnet control interface, and HLS segment generation. |
| **[Icecast](https://icecast.org/)** | Xiph.Org Foundation | GPL-2.0 | High-performance audio broadcasting server. Distributes standard MP3 audio streams for IoT hardware players (ESP32, VLC, foobar2000). |
| **[Nginx](https://nginx.org/)** | NGINX, Inc. | 2-Clause BSD-like | High-performance HTTP server delivering Web HLS playlist segments with CORS headers enabled. |

---

## 2. Backend Runtime & Libraries

| Library | License | Description |
| :--- | :--- | :--- |
| **[Node.js](https://nodejs.org/)** | MIT | Backend asynchronous microservice runtime environment |
| **[Express](https://expressjs.com/)** | MIT | Fast, unopinionated REST API framework |
| **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** | MIT | High-performance SQLite driver utilizing WAL mode for low-latency persistence |
| **[ws](https://github.com/websockets/ws)** | MIT | Real-time WebSocket broadcasting engine for sub-second status sync |
| **[music-metadata](https://github.com/Borewit/music-metadata)** | MIT | Pure-TypeScript audio metadata and ID3v2 tag parser for artwork and track info |
| **[jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)** | MIT | Secure JWT authentication token implementation for administrator controls |
| **[bcryptjs](https://github.com/dcodeIO/bcrypt.js)** | MIT | One-way salted password hashing library |
| **[multer](https://github.com/expressjs/multer)** | MIT | Multipart form-data handling middleware for file and archive uploads |

---

## 3. Web Frontend Stack

| Library | License | Description |
| :--- | :--- | :--- |
| **[React](https://react.dev/)** | MIT | Declarative UI library powering both Listener Player and Admin Dashboard |
| **[Vite](https://vitejs.dev/)** | MIT | Next-generation frontend tooling and hot module replacement |
| **[HLS.js](https://github.com/video-dev/hls.js/)** | Apache-2.0 | Enables robust, low-latency HLS audio streaming across modern web browsers |
| **[Tailwind CSS](https://tailwindcss.com/)** | MIT | Utility-first CSS framework for custom responsive interfaces |
| **[Lucide React](https://lucide.dev/)** | ISC | Modern, customizable SVG icon library |
| **[clsx](https://github.com/lukeed/clsx) & [tailwind-merge](https://github.com/dcastil/tailwind-merge)** | MIT | Utilities for conditional class name combination without style collisions |

---

## 4. Licensing Boundary & Container Isolation

1. **Original Application Code**: CastFlow's custom backend services (`/server`) and unified frontend (`/frontend`) are distributed under the **MIT License**.
2. **Container Boundary & Isolation**: The underlying audio engines (Liquidsoap and Icecast) are subject to GPL licensing terms. CastFlow follows a strict cloud-native microservice pattern where every component executes inside isolated containers or Kubernetes pods. Communication between the backend and audio engine occurs solely via standard network protocols (Telnet TCP interface and HTTP JSON APIs), ensuring clean legal and architectural separation.
3. **Legal Disclaimer**: For terms regarding audio copyright liability, public broadcast performance licensing, and software warranties, please refer to [DISCLAIMER.md](DISCLAIMER.md).
