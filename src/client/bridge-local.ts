// Demo 用的「假 host」：用 localStorage 存檔，但規則跟真 host 共用 shared/state.ts。
// 換成 DSH 時只要把這個換成 DshBridge，畫面程式一行都不用改。
import { buildDefs } from '../shared/gameplay.ts';
import type { GameAction, GameplayDefs, GameplayFile } from '../shared/gameplay-types.ts';
import * as rules from '../shared/state.ts';
import type { ActResult, HostBridge, PetSave, PetView, SceneId } from '../shared/types.ts';
import type { AiFile, ChatReply, ChatRequest } from '../shared/ai.ts';
import { AIChatService, type AIChatServiceOptions, type PlayerAiSettings } from './ai-browser.ts';
import { SLOT_COUNT, makeSlotFile, parseSlotFile, slotInfo, validSlot, type SlotApi, type SlotInfo } from '../shared/save-slots.ts';

export class LocalBridge implements HostBridge {
  private readonly defs?: GameplayDefs;
  private readonly playerAi?: AIChatService;

  /**
   * gameplay 給了才有 V0.2 玩法（釣魚、種菜、揹包）；V0.1 demo 不用給。
   * V0.20：ai（角色包的 ai.json）給了，玩家就能在 🔑 設定填自己的 DeepSeek API Key 讓她用 AI 說話。
   */
  constructor(
    private readonly key: string,
    private readonly initialScene: SceneId,
    private readonly gameplayFile?: GameplayFile,
    ai?: AiFile,
    aiOptions?: AIChatServiceOptions,
  ) {
    this.defs = gameplayFile ? buildDefs(gameplayFile) : undefined;
    this.playerAi = ai ? new AIChatService(ai, aiOptions) : undefined;
  }

  /** V0.20：🔑 設定用（畫面看到這個才顯示按鈕）；用開發伺服器（Key 在伺服器）時不需要 */
  get aiSettings(): PlayerAiSettings | undefined {
    return aiEndpoint() ? undefined : this.playerAi;
  }

  /** 時間快轉的偏移量也存起來，重新整理後時段才一致 */
  private get offset(): number {
    return Number(safeGet(`${this.key}:offset`) ?? 0) || 0;
  }
  private now(): number {
    return Date.now() + this.offset;
  }
  private notice: string | null = null;

  /**
   * V0.21：讀存檔絕對不讓遊戲當掉。
   * - 沒有存檔 → 新遊戲
   * - JSON 壞掉、看不懂的格式（例如被手改、或更新版本的存檔）→ 原始內容先備份到 `<key>:backup`，再開新遊戲，並提醒玩家
   * - 欄位壞掉 → rules.migrate／normalizeGame 逐欄位補預設值（揹包數量也會設上限）
   * - 萬一規則還是丟例外 → 同樣備份後開新遊戲
   */
  private load(now: number): PetSave {
    const text = safeGet(this.key);
    if (text == null) return rules.migrate(null, now, this.initialScene, this.defs);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    if (!isKnownSave(raw)) {
      this.backup(text);
      return rules.migrate(null, now, this.initialScene, this.defs);
    }
    try {
      return rules.migrate(raw, now, this.initialScene, this.defs);
    } catch (err) {
      console.warn('[whale-pet] 存檔讀取失敗，已備份並開新遊戲', err);
      this.backup(text);
      return rules.migrate(null, now, this.initialScene, this.defs);
    }
  }
  private backup(text: string): void {
    safeSet(`${this.key}:backup`, text);
    safeSet(`${this.key}:backup-at`, new Date().toISOString());
    this.notice = '⚠️ 存檔讀不出來（可能壞掉了），已經先備份起來，幫你開了新的遊戲。';
  }
  takeNotice(): string | null {
    const n = this.notice;
    this.notice = null;
    return n;
  }
  private save(s: PetSave): void {
    safeSet(this.key, JSON.stringify(s));
  }

  async visit(): Promise<PetView> {
    const now = this.now();
    const { next, view } = rules.visit(this.load(now), now, this.defs);
    this.save(next);
    return view;
  }
  async getView(): Promise<PetView> {
    const now = this.now();
    const s = rules.tick(this.load(now), now, this.defs);
    this.save(s);
    return rules.toView(s, now, 0, this.defs);
  }
  async setScene(sceneId: SceneId): Promise<PetView> {
    const now = this.now();
    const s = rules.setScene(this.load(now), sceneId, now, this.defs);
    this.save(s);
    return rules.toView(s, now, 0, this.defs);
  }
  async poke(): Promise<PetView> {
    const now = this.now();
    const s = rules.poke(this.load(now), now, this.defs);
    this.save(s);
    return rules.toView(s, now, 0, this.defs);
  }
  async act(action: GameAction): Promise<ActResult> {
    const now = this.now();
    const { next, result } = rules.act(this.load(now), action, now, this.defs);
    this.save(next);
    return result;
  }
  async gameplay(): Promise<GameplayFile | null> {
    return this.gameplayFile ?? null;
  }

  /**
   * V0.8：AI 對話。程式碼裡絕對不放 API Key，所以：
   *   - 用 `npm run demo:ai` 開的頁面：開發伺服器會在頁面加上
   *     <meta name="whale-ai-endpoint" content="/api/ai/chat">，這裡就打過去（Key 在伺服器的 .env 裡）。
   *     伺服器看不到瀏覽器裡的存檔，所以這時候會附上遊戲狀態的快照。
   *   - V0.20：直接雙擊 html：玩家在 🔑 設定填了自己的 Key，就從瀏覽器直接問 DeepSeek（ai-browser.ts）。
   *   - 都沒有：回傳 no_key，畫面用角色包內建的台詞。
   */
  async chat(req: ChatRequest): Promise<ChatReply> {
    const endpoint = aiEndpoint();
    if (!endpoint) return this.playerAi ? this.playerAi.chat(req, this.defs) : { ok: false, reason: 'no_key' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, reason: 'http' };
      return (await res.json()) as ChatReply;
    } catch {
      return { ok: false, reason: ctrl.signal.aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── V0.23：存檔格（localStorage 的 <key>:slot:1～3）與開新遊戲 ──
  readonly slots: SlotApi = {
    count: SLOT_COUNT,
    list: async () => this.listSlots(),
    save: async (slot) => {
      if (!validSlot(slot)) throw new Error('bad slot');
      const now = this.now();
      const cur = rules.tick(this.load(now), now, this.defs);
      if (!safeSet(`${this.key}:slot:${slot}`, JSON.stringify(makeSlotFile(cur, now)))) throw new Error('storage');
      return this.listSlots();
    },
    load: async (slot) => {
      if (!validSlot(slot)) throw new Error('bad slot');
      const file = parseSlotFile(safeGet(`${this.key}:slot:${slot}`));
      if (!file) throw new Error('empty');
      const now = this.now();
      this.backupCurrent();
      // 讀進來的存檔從「現在」開始算，不會一口氣補算存檔之後經過的時間
      const loaded = rules.migrate(file.save, now, this.initialScene, this.defs);
      const fresh: PetSave = { ...loaded, lastTickAt: now, lastSeenAt: now };
      this.save(fresh);
      return rules.toView(fresh, now, 0, this.defs);
    },
    remove: async (slot) => {
      if (!validSlot(slot)) throw new Error('bad slot');
      safeRemove(`${this.key}:slot:${slot}`);
      return this.listSlots();
    },
    newGame: async () => {
      this.backupCurrent();
      safeRemove(this.key);
      safeRemove(`${this.key}:offset`);
      const now = this.now();
      const fresh = rules.migrate(null, now, this.initialScene, this.defs);
      this.save(fresh);
      return rules.toView(fresh, now, 0, this.defs);
    },
  };
  private listSlots(): SlotInfo[] {
    const now = this.now();
    const out: SlotInfo[] = [];
    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      const text = safeGet(`${this.key}:slot:${slot}`);
      const file = text == null ? null : parseSlotFile(text);
      let view: PetView | null = null;
      try {
        if (file) view = rules.toView(rules.migrate(file.save, now, this.initialScene, this.defs), now, 0, this.defs);
      } catch {
        view = null;
      }
      out.push(slotInfo(slot, file, view, text != null && !view));
    }
    return out;
  }
  /** 讀檔、開新遊戲前：目前進度先備份一份到 <key>:backup */
  private backupCurrent(): void {
    const text = safeGet(this.key);
    if (!text) return;
    safeSet(`${this.key}:backup`, text);
    safeSet(`${this.key}:backup-at`, new Date().toISOString());
  }

  // ── 以下是開發者用的（頁面網址加 ?dev 才看得到按鈕）；重置存檔玩家也能用 ──
  debugAdvance(ms: number): void {
    safeSet(`${this.key}:offset`, String(this.offset + ms));
  }
  debugReset(): void {
    // 重置前也備份一份：按錯了還救得回來
    const text = safeGet(this.key);
    if (text) {
      safeSet(`${this.key}:backup`, text);
      safeSet(`${this.key}:backup-at`, new Date().toISOString());
    }
    safeRemove(this.key);
    safeRemove(`${this.key}:offset`);
  }
}

/** 認得的存檔格式：PetSave 的 version 1、2（見 shared/state.ts 的 migrate） */
export const SAVE_VERSIONS = [1, 2] as const;
function isKnownSave(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (SAVE_VERSIONS as readonly unknown[]).includes((raw as { version?: unknown }).version);
}

function aiEndpoint(): string | null {
  try {
    return document.querySelector<HTMLMetaElement>('meta[name="whale-ai-endpoint"]')?.content || null;
  } catch {
    return null;
  }
}

// 某些內嵌環境會禁用 storage，讀寫失敗就當作沒有存檔
function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
/** 存不下（容量滿了、無痕模式）回傳 false */
function safeSet(k: string, v: string): boolean {
  try { localStorage.setItem(k, v); return true; } catch { return false; }
}
function safeRemove(k: string): void {
  try { localStorage.removeItem(k); } catch { /* ignore */ }
}
