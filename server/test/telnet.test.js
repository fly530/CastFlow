// =============================================================================
// LiquidsoapClient 的指令佇列與逾時處理。
//
// 用本機假的 TCP server 模擬 Liquidsoap Telnet：回應以 "\nEND\n" 結尾。
//
// 執行：cd server && npm test
// =============================================================================
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const { LiquidsoapClient } = await import(`${SRC}/telnet.js`);

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

/**
 * 啟動假 Liquidsoap。handler(cmd, reply) 決定怎麼回應；可延遲、可不回。
 */
async function startFake(handler) {
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('error', () => {}); // 對已被 client 關掉的連線寫入會觸發，測試中可忽略
    sock.on('close', () => sockets.delete(sock));
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const cmd = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        handler(cmd, (body) => sock.write(`${body}\r\nEND\r\n`));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => {
    for (const s of sockets) s.destroy();
    server.close(r);
  }));
  return server.address().port;
}

async function connectClient(port, options = {}) {
  const client = new LiquidsoapClient({ host: '127.0.0.1', port, reconnectInterval: 50, ...options });
  client.on('error', () => {});
  const connected = new Promise((r) => client.once('connect', r));
  client.connect();
  await connected;
  cleanups.push(async () => {
    // 先停掉自動重連，否則關閉 socket 後 client 會一直重連，測試程序無法結束
    client.connect = () => {};
    clearTimeout(client.reconnectTimer);
    client.socket?.destroy();
  });
  return client;
}

describe('LiquidsoapClient', () => {
  test('正常指令：依序取得各自的回應', async () => {
    const port = await startFake((cmd, reply) => reply(`echo:${cmd}`));
    const client = await connectClient(port);
    const [a, b] = await Promise.all([client.sendCommand('one'), client.sendCommand('two')]);
    assert.equal(a, 'echo:one');
    assert.equal(b, 'echo:two');
  });

  test('逾時後遲到的回應，不能被當成下一個指令的結果', async () => {
    let slowReply;
    const port = await startFake((cmd, reply) => {
      if (cmd === 'slow') slowReply = reply; // 先不回，之後才補回
      else reply(`echo:${cmd}`);
    });
    const client = await connectClient(port, { timeout: 100 });

    const reconnected = new Promise((r) => client.once('connect', r));
    await assert.rejects(client.sendCommand('slow'), /timed out/);
    // 逾時之後遲到的回應 (連線若沒重置，會污染緩衝)
    slowReply?.('LATE-RESPONSE-OF-SLOW');

    // 逾時會重置連線；等重連完成後送出的新指令，必須拿到自己的回應
    await reconnected;
    const res = await client.sendCommand('next');
    assert.equal(res, 'echo:next');
  });

  test('未連線時送指令：立刻失敗，不要排到重連後才執行過期的指令', async () => {
    const client = new LiquidsoapClient({ host: '127.0.0.1', port: 1, reconnectInterval: 60000 });
    client.on('error', () => {});
    const start = Date.now();
    await assert.rejects(client.sendCommand('dynamic_queue.push /music/x.mp3'), /not connected/i);
    assert.ok(Date.now() - start < 1000, '應該立刻失敗');
    assert.equal(client.commandQueue.length, 0, '不應殘留在佇列');
  });

  test('斷線時，已排隊但尚未送出的指令會被拒絕', async () => {
    let drop;
    const port = await startFake((cmd, reply) => {
      if (cmd === 'hang') drop = true; // 不回應，讓後面的指令卡在佇列
      else reply('ok');
    });
    const client = await connectClient(port, { timeout: 5000 });
    const hang = client.sendCommand('hang');
    const queued = client.sendCommand('queued');
    await new Promise((r) => setTimeout(r, 50));
    client.socket.destroy(); // 模擬斷線
    await assert.rejects(hang, /Connection lost/);
    await assert.rejects(queued, /Connection lost|not connected/i);
    assert.ok(drop);
  });
});
