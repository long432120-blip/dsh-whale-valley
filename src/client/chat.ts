// V0.22：公共聊天室
//
// 現在是「本地模擬」：沒有伺服器，你說話後由鎮上的居民和路過的旅人（social.json 的 chat.bots）回你，
// 介面上會清楚寫著是模擬（不假裝是真人）。之後有伺服器時呼叫 connectToServer('wss://…') 就換成真的聊天。
//
// 伺服器協定（JSON 一行一則；參考實作 scripts/chat-server.ts，npm run chat:server）：
//   送出 { "type": "hello", "nick": "暱稱" }          連上時報暱稱
//        { "type": "chat", "nick": "暱稱", "text": "內容" }
//   收到 { "type": "chat", "nick": "暱稱", "text": "內容", "at": 1730000000000 }
//        { "type": "system", "text": "…" }
// 不管是模擬還是伺服器，送出前、收到後都會過敏感詞；每則最多 maxLength 字、minIntervalMs 內只能送一則、同一句話 10 秒內不能重複。
import type { ChatDef } from '../shared/trade.ts';
import { makeFilter } from '../shared/profanity.ts';

export interface ChatMessage {
  id: string;
  /** me = 自己、bot = 模擬的居民／旅人、server = 伺服器上的別人、system = 系統訊息 */
  from: 'me' | 'bot' | 'server' | 'system';
  nick: string;
  emoji?: string;
  tag?: string;
  text: string;
  at: number;
}

export type ChatMode = 'local' | 'connecting' | 'server';
export type SendResult = { ok: true } | { ok: false; reason: 'empty' | 'too_fast' | 'repeat' };

export interface ChatStore { getItem(k: string): string | null; setItem(k: string, v: string): void }
export const CHAT_KEY = 'whale-pet:chat';

export class ChatService {
  private log: ChatMessage[] = [];
  private listeners = new Set<() => void>();
  private lastSendAt = -Infinity;
  private lastText = '';
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private ambientTimer: ReturnType<typeof setTimeout> | null = null;
  private ws: WebSocket | null = null;
  private seq = 0;
  mode: ChatMode = 'local';
  readonly filter: (text: string) => { text: string; hit: boolean };

  constructor(
    private readonly def: ChatDef,
    private readonly opts: { store?: ChatStore | null; now?: () => number; rnd?: () => number; nick?: () => string; WebSocketImpl?: typeof WebSocket } = {},
  ) {
    this.filter = makeFilter(def);
    try {
      const raw = JSON.parse(this.store?.getItem(CHAT_KEY) ?? '[]');
      if (Array.isArray(raw)) this.log = raw.filter((m) => m && typeof m.text === 'string' && typeof m.nick === 'string').slice(-def.keep);
    } catch { /* 壞掉的紀錄就不要了 */ }
  }

  private get store() { return this.opts.store === undefined ? safeStorage() : this.opts.store; }
  private now() { return (this.opts.now ?? Date.now)(); }
  private rnd() { return (this.opts.rnd ?? Math.random)(); }
  private nick() { return this.opts.nick?.() || '主人'; }

  messages(): readonly ChatMessage[] { return this.log; }
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private push(m: Omit<ChatMessage, 'id' | 'at'> & { at?: number }) {
    this.log = [...this.log, { ...m, id: `c${this.now().toString(36)}${(this.seq++).toString(36)}`, at: m.at ?? this.now() }].slice(-this.def.keep);
    try { this.store?.setItem(CHAT_KEY, JSON.stringify(this.log)); } catch { /* 存不了不影響聊天 */ }
    for (const fn of this.listeners) fn();
  }

  /** 玩家送出一則 */
  send(raw: string): SendResult {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, this.def.maxLength);
    if (!text) return { ok: false, reason: 'empty' };
    const now = this.now();
    if (now - this.lastSendAt < this.def.minIntervalMs) return { ok: false, reason: 'too_fast' };
    if (text === this.lastText && now - this.lastSendAt < 10_000) return { ok: false, reason: 'repeat' };
    this.lastSendAt = now;
    this.lastText = text;
    const clean = this.filter(text).text;
    this.push({ from: 'me', nick: this.nick(), text: clean });
    if (this.mode === 'server' && this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'chat', nick: this.nick(), text: clean }));
    } else {
      this.simulateReplies(clean);
    }
    return { ok: true };
  }

  // ── 本地模擬 ──
  private later(ms: number, fn: () => void) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
  }
  private pickBot(exclude?: string) {
    const bots = this.def.bots.filter((b) => b.id !== exclude);
    return bots[Math.floor(this.rnd() * bots.length)] ?? this.def.bots[0]!;
  }
  /** 依照關鍵字挑回覆；沒對上就用通用的 */
  /** avoid：同一則訊息有兩個人回時，第二個人不要講一模一樣的話 */
  replyFor(text: string, avoid?: string): string {
    const lower = text.toLowerCase();
    const hits = this.def.replies.filter((r) => r.keywords.some((k) => lower.includes(k.toLowerCase())));
    let pool = hits.length ? hits.flatMap((r) => r.lines) : this.def.fallback;
    if (avoid && pool.length > 1) pool = pool.filter((l) => l !== avoid);
    if (avoid && !pool.length) pool = this.def.fallback.filter((l) => l !== avoid);
    return pool[Math.floor(this.rnd() * pool.length)] ?? '…';
  }
  private simulateReplies(text: string) {
    const n = this.rnd() < 0.35 ? 2 : 1;
    let first: string | undefined;
    let said: string | undefined;
    for (let i = 0; i < n; i++) {
      const bot = this.pickBot(first);
      first = bot.id;
      this.later(1200 + i * 1800 + Math.floor(this.rnd() * 1500), () => {
        if (this.mode === 'server') return;
        said = this.replyFor(text, said);
        this.push({ from: 'bot', nick: bot.name, emoji: bot.emoji, tag: bot.tag, text: said });
      });
    }
  }
  /** 聊天室開著時，偶爾有人自己聊天（關掉面板就停） */
  startAmbient(minMs = 25_000, maxMs = 60_000) {
    this.stopAmbient();
    const tick = () => {
      this.ambientTimer = setTimeout(() => {
        if (this.mode !== 'server' && this.def.ambient.length) {
          const bot = this.pickBot();
          this.push({ from: 'bot', nick: bot.name, emoji: bot.emoji, tag: bot.tag, text: this.def.ambient[Math.floor(this.rnd() * this.def.ambient.length)]! });
        }
        tick();
      }, minMs + Math.floor(this.rnd() * (maxMs - minMs)));
    };
    tick();
  }
  stopAmbient() {
    if (this.ambientTimer) clearTimeout(this.ambientTimer);
    this.ambientTimer = null;
  }

  // ── 預留：真正的伺服器 ──
  /**
   * 連到聊天伺服器（WebSocket）。只接受 ws:// 或 wss://；8 秒連不上、或中途斷線，都會自動回到本地模擬。
   * 回傳 Promise：連上 true、失敗 false（不會丟例外）。
   */
  connectToServer(url: string, timeoutMs = 8000): Promise<boolean> {
    this.disconnect();
    let u: URL;
    try {
      u = new URL(url);
      if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new Error('protocol');
    } catch {
      this.push({ from: 'system', nick: '系統', text: '伺服器網址要是 ws:// 或 wss:// 開頭' });
      return Promise.resolve(false);
    }
    const WS = this.opts.WebSocketImpl ?? globalThis.WebSocket;
    if (!WS) return Promise.resolve(false);
    this.mode = 'connecting';
    for (const fn of this.listeners) fn();
    return new Promise((resolve) => {
      let settled = false;
      const done = (okk: boolean) => { if (!settled) { settled = true; resolve(okk); } };
      let ws: WebSocket;
      try {
        ws = new WS(u.toString());
      } catch {
        this.fallbackToLocal('連不上伺服器，先用本地模擬');
        return done(false);
      }
      this.ws = ws;
      const timer = setTimeout(() => { ws.close(); this.fallbackToLocal('連線逾時，先用本地模擬'); done(false); }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        this.mode = 'server';
        try { ws.send(JSON.stringify({ type: 'hello', nick: this.nick() })); } catch { /* 送不出去就等第一句話再報暱稱 */ }
        this.push({ from: 'system', nick: '系統', text: `已連上 ${u.host}` });
        done(true);
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data));
          if (m?.type === 'chat' && typeof m.text === 'string') {
            this.push({ from: 'server', nick: this.filter(String(m.nick ?? '玩家').slice(0, 12)).text, text: this.filter(m.text.slice(0, this.def.maxLength)).text, at: typeof m.at === 'number' ? m.at : undefined });
          } else if (m?.type === 'system' && typeof m.text === 'string') {
            this.push({ from: 'system', nick: '系統', text: m.text.slice(0, 120) });
          }
        } catch { /* 看不懂的訊息就略過 */ }
      };
      ws.onerror = () => { clearTimeout(timer); this.fallbackToLocal('伺服器出錯，先用本地模擬'); done(false); };
      ws.onclose = () => { clearTimeout(timer); if (this.ws === ws) this.fallbackToLocal('和伺服器斷線了，先用本地模擬'); done(false); };
    });
  }
  private fallbackToLocal(msg: string) {
    this.ws = null;
    if (this.mode === 'local') return;
    this.mode = 'local';
    this.push({ from: 'system', nick: '系統', text: msg });
  }
  disconnect() {
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignore */ }
    this.mode = 'local';
  }
  dispose() {
    this.stopAmbient();
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.disconnect();
    this.listeners.clear();
  }
}

function safeStorage(): ChatStore | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
