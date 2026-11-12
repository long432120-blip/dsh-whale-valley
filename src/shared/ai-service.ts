// AI 對話服務（V0.20 起 host 和瀏覽器共用）：防抖 → 組 prompt（角色設定＋遊戲狀態＋記憶）→ 呼叫 API → 整理回覆 → 寫進記憶。
// 任何一步失敗都回傳 { ok: false, reason }，由畫面改用 JSON 台詞，遊戲不會壞。
import {
  buildDiaryMessages, buildMessages, buildSystemPrompt, RateGate, sanitizeReply, triggerText,
  type AiFile, type ChatMessage, type ChatReply, type ChatRequest, type DialogueSnapshot,
} from './ai.ts';
import type { GameplayDefs } from './gameplay-types.ts';
import { diaryPrompt, type DiaryEntry } from './diary.ts';
import { chatCompletion, type ChatApiConfig, type LlmChat } from './ai-fetch.ts';

/** 呼叫 API 需要的設定（host 的 ResolvedAiConfig、瀏覽器的玩家設定都符合這個形狀） */
export interface AiServiceConfig extends ChatApiConfig {
  enabled: boolean;
}

/** 對話記憶：每個角色各自記最近幾輪；可以接一個存檔（重開 DSH 後還記得） */
export interface MemoryStore {
  load(): Promise<Record<string, ChatMessage[]>>;
  save(all: Record<string, ChatMessage[]>): Promise<void>;
}

export class ChatMemory {
  private data: Record<string, ChatMessage[]> | null = null;
  constructor(private readonly maxTurns: number, private readonly store?: MemoryStore) {}
  private async all() {
    this.data ??= (await this.store?.load().catch(() => ({}))) ?? {};
    return this.data;
  }
  async get(speaker: string): Promise<ChatMessage[]> {
    return [...((await this.all())[speaker] ?? [])];
  }
  async push(speaker: string, user: string, assistant: string): Promise<void> {
    const all = await this.all();
    all[speaker] = [...(all[speaker] ?? []), { role: 'user' as const, content: user }, { role: 'assistant' as const, content: assistant }].slice(-this.maxTurns * 2);
    await this.store?.save(all).catch(() => undefined);
  }
  async clear(speaker?: string): Promise<void> {
    const all = await this.all();
    if (speaker) delete all[speaker];
    else for (const k of Object.keys(all)) delete all[k];
    await this.store?.save(all).catch(() => undefined);
  }
}

export interface WhaleAiDeps {
  fetch?: typeof fetch;
  now?: () => number;
  memory?: ChatMemory;
  /** 失敗時印 log（不含 Key） */
  log?: (msg: string) => void;
  /** V0.9：走 DSH 的 llm 服務（沒有 API Key 時使用；沒有這個服務就是 undefined） */
  llm?: LlmChat;
}

export class WhaleAi {
  private readonly gate: RateGate;
  readonly memory: ChatMemory;

  constructor(
    private readonly cfg: AiServiceConfig,
    private readonly file: AiFile,
    private readonly deps: WhaleAiDeps = {},
  ) {
    this.gate = new RateGate(file.minIntervalMs, file.perMinute, deps.now);
    this.memory = deps.memory ?? new ChatMemory(file.historyTurns);
  }

  get available(): boolean {
    // V0.9：有 DSH 的 llm 服務就不用 API Key
    return this.cfg.enabled && (!!this.cfg.apiKey || !!this.deps.llm);
  }

  /** 角色 id 清單（請求驗證用） */
  get speakers(): string[] {
    return Object.keys(this.file.personas);
  }

  /** 關掉了、也沒有任何可用通道：回傳失敗原因；可以用就回傳 null */
  unavailable(): ChatReply | null {
    if (!this.cfg.enabled) return { ok: false, reason: 'disabled' };
    if (!this.cfg.apiKey && !this.deps.llm) return { ok: false, reason: 'no_key' };
    return null;
  }

  async chat(req: ChatRequest, snapshot: DialogueSnapshot, defs?: GameplayDefs): Promise<ChatReply> {
    const off = this.unavailable();
    if (off) return off;
    const system = buildSystemPrompt(this.file, req.speaker, snapshot);
    if (!system) return { ok: false, reason: 'bad_request' };
    // 防抖：同一個角色 minIntervalMs 內只發一次；有請求在路上也不發
    const wait = this.gate.acquire(req.speaker);
    if (wait > 0) return { ok: false, reason: 'rate_limited', retryInMs: Math.ceil(wait) };
    try {
      const user = triggerText(this.file, req, defs);
      const history = await this.memory.get(req.speaker);
      const messages = buildMessages(system, history, user, this.file.historyTurns);
      // 有 Key 就直連（原本的行為）；沒有 Key 但宿主有 llm 服務，就走 DSH 的模型。
      const res = this.cfg.apiKey
        ? await chatCompletion(this.cfg, {
            messages,
            temperature: this.file.temperature,
            max_tokens: this.file.maxTokens,
          }, this.deps.fetch)
        : await this.deps.llm!({
            messages,
            temperature: this.file.temperature,
            maxTokens: this.file.maxTokens,
            timeoutMs: this.cfg.timeoutMs,
          });
      if (!res.ok) {
        this.deps.log?.(`[whale-pet] AI 對話失敗：${res.reason}${res.status ? ` ${res.status}` : ''}${res.detail ? ` ${res.detail}` : ''}`);
        return { ok: false, reason: res.reason };
      }
      const name = this.file.personas[req.speaker]!.name;
      const text = sanitizeReply(res.text, this.file.maxReplyChars, [name]);
      if (!text) return { ok: false, reason: 'bad_response' };
      await this.memory.push(req.speaker, user, text);
      return { ok: true, text, source: 'ai' };
    } finally {
      this.gate.release(req.speaker);
    }
  }

  /**
   * V0.17：寫今天的「像素日記」。只用存檔裡整理好的紀錄（日期、天氣、今天的事），不帶對話記憶。
   * 失敗回傳 { ok: false }，存檔裡留著規則層拼好的那篇。
   */
  async diary(e: Pick<DiaryEntry, 'date' | 'weather' | 'facts'>, extra: string[] = []): Promise<ChatReply> {
    const off = this.unavailable();
    if (off) return off;
    const dc = this.file.diary;
    const messages = buildDiaryMessages(this.file, diaryPrompt(e, extra));
    if (!dc || !messages) return { ok: false, reason: 'disabled' };
    const wait = this.gate.acquire('diary');
    if (wait > 0) return { ok: false, reason: 'rate_limited', retryInMs: Math.ceil(wait) };
    try {
      const res = this.cfg.apiKey
        ? await chatCompletion(this.cfg, { messages, temperature: dc.temperature, max_tokens: dc.maxTokens }, this.deps.fetch)
        : await this.deps.llm!({ messages, temperature: dc.temperature, maxTokens: dc.maxTokens, timeoutMs: this.cfg.timeoutMs });
      if (!res.ok) {
        this.deps.log?.(`[whale-pet] AI 日記失敗：${res.reason}${res.status ? ` ${res.status}` : ''}${res.detail ? ` ${res.detail}` : ''}`);
        return { ok: false, reason: res.reason };
      }
      const text = sanitizeReply(res.text, dc.maxChars, [this.file.personas.whale?.name ?? '']);
      return text ? { ok: true, text, source: 'ai' } : { ok: false, reason: 'bad_response' };
    } finally {
      this.gate.release('diary');
    }
  }
}
