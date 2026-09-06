import net from 'net';
import EventEmitter from 'events';

/**
 * Liquidsoap Telnet 通訊客戶端
 * 支援指令佇列、自動斷線重連與回應解析
 */
export class LiquidsoapClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || process.env.LIQUIDSOAP_HOST || '127.0.0.1';
    this.port = parseInt(options.port || process.env.LIQUIDSOAP_PORT || '1234', 10);
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.timeout = options.timeout || 5000;

    this.socket = null;
    this.isConnected = false;
    this.commandQueue = [];
    this.currentCommand = null;
    this.buffer = '';
    this.reconnectTimer = null;
  }

  connect() {
    if (this.socket) {
      this.socket.destroy();
    }

    this.socket = new net.Socket();
    this.socket.setKeepAlive(true, 5000);

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.emit('connect');
      this._processQueue();
    });

    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf-8');
      this._checkResponse();
    });

    this.socket.on('error', (err) => {
      this.emit('error', err);
      this._handleDisconnect();
    });

    this.socket.on('close', () => {
      this._handleDisconnect();
    });

    this.socket.connect(this.port, this.host);
  }

  _handleDisconnect() {
    if (this.isConnected) {
      this.isConnected = false;
      this.emit('disconnect');
    }
    if (this.currentCommand) {
      this.currentCommand.reject(new Error('Connection lost to Liquidsoap'));
      this.currentCommand = null;
    }
    this.buffer = '';

    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.reconnectInterval);
    }
  }

  _checkResponse() {
    if (!this.currentCommand) return;

    // Liquidsoap 命令回應以 "END" 結尾
    const endMatch = this.buffer.match(/(.*?)\r?\nEND\r?\n$/s);
    if (endMatch) {
      const response = endMatch[1].trim();
      const { resolve } = this.currentCommand;
      this.currentCommand = null;
      this.buffer = '';
      resolve(response);
      this._processQueue();
    }
  }

  _processQueue() {
    if (!this.isConnected || this.currentCommand || this.commandQueue.length === 0) {
      return;
    }

    this.currentCommand = this.commandQueue.shift();
    const { command, reject } = this.currentCommand;

    // 逾時處理
    const timer = setTimeout(() => {
      if (this.currentCommand && this.currentCommand.command === command) {
        this.currentCommand = null;
        reject(new Error(`Command timed out: ${command}`));
        this._processQueue();
      }
    }, this.timeout);

    const origResolve = this.currentCommand.resolve;
    this.currentCommand.resolve = (res) => {
      clearTimeout(timer);
      origResolve(res);
    };

    try {
      this.socket.write(`${command}\n`);
    } catch (err) {
      clearTimeout(timer);
      this.currentCommand = null;
      reject(err);
      this._processQueue();
    }
  }

  /**
   * 發送原始 Telnet 指令
   * @param {string} command 指令文字
   * @returns {Promise<string>} 回傳字串
   */
  sendCommand(command) {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command, resolve, reject });
      this._processQueue();
    });
  }

  /**
   * 取得 Liquidsoap 健康狀態
   */
  async getStatus() {
    try {
      const res = await this.sendCommand('radio.status');
      return res.includes('ALIVE') ? 'ALIVE' : res;
    } catch (err) {
      return `ERROR: ${err.message}`;
    }
  }

  /**
   * 取得當前串流中之 Track Metadata (優先讀取真實 on_air 請求，備援取 icecast 倒數最新區塊)
   */
  async getMetadata() {
    try {
      // 1. 優先查詢 request.on_air 取得當前精確播出的 Request ID
      try {
        const onAirRes = await this.sendCommand('request.on_air');
        const rid = onAirRes.replace(/END/g, '').trim().split(/\s+/)[0];
        if (rid && rid !== '' && !isNaN(parseInt(rid, 10))) {
          const reqMetaRes = await this.sendCommand(`request.metadata ${rid}`);
          const meta = {};
          const lines = reqMetaRes.split(/\r?\n/);
          for (const line of lines) {
            const match = line.match(/^([^=]+)="(.*)"$/);
            if (match) {
              meta[match[1]] = match[2];
            }
          }
          if (meta.title || meta.filename) {
            return meta;
          }
        }
      } catch (e) {
        // 繼續備援至輸出端解析
      }

      // 2. 備援：解析 icecast_mp3.metadata (Liquidsoap 倒數最後一個區塊 --- 1 --- 才是最新曲目)
      const res = await this.sendCommand('icecast_mp3.metadata');
      const blocks = [];
      let currentBlock = {};
      const lines = res.split(/\r?\n/);
      for (const line of lines) {
        if (line.match(/^---\s*\d+\s*---$/)) {
          if (Object.keys(currentBlock).length > 0) {
            blocks.push(currentBlock);
            currentBlock = {};
          }
          continue;
        }
        const match = line.match(/^([^=]+)="(.*)"$/);
        if (match) {
          currentBlock[match[1]] = match[2];
        }
      }
      if (Object.keys(currentBlock).length > 0) {
        blocks.push(currentBlock);
      }

      if (blocks.length > 0) {
        // 取最後一個區塊 (最新區塊 --- 1 ---)
        return blocks[blocks.length - 1];
      }
      return {};
    } catch (err) {
      return {};
    }
  }

  /**
   * 取得當前曲目剩餘時間（秒）
   */
  async getRemaining() {
    try {
      const res = await this.sendCommand('icecast_mp3.remaining');
      if (res.includes('(undef)')) {
        return null;
      }
      const val = parseFloat(res);
      return isNaN(val) ? null : val;
    } catch {
      return null;
    }
  }

  /**
   * 跳至下一首歌曲 (平滑淡出轉場，避免輸出硬切斷爆音)
   */
  async skip() {
    return await this.sendCommand('dynamic_queue.skip');
  }

  /**
   * 重新載入所有歌單資料夾
   */
  async reloadPlaylists() {
    return await this.sendCommand('radio.reload_all');
  }

  /**
   * 取得特定歌單下預計播放之曲目
   */
  async getPlaylistNext(playlistId) {
    try {
      const res = await this.sendCommand(`playlist_${playlistId.toLowerCase()}.next`);
      return res.trim();
    } catch {
      return null;
    }
  }

  /**
   * 取得伺服器運行時間
   */
  async getUptime() {
    try {
      const res = await this.sendCommand('uptime');
      return parseFloat(res) || 0;
    } catch {
      return 0;
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
  }
}

export const liquidsoap = new LiquidsoapClient();
export const sendTelnetCommand = (cmd) => liquidsoap.sendCommand(cmd);
