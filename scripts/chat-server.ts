// V0.22：聊天室的參考伺服器（給 connectToServer 用）。不用裝任何套件：Node 內建的 http + 手寫 WebSocket。
//
//   npm run chat:server                 → ws://127.0.0.1:8790
//   npm run chat:server -- --port 9000 --host 0.0.0.0   （開給區網的朋友；要放上網路請放在 HTTPS 反向代理後面，用 wss://）
//
// 遊戲端：網址加 ?dev → 💬 聊天室最下面「伺服器（開發者）」填 ws://127.0.0.1:8790 → 連線
//
// 協定（JSON 文字訊息）：
//   客戶端 → 伺服器  {type:'hello', nick}                 連上後先報暱稱
//                    {type:'chat', nick?, text}           說一句話
//   伺服器 → 客戶端  {type:'chat', nick, text, at}        別人說的話（不會回傳給自己，自己的那句客戶端已經顯示了）
//                    {type:'system', text}                有人進來、離開、說太快…
//
// 伺服器不相信客戶端：暱稱、長度、髒話、速度都在這裡再檢查一次。
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeFilter } from '../src/shared/profanity.ts';
import type { SocialFile } from '../src/shared/trade.ts';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 16 * 1024; // 一則訊息最多 16 KB（聊天只要 80 字）
const MAX_CLIENTS = 100;
const HISTORY = 20;

export interface ChatServerOptions {
  port?: number;
  host?: string;
  /** 角色包的 social.json（詞庫、長度、速度） */
  social?: SocialFile;
  log?: (line: string) => void;
}

interface Client {
  id: number;
  sock: Duplex;
  nick: string;
  lastAt: number;
  lastText: string;
  buf: Buffer;
  frag: Buffer[];
  alive: boolean;
}

export function startChatServer(opts: ChatServerOptions = {}) {
  const social = opts.social ?? loadSocial();
  const chat = social.chat;
  const filter = makeFilter(chat);
  const log = opts.log ?? ((l: string) => console.log(l));
  const clients = new Set<Client>();
  const history: { type: 'chat'; nick: string; text: string; at: number }[] = [];
  let nextId = 1;

  const cleanNick = (raw: unknown, fallback: string) => {
    const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, social.nick.maxLength) : '';
    return filter(s).text || fallback;
  };

  function frame(text: string): Buffer {
    const data = Buffer.from(text, 'utf8');
    const len = data.length;
    const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : (() => {
      const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h;
    })();
    return Buffer.concat([head, data]);
  }
  const send = (c: Client, msg: object) => { try { c.sock.write(frame(JSON.stringify(msg))); } catch { /* 斷線的人略過 */ } };
  const broadcast = (msg: object, except?: Client) => { for (const c of clients) if (c !== except) send(c, msg); };
  const online = () => [...clients].filter((c) => c.nick).length;

  function drop(c: Client, why: string) {
    if (!clients.delete(c)) return;
    try { c.sock.end(Buffer.from([0x88, 0])); } catch { /* ignore */ }
    c.sock.destroy();
    if (c.nick) {
      broadcast({ type: 'system', text: `${c.nick} 離開了聊天室（線上 ${online()} 人）` });
      log(`[leave] #${c.id} ${c.nick}（${why}）`);
    }
  }

  function onText(c: Client, raw: string) {
    let m: { type?: unknown; nick?: unknown; text?: unknown };
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'hello') {
      const first = !c.nick;
      c.nick = cleanNick(m.nick, `玩家${c.id}`);
      if (first) {
        for (const h of history) send(c, h);
        send(c, { type: 'system', text: `歡迎來到聊天室！線上 ${online()} 人` });
        broadcast({ type: 'system', text: `${c.nick} 進入了聊天室` }, c);
        log(`[join] #${c.id} ${c.nick}`);
      }
      return;
    }
    if (m.type !== 'chat' || typeof m.text !== 'string') return;
    if (!c.nick) c.nick = cleanNick(m.nick, `玩家${c.id}`);
    const text = m.text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, chat.maxLength);
    if (!text) return;
    const now = Date.now();
    if (now - c.lastAt < chat.minIntervalMs) { send(c, { type: 'system', text: '說太快了，等一下再送' }); return; }
    if (text === c.lastText && now - c.lastAt < 10_000) { send(c, { type: 'system', text: '同一句話剛剛說過了' }); return; }
    c.lastAt = now;
    c.lastText = text;
    const msg = { type: 'chat' as const, nick: c.nick, text: filter(text).text, at: now };
    history.push(msg);
    if (history.length > HISTORY) history.shift();
    broadcast(msg, c);
    log(`[chat] ${c.nick}: ${msg.text}`);
  }

  /** 解析客戶端送來的 frame（客戶端一定要加遮罩） */
  function onData(c: Client, chunk: Buffer) {
    c.buf = c.buf.length ? Buffer.concat([c.buf, chunk]) : chunk;
    while (c.buf.length >= 2) {
      const b0 = c.buf[0]!, b1 = c.buf[1]!;
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (c.buf.length < 10) return; const big = c.buf.readBigUInt64BE(2); if (big > BigInt(MAX_FRAME)) return drop(c, '訊息太大'); len = Number(big); off = 10; }
      if (!masked) return drop(c, '沒有遮罩');
      if (len > MAX_FRAME) return drop(c, '訊息太大');
      if (c.buf.length < off + 4 + len) return;
      const mask = c.buf.subarray(off, off + 4);
      const payload = Buffer.from(c.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i & 3]!;
      c.buf = c.buf.subarray(off + 4 + len);
      if (op === 0x8) return drop(c, '客戶端關閉');
      if (op === 0x9) { try { c.sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); } catch { /* ignore */ } continue; }
      if (op === 0xa) { c.alive = true; continue; }
      if (op === 0x1 || op === 0x0) {
        c.frag.push(payload);
        if (c.frag.reduce((n, b) => n + b.length, 0) > MAX_FRAME) return drop(c, '訊息太大');
        if (fin) { const text = Buffer.concat(c.frag).toString('utf8'); c.frag = []; onText(c, text); }
        continue;
      }
      // 二進位或看不懂的 frame：不收
      return drop(c, `不支援的 frame ${op}`);
    }
  }

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`鯨魚谷物語聊天伺服器：用 WebSocket 連線（線上 ${online()} 人）\n`);
  });
  server.on('upgrade', (req: IncomingMessage, sock: Duplex) => {
    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string' || clients.size >= MAX_CLIENTS) {
      sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const c: Client = { id: nextId++, sock, nick: '', lastAt: 0, lastText: '', buf: Buffer.alloc(0), frag: [], alive: true };
    clients.add(c);
    sock.on('data', (d: Buffer) => { try { onData(c, d); } catch (err) { drop(c, `錯誤 ${(err as Error).message}`); } });
    sock.on('close', () => drop(c, '斷線'));
    sock.on('error', () => drop(c, '連線錯誤'));
  });
  // 30 秒 ping 一次，沒回應的就斷開
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { drop(c, '沒有回應'); continue; }
      c.alive = false;
      try { c.sock.write(Buffer.from([0x89, 0])); } catch { /* ignore */ }
    }
  }, 30_000);
  heartbeat.unref?.();

  const ready = new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8790, opts.host ?? '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : opts.port ?? 8790);
    });
  });
  return {
    ready,
    online,
    close: () => new Promise<void>((resolve) => {
      clearInterval(heartbeat);
      for (const c of [...clients]) drop(c, '伺服器關閉');
      server.close(() => resolve());
    }),
  };
}

function loadSocial(): SocialFile {
  const p = fileURLToPath(new URL('../packs/whale-girl-pixel/social.json', import.meta.url));
  return JSON.parse(readFileSync(p, 'utf8')) as SocialFile;
}

// 直接執行：npm run chat:server
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const s = startChatServer({ port: Number(arg('port') ?? 8790), host: arg('host') ?? '127.0.0.1' });
  s.ready.then((port) => console.log(`🐋 聊天伺服器：ws://${arg('host') ?? '127.0.0.1'}:${port}（Ctrl+C 結束）`))
    .catch((err) => { console.error('啟動失敗：', err.message); process.exit(1); });
  process.on('SIGINT', () => void s.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => void s.close().then(() => process.exit(0)));
}
