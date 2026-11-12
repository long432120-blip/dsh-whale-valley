// V0.18：她的小願望。每天早上她會許一個小願望（wishes.json 照權重抽），
// 用到現有的玩法（餵食、釣魚、種田、帶她去哪裡、摸摸頭、送禮…），主人幫她實現就加好感、寫進日記。
// 這裡是純函數：抽願望、判斷完成；接到規則層在 gameplay.ts（applyAction、tickGame）和 state.ts（setScene）。
import type { GameplayDefs, ItemId } from './gameplay-types.ts';

/** wishes.json */
export interface WishesFile {
  version: 1;
  /** 這條任務線做完才開始許願（新手教學時不要分心）；省略 = 一開始就許 */
  afterQuest?: string;
  /** new：早上她說出願望（{wish} = 願望）；done：實現時說的話 */
  lines: { new: string[]; done: string[] };
  wishes: WishDef[];
}

export interface WishDef {
  id: string;
  /** 什麼事算完成：動作事件（fed、caught、harvested、planted、bathed、play_stopped、gifted、talked、placed、mine_returned、headpat…）或 enter（走進 scene） */
  event: string;
  emoji: string;
  /** {item} = 抽到的東西、{npc} = 抽到的居民、{n} = 次數 */
  text: string;
  /** 從這裡抽一樣（例如想吃什麼）；完成條件要是這樣東西 */
  items?: ItemId[];
  /** 從這裡抽一位居民 */
  npcs?: string[];
  /** event = enter 時：走進哪張地圖 */
  scene?: string;
  /** 要做幾次（預設 1） */
  count?: number;
  affection: number;
  coins?: number;
  /** 告訴主人怎麼做 */
  hint: string;
  /** 抽中的權重（預設 1） */
  weight?: number;
  /** 只在這些季節出現 */
  seasons?: string[];
}

/** 存檔裡今天的願望 */
export interface WishState {
  day: string;
  id: string;
  text: string;
  emoji: string;
  hint: string;
  event: string;
  item?: ItemId;
  npc?: string;
  scene?: string;
  need: number;
  progress: number;
  done: boolean;
  affection: number;
  coins: number;
}

/** 願望的訊號（跟任務一樣）：事件種類、相關的東西、居民、地圖、數量 */
export interface WishTrigger {
  event: string;
  items: ItemId[];
  npc?: string;
  scene?: string;
  count: number;
}

/** 抽今天的願望；沒有可以抽的（或還在新手教學）回傳 null */
export function rollWish(
  file: WishesFile | undefined,
  d: GameplayDefs,
  ctx: { day: string; season?: string; questDone: Record<string, unknown>; yesterday?: string },
  rnd: () => number,
): WishState | null {
  if (!file?.wishes.length) return null;
  if (file.afterQuest && !ctx.questDone[file.afterQuest]) return null;
  let pool = file.wishes.filter((w) => (!w.seasons || !ctx.season || w.seasons.includes(ctx.season)) && (!w.items || w.items.some((i) => d.items.has(i))));
  // 不要連兩天許一樣的願望
  if (pool.length > 1 && ctx.yesterday) pool = pool.filter((w) => w.id !== ctx.yesterday);
  const total = pool.reduce((t, w) => t + (w.weight ?? 1), 0);
  if (!total) return null;
  let r = rnd() * total;
  const w = pool.find((x) => (r -= x.weight ?? 1) < 0) ?? pool[pool.length - 1]!;
  const items = (w.items ?? []).filter((i) => d.items.has(i));
  const item = items.length ? items[Math.floor(rnd() * items.length) % items.length] : undefined;
  const npcs = (w.npcs ?? []).filter((n) => d.file.npcs?.[n]);
  const npc = npcs.length ? npcs[Math.floor(rnd() * npcs.length) % npcs.length] : undefined;
  const need = Math.max(1, w.count ?? 1);
  const text = w.text
    .replace('{item}', item ? d.items.get(item)?.name ?? item : '')
    .replace('{npc}', npc ? d.file.npcs?.[npc]?.name ?? npc : '')
    .replace('{n}', String(need));
  return {
    day: ctx.day, id: w.id, text, emoji: w.emoji, hint: w.hint, event: w.event,
    ...(item ? { item } : {}), ...(npc ? { npc } : {}), ...(w.scene ? { scene: w.scene } : {}),
    need, progress: 0, done: false, affection: w.affection, coins: w.coins ?? 0,
  };
}

/** 這個訊號有沒有算到願望上；回傳要加幾次（0 = 沒有） */
export function wishHit(w: WishState, t: WishTrigger): number {
  if (w.done || w.event !== t.event) return 0;
  if (w.item && !t.items.includes(w.item)) return 0;
  if (w.npc && w.npc !== t.npc) return 0;
  if (w.scene && w.scene !== t.scene) return 0;
  return Math.max(1, t.count);
}

/** 讀存檔：格式不對就當作今天還沒許願（下一次結算會重抽） */
export function normalizeWish(raw: unknown): WishState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown, max = 60) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const n = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
  if (!s(r.day) || !s(r.id) || !s(r.event)) return null;
  return {
    day: s(r.day)!, id: s(r.id)!, text: s(r.text, 80) ?? '', emoji: s(r.emoji, 8) ?? '💭', hint: s(r.hint, 80) ?? '', event: s(r.event)!,
    ...(s(r.item) ? { item: s(r.item) } : {}), ...(s(r.npc) ? { npc: s(r.npc) } : {}), ...(s(r.scene) ? { scene: s(r.scene) } : {}),
    need: Math.max(1, n(r.need, 1)), progress: Math.max(0, n(r.progress, 0)), done: r.done === true,
    affection: Math.max(0, n(r.affection, 0)), coins: Math.max(0, n(r.coins, 0)),
  };
}

/** 檢查 wishes.json */
export function validateWishes(f: WishesFile | undefined, d: { items: Map<string, unknown>; npcs: Record<string, unknown> }): string[] {
  if (!f) return [];
  const out: string[] = [];
  if (!f.lines?.new?.length || !f.lines?.done?.length) out.push('wishes.json：lines 要有 new 和 done');
  if (!f.wishes?.length) out.push('wishes.json：wishes 至少要一個');
  const ids = new Set<string>();
  for (const w of f.wishes ?? []) {
    const at = `wishes.json「${w.id}」`;
    if (ids.has(w.id)) out.push(`${at}：id 重複`);
    ids.add(w.id);
    if (!w.event || !w.text || !w.emoji || !w.hint) out.push(`${at}：要有 event、text、emoji、hint`);
    if (w.event === 'enter' && !w.scene) out.push(`${at}：event 是 enter 就要寫 scene`);
    if (!(w.affection >= 0) || (w.coins !== undefined && !(w.coins >= 0))) out.push(`${at}：affection、coins 要 ≥ 0`);
    if (w.count !== undefined && !(w.count >= 1)) out.push(`${at}：count 要 ≥ 1`);
    for (const i of w.items ?? []) if (!d.items.has(i)) out.push(`${at}：物品 ${i} 不存在`);
    for (const n of w.npcs ?? []) if (!d.npcs[n]) out.push(`${at}：居民 ${n} 不存在`);
    if (w.text.includes('{item}') && !w.items?.length) out.push(`${at}：text 有 {item} 就要有 items`);
    if (w.text.includes('{npc}') && !w.npcs?.length) out.push(`${at}：text 有 {npc} 就要有 npcs`);
  }
  return out;
}
