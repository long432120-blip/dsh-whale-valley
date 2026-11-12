// V0.20：單機版（雙擊 html）的 AI 對話——玩家自己填 DeepSeek API Key。
//
// 安全原則：
//   - 程式碼裡**沒有任何 Key**。Key 是玩家在遊戲裡的 🔑 設定填的，只存在「這台電腦的這個瀏覽器」（localStorage），
//     只會直接送到 api.deepseek.com（Authorization 標頭），不會經過任何其他伺服器，也不會寫進存檔、log 或錯誤訊息。
//   - DSH 插件版不走這裡：Key 在 host（插件設定／.env），瀏覽器永遠拿不到。
//
// 流程（跟 host 共用 shared/ai-service.ts 的 WhaleAi）：
//   點她 → 防抖（3 秒內只送第一次）→ 遊戲狀態轉成文字塞進 System Prompt → 帶最近 3 輪對話
//   → fetch /chat/completions（deepseek-chat、max_tokens 100、10 秒 AbortController）
//   → 成功：整理成一句台詞、寫進記憶；任何失敗：回傳 { ok: false, reason }，畫面改用角色包內建的台詞。
// 這裡的函式**不會丟例外**：呼叫端只看 ok。
import { devLog } from './dev-flag.ts';
import { sanitizeSnapshot, type AiFile, type ChatMessage, type ChatReply, type ChatRequest } from '../shared/ai.ts';
import { chatCompletion } from '../shared/ai-fetch.ts';
import { ChatMemory, WhaleAi } from '../shared/ai-service.ts';
import type { GameplayDefs } from '../shared/gameplay-types.ts';

export const PLAYER_KEY_STORAGE = 'whale-pet:deepseek-api-key';
export const PLAYER_MEMORY_STORAGE = 'whale-pet:ai-memory';
export const DEEPSEEK = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' } as const;
/** 玩家要求：10 秒沒回應就放棄、改用內建台詞 */
export const BROWSER_TIMEOUT_MS = 10_000;

/** 存 Key 的地方（測試時換成假的） */
export interface KeyValueStore {
  get(k: string): string | null;
  set(k: string, v: string): void;
  remove(k: string): void;
}

/** localStorage；無痕模式、被封鎖時不會丟例外，只是存不起來 */
export function browserStore(): KeyValueStore {
  return {
    get: (k) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
    set: (k, v) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* 存不起來就算了 */ } },
    remove: (k) => { try { globalThis.localStorage?.removeItem(k); } catch { /* ignore */ } },
  };
}

/** DeepSeek 的 Key 長得像 sk- 開頭的 32 位英數；只用來提醒「好像貼錯了」，不擋 */
export function looksLikeKey(key: string): boolean {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

/** 畫面上只顯示頭尾：sk-…a1b2 */
export function maskKey(key: string): string {
  const k = key.trim();
  return k.length <= 8 ? '••••' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

/** 「測試連線」的結果翻成玩家看得懂的話 */
export type KeyTestResult = { ok: true } | { ok: false; message: string };

/** 給畫面（🔑 設定）用的介面；DSH 版沒有這個 */
export interface PlayerAiSettings {
  readonly hasKey: boolean;
  /** 遮住中間的 Key，沒有 Key 是空字串 */
  masked(): string;
  save(key: string): void;
  clear(): void;
  test(key?: string): Promise<KeyTestResult>;
}

export interface AIChatServiceOptions {
  store?: KeyValueStore;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  baseUrl?: string;
  model?: string;
}

/**
 * 瀏覽器端的 AI 對話服務。
 *   chat(req)  → 跟 DSH host 一樣的 ChatReply（LocalBridge.chat 直接回傳給畫面）
 *   save/clear → 玩家在 🔑 設定裡存、清除 Key（清除時對話記憶也一起清掉）
 *   test()     → 送一個很小的請求，告訴玩家 Key 能不能用
 */
export class AIChatService implements PlayerAiSettings {
  private readonly store: KeyValueStore;
  private readonly memory: ChatMemory;
  private ai: WhaleAi | null = null;
  private aiKey = '';

  constructor(private readonly file: AiFile, private readonly opts: AIChatServiceOptions = {}) {
    this.store = opts.store ?? browserStore();
    // 短期記憶：最近 historyTurns 輪（ai.json 設 3），重新整理頁面後還記得
    this.memory = new ChatMemory(file.historyTurns, {
      load: async () => parseMemory(this.store.get(PLAYER_MEMORY_STORAGE)),
      save: async (all) => (Object.keys(all).length ? this.store.set(PLAYER_MEMORY_STORAGE, JSON.stringify(all)) : this.store.remove(PLAYER_MEMORY_STORAGE)),
    });
  }

  private get key(): string {
    return (this.store.get(PLAYER_KEY_STORAGE) ?? '').trim();
  }

  get hasKey(): boolean {
    return !!this.key;
  }

  masked(): string {
    return this.key ? maskKey(this.key) : '';
  }

  save(key: string): void {
    const k = key.trim();
    if (!k) return this.clear();
    this.store.set(PLAYER_KEY_STORAGE, k);
  }

  clear(): void {
    this.store.remove(PLAYER_KEY_STORAGE);
    this.store.remove(PLAYER_MEMORY_STORAGE);
    void this.memory.clear();
    this.ai = null;
    this.aiKey = '';
  }

  /** Key 換了就換一個 WhaleAi（防抖的計時、對話記憶沿用同一份） */
  private service(): WhaleAi | null {
    const key = this.key;
    if (!key) return null;
    if (!this.ai || this.aiKey !== key) {
      this.ai = new WhaleAi(
        { enabled: true, apiKey: key, baseUrl: this.opts.baseUrl ?? DEEPSEEK.baseUrl, model: this.opts.model ?? DEEPSEEK.model, timeoutMs: this.opts.timeoutMs ?? BROWSER_TIMEOUT_MS },
        this.file,
        { fetch: this.opts.fetch, now: this.opts.now, memory: this.memory, log: (m) => devLog(m) },
      );
      this.aiKey = key;
    }
    return this.ai;
  }

  /** 跟 DSH host 一樣的對話入口。快照由畫面附上（瀏覽器自己的存檔），這裡再檢查一次形狀 */
  async chat(req: ChatRequest, defs?: GameplayDefs): Promise<ChatReply> {
    const ai = this.service();
    if (!ai) return { ok: false, reason: 'no_key' };
    const snapshot = sanitizeSnapshot(req.snapshot);
    if (!snapshot) return { ok: false, reason: 'bad_request' };
    try {
      return await ai.chat(req, snapshot, defs);
    } catch {
      // WhaleAi 本身不丟例外；這裡是最後一道保險（例如 localStorage 壞掉）
      return { ok: false, reason: 'network' };
    }
  }

  async test(key = this.key): Promise<KeyTestResult> {
    const k = key.trim();
    if (!k) return { ok: false, message: '還沒有填 Key。' };
    const messages: ChatMessage[] = [{ role: 'user', content: '說「好」' }];
    const r = await chatCompletion(
      { apiKey: k, baseUrl: this.opts.baseUrl ?? DEEPSEEK.baseUrl, model: this.opts.model ?? DEEPSEEK.model, timeoutMs: this.opts.timeoutMs ?? BROWSER_TIMEOUT_MS },
      { messages, max_tokens: 5, temperature: 0 },
      this.opts.fetch,
    ).catch(() => ({ ok: false as const, reason: 'network' as const, status: undefined }));
    if (r.ok) return { ok: true };
    return { ok: false, message: explainFailure(r.reason, 'status' in r ? r.status : undefined) };
  }
}

/** 失敗原因 → 玩家看得懂的一句話（不含 Key、不含伺服器回傳的原文） */
export function explainFailure(reason: string, status?: number): string {
  if (reason === 'timeout') return '等了 10 秒沒有回應：網路可能不穩，晚點再試。';
  if (reason === 'network') return '連不到 api.deepseek.com：檢查網路，或瀏覽器的外掛有沒有擋住。';
  if (reason === 'http') {
    if (status === 401) return 'Key 不對（401）：重新複製一次，前後不要有空白。';
    if (status === 402) return 'DeepSeek 帳戶餘額不足（402）。';
    if (status === 429) return '請求太頻繁（429），等一下再試。';
    if (status && status >= 500) return `DeepSeek 伺服器忙碌中（${status}），晚點再試。`;
    return `DeepSeek 回傳錯誤${status ? `（${status}）` : ''}。`;
  }
  if (reason === 'bad_response') return 'DeepSeek 的回應看不懂，晚點再試。';
  return '沒有成功，晚點再試。';
}

function parseMemory(raw: string | null): Record<string, ChatMessage[]> {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, ChatMessage[]> = {};
    for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      out[k] = list.filter((m): m is ChatMessage =>
        !!m && typeof m === 'object' && ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') && typeof (m as ChatMessage).content === 'string');
    }
    return out;
  } catch {
    return {};
  }
}
