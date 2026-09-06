# ==============================================================================
# CastFlow - Liquidsoap v2.2.5 廣播排程與混音核心腳本
# ==============================================================================

# 1. 系統日誌與控制介面設定
settings.log.level.set(3)
settings.log.file.set(false)
settings.log.stdout.set(true)

# 開啟 Telnet 控制介面 (供後端 Node.js API 查詢元資料、剩餘時間、控制切歌等)
settings.server.telnet.set(true)
settings.server.telnet.port.set(1234)
settings.server.telnet.bind_addr.set("0.0.0.0")

# 2. 環境變數讀取
music_dir    = environment.get(default="/music", "MUSIC_DIR")
icecast_host = environment.get(default="icecast", "ICECAST_HOST")
icecast_port = int_of_string(default=8000, environment.get(default="8000", "ICECAST_PORT"))
icecast_pass = environment.get(default="hackme", "ICECAST_PASSWORD")
icecast_mount= environment.get(default="stream", "ICECAST_MOUNT")
hls_dir      = environment.get(default="/output/hls", "HLS_DIR")

# 3. 動態待播佇列 (優先播放源)
# 【單一事實來源原則 Single Source of Truth】：
# 所有業務排程 (權重輪播、整點插播、閉店前倒數、間隔插播) 皆由 SQLite 資料庫
# 與後端 Node.js AutoDJ 智慧排程器統一決策，並透過 Telnet 推送至此佇列。
dynamic_queue = request.queue(id="dynamic_queue")

# 4. 保底安全音訊源 (Safety Fallback)
# 當 Node.js 伺服器冷啟動、重啟或佇列短暫為空時自動接管，防止電台斷流空轉。
fallback_stream = playlist(id="fallback_stream", reload_mode="watch", mode="randomize", "#{music_dir}/A")

# 混合排程：優先播放動態佇列，若隊列為空自動無縫切換至保底音源
mixed_stream = fallback(track_sensitive=true, [dynamic_queue, fallback_stream])

# 5. 平滑淡入淡出轉場 (crossfade with smooth envelope & anti-clipping)
faded_stream = crossfade(
  smart=false,
  duration=3.0,
  fade_in=1.5,
  fade_out=2.5,
  conservative=true,
  mixed_stream
)

# 透過廣播級 Limiter 限制器防止淡入淡出時雙軌疊加音量超過 0dBFS 導致數位爆音
limited_radio = limit(threshold=-1.0, attack=20.0, release=150.0, faded_stream)

# 確保輸出安全（若暫無音樂自動補靜音，防止廣播程序崩潰）
final_radio = mksafe(limited_radio)

# 6. 自訂註冊 Telnet 指令 (提供後端管理面板查詢與調用)
server.register(namespace="radio", description="取得廣播伺服器運作狀態", "status", fun (_) -> "ALIVE")
server.register(namespace="radio", description="平滑淡出切換至下一首曲目 (無爆音)", "skip", fun (_) -> begin
  dynamic_queue.skip()
  "OK: Skipped dynamic queue"
end)
server.register(namespace="radio", description="強制重新載入保底歌單資料夾", "reload_all", fun (_) -> begin
  fallback_stream.reload()
  "OK: Fallback stream reloaded"
end)

# 7. 雙軌輸出 (Dual Output)
# 7.1 Icecast MP3 串流 (供 ESP32 硬體或傳統廣播接收器使用)
output.icecast(
  %mp3(bitrate=256),
  id="icecast_mp3",
  host=icecast_host,
  port=icecast_port,
  password=icecast_pass,
  mount=icecast_mount,
  name="CastFlow Live Stream",
  description="Cloud-Native CastFlow MP3 Stream for Hardware and Web",
  genre="Various",
  url="https://github.com/fly530/CastFlow",
  final_radio
)

# 7.2 Web HLS 串流 (產生 m3u8 與切片，供前端現代瀏覽器播放)
output.file.hls(
  id="hls_web",
  playlist="live.m3u8",
  segment_duration=4.0,
  segments=8,
  segments_overhead=6,
  temp_dir=hls_dir,
  hls_dir,
  [("live", %ffmpeg(format="mpegts", %audio(codec="aac", b="256k")))],
  final_radio
)
