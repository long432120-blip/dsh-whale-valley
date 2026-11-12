// V0.8 AI 對話：鯨魚娘和居民依照遊戲狀態，用大模型（DeepSeek／OpenAI 相容格式）即時生成台詞。
// 這個檔案是 host、demo 開發伺服器、瀏覽器三邊共用的純函數，不碰網路、不碰 API Key。
//   - API Key 只存在 host（DSH 插件設定或 .env），瀏覽器永遠拿不到。
//   - 瀏覽器只送「誰在說話、為什麼說話」；遊戲狀態由 host 自己從存檔整理（DSH 模式）。
//   - 任何失敗（沒有 Key、逾時、被擋）都回傳 { ok: false }，畫面改用原本 JSON 裡的台詞。
import type { GameplayDefs, ItemId } from './gameplay-types.ts';
import type { PetView } from './types.ts';

// ───────────── 介面 ─────────────
/** 誰在說話：'whale' = 鯨魚娘；其他 = 居民 id（fisher、florist、smith…） */
export type AiSpeaker = string;

/** 為什麼說話：只有玩家主動點擊、或重大事件才會發請求 */
export type AiTrigger = 'click' | 'talk' | 'legendary' | 'goddess' | 'weather' | 'levelup';
export const AI_TRIGGERS: readonly AiTrigger[] = ['click', 'talk', 'legendary', 'goddess', 'weather', 'levelup'];

/** 事件的細節（只收 id，名稱由 host 查表，瀏覽器不能塞任意文字進 prompt） */
export interface AiEvent {
  item?: ItemId;
  weather?: string;
  level?: string;
}

export interface ChatRequest {
  speaker: AiSpeaker;
  trigger: AiTrigger;
  event?: AiEvent;
  /** 只有 demo 開發伺服器會用（它看不到瀏覽器裡的存檔）；DSH 模式 host 一律用自己的存檔，忽略這個欄位 */
  snapshot?: DialogueSnapshot;
}

export type ChatFailReason =
  | 'disabled' // 設定裡關掉了
  | 'no_key' // 沒有設定 API Key
  | 'rate_limited' // 防抖：太頻繁
  | 'timeout' // 逾時
  | 'http' // API 回了錯誤狀態（401、429、5xx…）
  | 'network' // 連不上
  | 'bad_response' // 回應格式不對、或內容被過濾成空的
  | 'bad_request'; // 請求格式不對

export type ChatReply = { ok: true; text: string; source: 'ai' } | { ok: false; reason: ChatFailReason; retryInMs?: number };

/** OpenAI 相容格式的訊息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 塞進 System Prompt 的遊戲狀態（純文字欄位，已經翻成中文） */
export interface DialogueSnapshot {
  scene: string;
  season?: string;
  phase: string;
  clock: string;
  weather: string;
  festival?: string;
  stamina: number;
  staminaMax: number;
  satiety: number;
  satietyMax: number;
  affection: number;
  level: string;
  married: boolean;
  coins: number;
  /** 由數值推出來的身體狀況：很累、肚子很餓… */
  mood: string[];
  /** 揹包裡的東西（名稱×數量，最多 10 種，吃的排前面） */
  inventory: string[];
  pets: string[];
  quest?: string;
  /** V0.18：她今天的小願望（實現了就加「（主人已經幫你實現了）」） */
  wish?: string;
}

/** ai.json：角色設定、觸發句、回覆長度、記憶長度、防抖間隔（全部資料驅動） */
export interface AiFile {
  version: 1;
  /** 回覆最多幾個字（超過會截斷） */
  maxReplyChars: number;
  /** 記住最近幾輪對話（一輪 = 一問一答） */
  historyTurns: number;
  temperature: number;
  maxTokens: number;
  /** 防抖：同一個角色兩次請求至少隔多久（瀏覽器和 host 各擋一次） */
  minIntervalMs: number;
  /** 全部角色加起來，每分鐘最多幾次（保護 API 費用） */
  perMinute: number;
  /** 共通規則（每個角色都會加上） */
  rules: string[];
  personas: Record<AiSpeaker, { name: string; prompt: string }>;
  /** 觸發句：變成這一輪的 user 訊息；{item}、{weather}、{level} 會換成名稱 */
  triggers: Record<AiTrigger, string>;
  /** V0.17：每天睡覺時寫的「像素日記」（只有 DSH 的 host 會用；用鯨魚娘的角色設定） */
  diary?: AiDiaryDef;
}

/** V0.17：ai.json 的 diary */
export interface AiDiaryDef {
  /** 日記最多幾個字（超過會截斷） */
  maxChars: number;
  temperature: number;
  maxTokens: number;
  /** 寫日記的規則（{max} 換成 maxChars） */
  rules: string[];
  /** 最後一句：請她寫日記 */
  request: string;
}

/** V0.17：寫日記的 messages：system = 鯨魚娘的角色設定＋寫日記的規則；user = 今天的紀錄＋請她寫 */
export function buildDiaryMessages(file: AiFile, dayText: string): ChatMessage[] | null {
  const p = file.personas.whale;
  const dc = file.diary;
  if (!p || !dc) return null;
  const system = [p.prompt, '', '【規則】', ...dc.rules.map((r) => `- ${r.replace('{max}', String(dc.maxChars))}`)].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `【今天發生的事】\n${dayText}\n\n${dc.request}` },
  ];
}

// ───────────── 遊戲狀態 → 快照 ─────────────
const PHASE: Record<string, string> = { morning: '早上', afternoon: '下午', evening: '傍晚', night: '晚上' };

export function snapshotFromView(view: PetView, defs: GameplayDefs, sceneName: (id: string) => string, now = view.now): DialogueSnapshot {
  const g = view.game;
  const d = new Date(now);
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const base: DialogueSnapshot = {
    scene: sceneName(view.sceneId),
    phase: PHASE[view.phase] ?? view.phase,
    clock,
    weather: '晴天',
    stamina: 0, staminaMax: 0, satiety: 0, satietyMax: 0, affection: 0, level: '', married: false, coins: 0,
    mood: [], inventory: [], pets: [],
  };
  if (!g) return base;
  const mood: string[] = [];
  const low = g.stats?.lowRatio ?? 0.3;
  if (g.stamina <= 0) mood.push('一點體力都沒有了');
  else if (g.stamina < g.stats.staminaBase * low) mood.push('很累');
  if (g.satiety <= 0) mood.push('餓到頭昏、很渴');
  else if (g.satiety < g.satietyMax * low) mood.push('肚子很餓、有點渴');
  else if (g.satiety >= g.satietyMax * 0.9) mood.push('吃得很飽');
  if (g.luckUntil > now) mood.push('受到湖中女神的祝福，運氣很好');
  // 揹包：吃的排前面，最多 10 種
  const items = Object.entries(g.inventory)
    .filter(([id, n]) => n > 0 && id !== 'coin')
    .map(([id, n]) => ({ id, n, def: defs.items.get(id) }))
    .sort((a, b) => Number(!!b.def?.food) - Number(!!a.def?.food) || b.n - a.n)
    .slice(0, 10)
    .map((x) => `${x.def?.name ?? x.id}×${x.n}`);
  return {
    ...base,
    season: g.season ? `${g.season.name}天第 ${g.season.day} 天` : undefined,
    weather: g.weather?.name ?? '晴天',
    festival: g.festival?.name,
    stamina: g.stamina,
    staminaMax: g.staminaMax,
    satiety: g.satiety,
    satietyMax: g.satietyMax,
    affection: g.affection,
    level: g.level,
    married: g.married,
    coins: g.coins,
    mood,
    inventory: items,
    pets: (g.pets ?? []).map((p) => (p.name === p.speciesName ? p.name : `${p.name}（${p.speciesName}）`)),
    quest: g.quest?.task,
    wish: g.wish ? `${g.wish.text}${g.wish.done ? '（主人已經幫你實現了）' : ''}` : undefined,
  };
}

/** 給 demo 開發伺服器用：瀏覽器送來的快照只信任「格式正確、長度有限」的欄位 */
export function sanitizeSnapshot(raw: unknown): DialogueSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 24) => (typeof v === 'string' ? v.replace(/[\r\n{}<>]/g, ' ').slice(0, max) : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x).slice(0, n) : []);
  return {
    scene: str(r.scene) ?? '',
    season: str(r.season),
    phase: str(r.phase) ?? '',
    clock: str(r.clock, 5) ?? '',
    weather: str(r.weather) ?? '',
    festival: str(r.festival),
    stamina: num(r.stamina), staminaMax: num(r.staminaMax), satiety: num(r.satiety), satietyMax: num(r.satietyMax),
    affection: num(r.affection), level: str(r.level) ?? '', married: r.married === true, coins: num(r.coins),
    mood: list(r.mood, 6), inventory: list(r.inventory, 10), pets: list(r.pets, 6), quest: str(r.quest, 40), wish: str(r.wish, 40),
  };
}

// ───────────── Prompt 組裝 ─────────────
/** 把遊戲狀態寫成一段給模型看的文字 */
export function describeSnapshot(s: DialogueSnapshot, forWhale: boolean): string {
  const lines = [
    `現在是${s.season ? `${s.season}、` : ''}${s.phase}（${s.clock}），天氣${s.weather}${s.festival ? `，今天是${s.festival}` : ''}，地點在${s.scene}。`,
  ];
  if (forWhale) {
    lines.push(`你的體力 ${s.stamina}/${s.staminaMax}，飽食度 ${s.satiety}/${s.satietyMax}，對主人的好感 ${s.affection}（${s.level}）${s.married ? '，你們已經結婚了' : ''}。`);
    if (s.mood.length) lines.push(`你現在的狀況：${s.mood.join('、')}。`);
    lines.push(s.inventory.length ? `揹包裡有：${s.inventory.join('、')}。` : '揹包是空的。');
    if (s.pets.length) lines.push(`家裡的寵物：${s.pets.join('、')}。`);
    if (s.quest) lines.push(`目前的任務：${s.quest}。`);
    if (s.wish) lines.push(`你今天的小願望：${s.wish}`);
  } else {
    lines.push(`鯨魚娘和主人來找你。鯨魚娘現在${s.mood.length ? s.mood.join('、') : '精神不錯'}。`);
  }
  return lines.join('\n');
}

/** System Prompt = 角色設定 + 共通規則 + 目前的遊戲狀態 */
export function buildSystemPrompt(file: AiFile, speaker: AiSpeaker, s: DialogueSnapshot): string | null {
  const p = file.personas[speaker];
  if (!p) return null;
  return [
    p.prompt,
    '',
    '【規則】',
    ...file.rules.map((r) => `- ${r.replace('{max}', String(file.maxReplyChars))}`),
    '',
    '【現在的狀況】',
    describeSnapshot(s, speaker === 'whale'),
  ].join('\n');
}

/** 這一輪的 user 訊息：觸發句，事件 id 換成名稱 */
export function triggerText(file: AiFile, req: ChatRequest, defs?: GameplayDefs): string {
  const t = file.triggers[req.trigger] ?? file.triggers.click;
  const item = req.event?.item ? defs?.items.get(req.event.item)?.name ?? '' : '';
  const weather = req.event?.weather ? defs?.file.weather?.types.find((w) => w.id === req.event!.weather)?.name ?? '' : '';
  const level = req.event?.level ? String(req.event.level).slice(0, 12) : '';
  return t.replace('{item}', item).replace('{weather}', weather).replace('{level}', level);
}

/** 組出要送的 messages：system + 最近的記憶 + 這一輪 */
export function buildMessages(system: string, history: ChatMessage[], user: string, historyTurns: number): ChatMessage[] {
  const keep = history.filter((m) => m.role !== 'system').slice(-historyTurns * 2);
  return [{ role: 'system', content: system }, ...keep, { role: 'user', content: user }];
}

/** 模型的回覆整理成一句台詞：去掉引號、Markdown、角色名前綴、思考標記；太長就截斷；空的回傳 null */
export function sanitizeReply(text: unknown, maxChars: number, names: string[] = []): string | null {
  if (typeof text !== 'string') return null;
  let t = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
  const unquote = (x: string) => x.replace(/^[「『"“]+|[」』"”]+$/g, '').trim();
  t = unquote(t); // V0.17：「鯨魚娘：……」這種先拿掉外面的引號，再拿掉名字
  for (const n of names) if (n && (t.startsWith(`${n}：`) || t.startsWith(`${n}:`))) t = t.slice(n.length + 1).trim();
  t = unquote(t);
  if (!t) return null;
  const chars = [...t];
  if (chars.length > maxChars) {
    // 盡量在標點斷句
    const cut = chars.slice(0, maxChars).join('');
    const at = Math.max(...['。', '！', '？', '～', '…', '!', '?'].map((p) => cut.lastIndexOf(p)));
    t = at >= maxChars * 0.5 ? cut.slice(0, at + 1) : `${cut}…`;
  }
  return t;
}

// ───────────── 請求驗證 ─────────────
/** 瀏覽器送來的請求：只接受認得的角色、觸發；事件只收 id */
export function parseChatRequest(raw: unknown, speakers: string[]): ChatRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.speaker !== 'string' || !speakers.includes(r.speaker)) return null;
  if (typeof r.trigger !== 'string' || !(AI_TRIGGERS as readonly string[]).includes(r.trigger)) return null;
  const e = r.event && typeof r.event === 'object' ? (r.event as Record<string, unknown>) : {};
  const id = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : undefined);
  const event: AiEvent = {};
  if (id(e.item)) event.item = id(e.item);
  if (id(e.weather)) event.weather = id(e.weather);
  if (typeof e.level === 'string') event.level = e.level.replace(/[\r\n{}<>]/g, '').slice(0, 12);
  // 快照不在這裡收：DSH 的 host 用自己的存檔；demo 開發伺服器另外用 sanitizeSnapshot 清理
  return { speaker: r.speaker, trigger: r.trigger as AiTrigger, event };
}

// ───────────── 防抖 ─────────────
/**
 * 每個角色兩次請求至少隔 minIntervalMs；同一個角色有請求在路上時不再發；
 * 全部角色加起來每分鐘最多 perMinute 次。瀏覽器和 host 各用一個（瀏覽器擋狂點，host 擋繞過瀏覽器的請求）。
 */
export class RateGate {
  private readonly last = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private recent: number[] = [];

  constructor(
    private readonly minIntervalMs: number,
    private readonly perMinute = Infinity,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 可以發就登記並回傳 0；不行就回傳還要等幾毫秒 */
  acquire(key: string): number {
    const t = this.now();
    this.recent = this.recent.filter((x) => t - x < 60_000);
    if (this.inFlight.has(key)) return this.minIntervalMs;
    const wait = (this.last.get(key) ?? -Infinity) + this.minIntervalMs - t;
    if (wait > 0) return wait;
    if (this.recent.length >= this.perMinute) return 60_000 - (t - this.recent[0]!);
    this.last.set(key, t);
    this.recent.push(t);
    this.inFlight.add(key);
    return 0;
  }
  release(key: string): void {
    this.inFlight.delete(key);
  }
}
