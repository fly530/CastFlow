/**
 * Icecast 統計資料獲取模組
 */
export class IcecastClient {
  constructor(options = {}) {
    this.host = options.host || process.env.ICECAST_HOST || '127.0.0.1';
    this.port = parseInt(options.port || process.env.ICECAST_PORT || '8000', 10);
    this.mount = options.mount || process.env.ICECAST_MOUNT || 'stream';
  }

  get statsUrl() {
    return `http://${this.host}:${this.port}/status-json.xsl`;
  }

  /**
   * 取得 Icecast 即時數據（在線聽眾、位元率、掛載狀態）
   */
  async getStats() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(this.statsUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return { online: false, error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      const icestats = data?.icestats;
      if (!icestats) {
        return { online: false, error: 'Malformed icestats JSON' };
      }

      let source = icestats.source;
      if (Array.isArray(source)) {
        source = source.find((s) => s.listenurl?.endsWith(`/${this.mount}`)) || source[0];
      }

      if (!source) {
        return {
          online: true,
          serverVersion: icestats.server_id,
          streamActive: false,
          listeners: 0,
          listenerPeak: 0
        };
      }

      return {
        online: true,
        serverVersion: icestats.server_id,
        streamActive: true,
        mount: this.mount,
        listeners: source.listeners ?? 0,
        listenerPeak: source.listener_peak ?? 0,
        bitrate: source.bitrate ?? 256,
        serverName: source.server_name ?? '',
        serverDescription: source.server_description ?? '',
        streamStart: source.stream_start_iso8601 ?? source.stream_start ?? null,
        audioInfo: source.audio_info ?? '',
        title: source.title ?? null
      };
    } catch (err) {
      return {
        online: false,
        error: err.name === 'AbortError' ? 'Request timed out' : err.message
      };
    }
  }
}

export const icecast = new IcecastClient();
