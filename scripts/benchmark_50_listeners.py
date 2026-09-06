#!/usr/bin/env python3
"""
CastFlow 50 用戶並發串流壓測與硬體/流量監測工具
- 模擬 50 個真實音訊客戶端連線至 Icecast MP3 串流 (/stream)
- 解析 HTTP 標頭、持續接收並緩存音訊串流 60 秒
- 即時記錄與統計 50 個客戶端接收位元組數、平均頻寬與延遲
- 壓測前後與壓測中採集 Docker 容器硬體資源 (CPU / RAM / 網路流量 NET I/O)
- 產出完整壓測分析報告
"""

import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request

STREAM_HOST = os.environ.get("STREAM_HOST", "127.0.0.1")
STREAM_PORT = int(os.environ.get("STREAM_PORT", "8000"))
STREAM_PATH = os.environ.get("STREAM_PATH", "/stream")
NUM_CLIENTS = int(os.environ.get("CLIENTS", "50"))
DURATION_SECONDS = int(os.environ.get("DURATION", "60"))

def get_docker_stats():
    """取得目前所有 CastFlow 容器的 CPU、RAM、NET I/O 狀態"""
    try:
        cmd = ["docker", "stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"]
        output = subprocess.check_output(cmd, text=True, timeout=5)
        stats = {}
        for line in output.strip().split("\n"):
            parts = line.split("\t")
            if len(parts) >= 4 and (parts[0].startswith("castflow") or parts[0].startswith("kuberadio")):
                stats[parts[0]] = {
                    "cpu": parts[1],
                    "mem": parts[2],
                    "net": parts[3]
                }
        return stats
    except Exception as e:
        return {}

def get_icecast_stats():
    """查詢 Icecast 伺服器端回報的即時在線聽眾與位元率"""
    try:
        url = f"http://{STREAM_HOST}:{STREAM_PORT}/status-json.xsl"
        req = urllib.request.Request(url, headers={"User-Agent": "CastFlowBenchmark/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            source = data.get("icestats", {}).get("source", {})
            if isinstance(source, list):
                source = source[0] if source else {}
            return {
                "listeners": source.get("listeners", 0),
                "listener_peak": source.get("listener_peak", 0),
                "bitrate": source.get("bitrate", 0),
                "title": source.get("title", "")
            }
    except Exception:
        return {"listeners": 0, "listener_peak": 0, "bitrate": 0, "title": "N/A"}

async def simulate_audio_client(client_id, stop_event, results):
    """模擬單一聽眾客戶端：建立連線、解析 HTTP 標頭、持續緩存與接收 MP3 音訊串流"""
    client_result = {
        "id": client_id,
        "status": "pending",
        "bytes_received": 0,
        "connect_time_ms": 0,
        "error": None
    }
    results[client_id] = client_result

    start_time = time.time()
    reader = None
    writer = None

    try:
        # 1. 建立 TCP 連線
        t0 = time.time()
        reader, writer = await asyncio.open_connection(STREAM_HOST, STREAM_PORT)
        client_result["connect_time_ms"] = round((time.time() - t0) * 1000, 2)

        # 2. 發送 HTTP GET 串流請求 (模擬瀏覽器音訊播放器)
        request = (
            f"GET {STREAM_PATH} HTTP/1.1\r\n"
            f"Host: {STREAM_HOST}:{STREAM_PORT}\r\n"
            f"User-Agent: Mozilla/5.0 (Client {client_id}) CastFlowPlayer/1.0\r\n"
            f"Accept: */*\r\n"
            f"Icy-MetaData: 1\r\n"
            f"Connection: close\r\n\r\n"
        )
        writer.write(request.encode("utf-8"))
        await writer.drain()

        # 3. 解析 HTTP 狀態標頭 (HTTP/1.0 200 OK)
        status_line = await reader.readline()
        if not status_line or b"200" not in status_line:
            client_result["status"] = "failed"
            client_result["error"] = f"Invalid status: {status_line.decode('utf-8', 'ignore').strip()}"
            return

        # 讀取並忽略其餘標頭，直到遇到空行
        while True:
            header_line = await reader.readline()
            if not header_line or header_line == b"\r\n" or header_line == b"\n":
                break

        client_result["status"] = "streaming"

        # 4. 持續接收並緩存串流音訊封包 (模擬緩存與播放)
        buffer_chunk_size = 4096
        while not stop_event.is_set():
            try:
                # 設定 2 秒讀取超時
                data = await asyncio.wait_for(reader.read(buffer_chunk_size), timeout=2.0)
                if not data:
                    break
                client_result["bytes_received"] += len(data)
            except asyncio.TimeoutError:
                if stop_event.is_set():
                    break
            except Exception as e:
                client_result["error"] = str(e)
                break

        client_result["status"] = "completed"

    except Exception as e:
        client_result["status"] = "error"
        client_result["error"] = str(e)
    finally:
        if writer:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

async def monitor_progress(stop_event, results, duration):
    """定時監測壓測進度、Icecast 聽眾數與統計數據"""
    t_start = time.time()
    last_reported_sec = 0

    while not stop_event.is_set():
        elapsed = int(time.time() - t_start)
        if elapsed >= duration:
            break

        if elapsed - last_reported_sec >= 5:
            last_reported_sec = elapsed
            total_bytes = sum(r["bytes_received"] for r in results.values())
            active_count = sum(1 for r in results.values() if r["status"] == "streaming")
            mb = total_bytes / (1024 * 1024)
            # 即時頻寬 (Mbps)
            cur_mbps = (total_bytes * 8 / (1024 * 1024)) / max(elapsed, 1)
            ice_stats = get_icecast_stats()

            print(
                f"  [{elapsed:2d}s / {duration}s] "
                f"客戶端在線: {active_count:2d}/{NUM_CLIENTS} | "
                f"Icecast 端回報聽眾: {ice_stats['listeners']:2d} 人 | "
                f"累計接收: {mb:6.2f} MB ({cur_mbps:5.2f} Mbps)"
            )

        await asyncio.sleep(1)

async def main():
    print("=" * 72)
    print(f"🚀 CastFlow 壓測開始: 模擬 {NUM_CLIENTS} 位使用者同時連線並接收串流 {DURATION_SECONDS} 秒")
    print(f"   目標端點: http://{STREAM_HOST}:{STREAM_PORT}{STREAM_PATH}")
    print("=" * 72)

    # 1. 採集基準數據 (壓測前)
    print("\n[步驟 1/4] 採集壓測前的基準硬體資源使用量 (Baseline)...")
    baseline_stats = get_docker_stats()
    baseline_ice = get_icecast_stats()
    print(f"  目前 Icecast 在線聽眾數: {baseline_ice['listeners']} 人 (位元率: {baseline_ice['bitrate']} kbps)")

    # 2. 建立 50 個客戶端協程
    print(f"\n[步驟 2/4] 啟動 {NUM_CLIENTS} 個用戶端同時建立 TCP 連線與緩存播放...")
    stop_event = asyncio.Event()
    results = {}
    tasks = []

    # 錯開極微小毫秒避免 SYN flood 本機拒絕，更符合真實 50 人陸續加入
    for i in range(1, NUM_CLIENTS + 1):
        task = asyncio.create_task(simulate_audio_client(i, stop_event, results))
        tasks.append(task)
        await asyncio.sleep(0.02)

    # 3. 監控中途狀態 (壓測中)
    print(f"\n[步驟 3/4] 壓測進行中 (預計執行 {DURATION_SECONDS} 秒)...")
    monitor_task = asyncio.create_task(monitor_progress(stop_event, results, DURATION_SECONDS))

    # 等待滿 60 秒
    await asyncio.sleep(DURATION_SECONDS)
    stop_event.set()

    # 採集壓測高峰時的硬體數據
    mid_stats = get_docker_stats()
    mid_ice = get_icecast_stats()

    # 等待所有客戶端優雅中斷
    await monitor_task
    await asyncio.gather(*tasks, return_exceptions=True)

    # 4. 分析與產出報告
    print("\n[步驟 4/4] 壓測完成，正在彙整硬體資源與流量分析報告...")
    await asyncio.sleep(1)

    total_bytes = sum(r["bytes_received"] for r in results.values())
    total_mb = total_bytes / (1024 * 1024)
    avg_mbps = (total_bytes * 8 / (1024 * 1024)) / DURATION_SECONDS
    successful = sum(1 for r in results.values() if r["bytes_received"] > 0)
    failed = NUM_CLIENTS - successful
    avg_bytes_per_client = total_bytes / max(successful, 1)
    avg_kb_per_client = avg_bytes_per_client / 1024
    avg_connect_ms = sum(r["connect_time_ms"] for r in results.values()) / len(results)

    print("\n" + "=" * 72)
    print("📊 CASTFLOW 50 用戶壓力測試成果報告 (BENCHMARK REPORT)")
    print("=" * 72)
    print(f"  測試規格:             {NUM_CLIENTS} 位並發用戶 (Concurrent Listeners)")
    print(f"  測試時長:             {DURATION_SECONDS} 秒 (1 分鐘)")
    print(f"  串流位元率:           {mid_ice['bitrate']} kbps MP3 CBR")
    print(f"  連線成功率:           {successful}/{NUM_CLIENTS} ({(successful/NUM_CLIENTS)*100:.1f}%)")
    if failed > 0:
        print(f"  連線失敗數:           {failed}")
    print(f"  平均連線建立延遲:     {avg_connect_ms:.2f} ms")
    print(f"  Icecast 峰值聽眾計數: {mid_ice['listener_peak']} 人")
    print(f"  總傳輸數據量:         {total_mb:.2f} MB")
    print(f"  總頻寬吞吐率:         {avg_mbps:.2f} Mbps (約 {total_mb/DURATION_SECONDS:.2f} MB/s)")
    print(f"  單一用戶平均接收量:   {avg_kb_per_client:.1f} KB (約 {avg_kb_per_client/DURATION_SECONDS:.1f} KB/s)")
    print("-" * 72)

    print("\n🖥️  DOCKER 各容器硬體使用量 (負載期間 vs 基準):")
    header = f"{'容器名稱':<24} {'CPU 使用率':<14} {'記憶體 (RAM)':<18} {'累計網路 NET I/O':<20}"
    print(header)
    print("-" * len(header))
    for name, stat in mid_stats.items():
        base_cpu = baseline_stats.get(name, {}).get("cpu", "N/A")
        print(f"{name:<24} {stat['cpu']:<14} {stat['mem']:<18} {stat['net']:<20}")

    print("=" * 72 + "\n")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n壓測已由使用者手動中止。")
