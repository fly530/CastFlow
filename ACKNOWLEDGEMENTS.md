# Acknowledgements & Open Source Credits

**English** | [繁體中文](ACKNOWLEDGEMENTS.zh-TW.md)

**CastFlow** is built upon the incredible work of the open source community. We would like to extend our deepest gratitude to the following projects and maintainers for their foundational contributions:

## Core Audio Streaming & Broadcasting

* **[Liquidsoap](https://www.liquidsoap.info/)** (GPL-2.0-or-later)  
  Developed by the Savonet team. Liquidsoap is a versatile audio processing language and streaming engine. In CastFlow, it powers dynamic AutoDJ scheduling, smooth crossfades, playlist shuffling, Telnet remote control, and HLS segment generation.
* **[Icecast](https://icecast.org/)** (GPL-2.0)  
  Maintained by the Xiph.Org Foundation. Icecast serves as the high-performance audio broadcasting server in CastFlow, delivering standard MP3 streams to IoT hardware devices (such as ESP32) and legacy audio players.

## Architectural Inspiration

* **[AzuraCast](https://www.azuracast.com/)** (GPL-3.0)  
  A full-featured open-source radio station management suite. CastFlow was inspired by the desire for a lighter, container-native (Docker Compose & Kubernetes-oriented), highly modular, and modern audio broadcast platform. AzuraCast's design provided invaluable insights.

## Web Media & Utilities

* **[hls.js](https://github.com/video-dev/hls.js/)** (Apache-2.0)  
  Enables reliable, low-latency HLS audio streaming in modern desktop and mobile browsers without requiring native platform HLS support.
* **[music-metadata](https://github.com/Borewit/music-metadata)** (MIT)  
  An efficient, pure-TypeScript metadata parser used by CastFlow Server to extract ID3 tags, artist names, track titles, and embedded album art.

---

## Licensing & Architectural Isolation

1. **Application Code**: CastFlow's custom backend services (`/server`), admin console (`/frontend-admin`), and listener web player (`/frontend-player`) are released under the permissive **MIT License**.
2. **Container Boundary & Isolation**: The underlying audio engines (Liquidsoap and Icecast) are subject to GPL licensing terms. CastFlow follows a microservice container architecture where each component runs inside isolated containers or pods. The backend interacts with the streaming engine solely via standard network protocols (Telnet TCP interface and HTTP JSON APIs), preserving legal and architectural isolation.
