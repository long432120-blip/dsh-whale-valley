// V0.22：非同步社交的規則（host 和瀏覽器共用，純函數）
//   交易所：每天換一批系統商品（用金幣買）
//   我的攤位：掛單時商品先從揹包扣住；攤位碼給朋友 → 朋友付錢拿貨、給你收款碼 → 你兌換收款碼拿錢
//   領養碼：寵物離開你家、打包成碼；24 小時只能產生一次
//   串門：邀請碼（農場快照，唯讀）→ 朋友來玩、幫忙澆水、留信 → 回信碼 → 你收進信箱
//
// 防作弊（沒有伺服器能做到的程度）：
//   1. 校驗碼（codec.ts）：改了碼裡任何一個字就失效
//   2. 範圍檢查：價格、數量、好感、飽食……都要在合理範圍內，就算重算了校驗碼也過不了
//   3. 只能兌換一次：兌換過的碼記在存檔（trade.redeemed）
//   4. 轉移不複製：掛單、送養都會先從自己的存檔拿走
//   5. 有效期限：碼裡有產生時間，太舊或來自未來的都不收
import { dayKey } from './time.ts';
import type { GameplayDefs, ItemId, PetState, PlotId } from './gameplay-types.ts';
import type { FilterDef } from './profanity.ts';

export interface SocialFile {
  version: 1;
  salt: string;
  nick: { default: string; maxLength: number };
  market: { offers: number; markup: [number, number]; stock: [number, number]; categories: string[] };
  stall: { maxListings: number; maxQty: number; priceMin: number; priceMax: number; codeDays: number; categories: string[] };
  receipt: { codeDays: number };
  adopt: { cooldownHours: number; codeDays: number; nameMax: number };
  visit: { codeDays: number; letterMax: number; replyDays: number };
  mailbox: { keep: number };
  chat: ChatDef;
}

export interface ChatBot { id: string; name: string; emoji: string; tag: string }
export interface ChatDef extends FilterDef {
  maxLength: number;
  minIntervalMs: number;
  keep: number;
  banner: string;
  bots: ChatBot[];
  replies: { keywords: string[]; lines: string[] }[];
  fallback: string[];
  ambient: string[];
}

export interface StallListing {
  id: string;
  item: ItemId;
  qty: number;
  /** 單價 */
  price: number;
  at: number;
  status: 'open' | 'sold' | 'cancelled';
  /** 賣出時：買家暱稱 */
  buyer?: string;
  /** 掛單時產生的攤位碼（給玩家再複製一次用） */
  code: string;
}

export interface Letter {
  id: string;
  from: string;
  nick: string;
  text: string;
  at: number;
  /** 朋友幫你澆了幾格田 */
  watered: number;
  read: boolean;
}

export interface TradeState {
  /** 這個存檔的交易代號（隨機產生，不是個人資料） */
  id: string;
  nick: string;
  stall: StallListing[];
  /** 兌換過的碼：key → 兌換時間 */
  redeemed: Record<string, number>;
  /** 上次產生領養碼的時間 */
  adoptCodeAt: number;
  market: { day: string; bought: Record<string, number> };
}

// ── 碼裡的內容 ──
export interface StallPayload { v: 1; id: string; from: string; nick: string; item: ItemId; qty: number; price: number; at: number }
export interface ReceiptPayload { v: 1; id: string; to: string; buyer: string; nick: string; qty: number; total: number; at: number }
export interface PetPayload { v: 1; id: string; from: string; nick: string; kind: string; name: string; affection: number; satiety: number; obtainedAt: number; at: number }
export interface ReplyPayload { v: 1; to: string; from: string; nick: string; text: string; watered: PlotId[]; at: number }
export interface VisitPayload {
  v: 1; from: string; nick: string; at: number; scene: string;
  /** 農場快照：只放看得到的東西（不放揹包、日記、任務） */
  game: Record<string, unknown>;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** 允許的時鐘誤差：兩台電腦的時間差一點點沒關係 */
export const CLOCK_SKEW = 10 * 60_000;

export const newTradeId = (rnd: () => number, now: number) =>
  `t${Math.floor(rnd() * 2 ** 32).toString(36)}${(now % 2 ** 24).toString(36)}`;

export function emptyTrade(nick: string, rnd: () => number, now: number): TradeState {
  return { id: newTradeId(rnd, now), nick, stall: [], redeemed: {}, adoptCodeAt: 0, market: { day: '', bought: {} } };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
const str = (v: unknown, max: number, re?: RegExp): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max && (!re || re.test(v)) ? v : null;
const ID = /^[a-z0-9]{1,40}$/;

/** 暱稱、寵物名字：去掉控制字元與換行，限制長度 */
export function cleanName(v: unknown, max: number): string {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

/** 存檔讀進來時：壞掉的欄位補預設值、數量設上限 */
export function normalizeTrade(raw: unknown, fallback: TradeState, s?: SocialFile): TradeState {
  if (!isObj(raw)) return fallback;
  const nickMax = s?.nick.maxLength ?? 12;
  const stall = (Array.isArray(raw.stall) ? raw.stall : []).filter(isObj).map((l): StallListing | null => {
    const qty = int(l.qty, 1, 9999);
    const price = int(l.price, 1, 99_999_999);
    if (typeof l.id !== 'string' || typeof l.item !== 'string' || !qty || !price) return null;
    return {
      id: l.id, item: l.item, qty, price, at: typeof l.at === 'number' ? l.at : 0,
      status: l.status === 'sold' || l.status === 'cancelled' ? l.status : 'open',
      buyer: typeof l.buyer === 'string' ? cleanName(l.buyer, nickMax) : undefined,
      code: typeof l.code === 'string' ? l.code : '',
    };
  }).filter((l): l is StallListing => !!l).slice(-20);
  const redeemed: Record<string, number> = {};
  for (const [k, v] of Object.entries(isObj(raw.redeemed) ? raw.redeemed : {})) if (typeof v === 'number') redeemed[k.slice(0, 120)] = v;
  const market = isObj(raw.market) ? raw.market : {};
  const bought: Record<string, number> = {};
  for (const [k, v] of Object.entries(isObj(market.bought) ? market.bought : {})) if (typeof v === 'number' && v > 0) bought[k] = Math.floor(v);
  return {
    id: typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : fallback.id,
    nick: cleanName(raw.nick, nickMax) || fallback.nick,
    stall,
    redeemed,
    adoptCodeAt: typeof raw.adoptCodeAt === 'number' && Number.isFinite(raw.adoptCodeAt) ? raw.adoptCodeAt : 0,
    market: { day: typeof market.day === 'string' ? market.day : '', bought },
  };
}

export function normalizeMailbox(raw: unknown, keep: number): Letter[] {
  return (Array.isArray(raw) ? raw : []).filter(isObj).map((l): Letter | null => {
    if (typeof l.id !== 'string' || typeof l.text !== 'string') return null;
    return {
      id: l.id, from: typeof l.from === 'string' ? l.from : '', nick: cleanName(l.nick, 12) || '朋友',
      text: String(l.text).slice(0, 300), at: typeof l.at === 'number' ? l.at : 0,
      watered: int(l.watered, 0, 999) ?? 0, read: l.read === true,
    };
  }).filter((l): l is Letter => !!l).slice(-keep);
}

/** 碼還在有效期限內嗎（也不能來自太遠的未來） */
export const fresh = (at: number, now: number, days: number) => at <= now + CLOCK_SKEW && now - at <= days * DAY;

// ── 交易所：每天換一批（同一天同一個存檔看到的都一樣） ──
export interface MarketOffer { item: ItemId; price: number; stock: number; left: number }

function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function marketOffers(d: GameplayDefs, now: number, bought: Record<string, number> = {}): MarketOffer[] {
  const s = d.file.social;
  if (!s) return [];
  const day = dayKey(now);
  const rnd = seeded(`${s.salt}|market|${day}`);
  const pool = [...d.items.values()]
    .filter((it) => (it.price ?? 0) > 0 && s.market.categories.includes(it.category))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const out: MarketOffer[] = [];
  const [lo, hi] = s.market.markup;
  const [smin, smax] = s.market.stock;
  while (out.length < s.market.offers && pool.length) {
    const it = pool.splice(Math.floor(rnd() * pool.length), 1)[0]!;
    const price = Math.max(1, Math.ceil(it.price! * (lo + (hi - lo) * rnd())));
    const stock = smin + Math.floor(rnd() * (smax - smin + 1));
    out.push({ item: it.id, price, stock, left: Math.max(0, stock - (bought[it.id] ?? 0)) });
  }
  return out;
}

// ── 攤位：單價的合理範圍 ──
export function stallPriceRange(d: GameplayDefs, item: ItemId): [number, number] | null {
  const s = d.file.social;
  const it = d.items.get(item);
  if (!s || !it || !(it.price && it.price > 0) || !s.stall.categories.includes(it.category)) return null;
  return [Math.max(1, Math.ceil(it.price * s.stall.priceMin)), Math.max(1, Math.floor(it.price * s.stall.priceMax))];
}

// ── 碼裡的內容逐欄檢查（校驗碼過了，也要再檢查一次範圍） ──
export function checkStall(p: unknown, d: GameplayDefs, now: number): StallPayload | null {
  const s = d.file.social!;
  if (!isObj(p) || p.v !== 1) return null;
  const id = str(p.id, 40, ID);
  const from = str(p.from, 40, ID);
  const item = str(p.item, 60);
  const qty = int(p.qty, 1, s.stall.maxQty);
  const price = int(p.price, 1, 99_999_999);
  const at = int(p.at, 0, Number.MAX_SAFE_INTEGER);
  if (!id || !from || !item || !qty || !price || at === null) return null;
  const range = stallPriceRange(d, item);
  if (!range || price < range[0] || price > range[1]) return null;
  if (!fresh(at, now, s.stall.codeDays)) return null;
  return { v: 1, id, from, nick: cleanName(p.nick, s.nick.maxLength) || '朋友', item, qty, price, at };
}

export function checkReceipt(p: unknown, d: GameplayDefs, now: number): ReceiptPayload | null {
  const s = d.file.social!;
  if (!isObj(p) || p.v !== 1) return null;
  const id = str(p.id, 40, ID);
  const to = str(p.to, 40, ID);
  const buyer = str(p.buyer, 40, ID);
  const qty = int(p.qty, 1, s.stall.maxQty);
  const total = int(p.total, 1, 99_999_999 * 99);
  const at = int(p.at, 0, Number.MAX_SAFE_INTEGER);
  if (!id || !to || !buyer || !qty || !total || at === null || !fresh(at, now, s.receipt.codeDays)) return null;
  return { v: 1, id, to, buyer, nick: cleanName(p.nick, s.nick.maxLength) || '朋友', qty, total, at };
}

export function checkPet(p: unknown, d: GameplayDefs, now: number): PetPayload | null {
  const s = d.file.social!;
  const pets = d.file.pets;
  if (!isObj(p) || p.v !== 1 || !pets) return null;
  const id = str(p.id, 40, ID);
  const from = str(p.from, 40, ID);
  const kind = str(p.kind, 40);
  const affection = int(p.affection, 0, pets.affection.max);
  const satiety = int(p.satiety, 0, pets.satiety.max);
  const at = int(p.at, 0, Number.MAX_SAFE_INTEGER);
  const obtainedAt = int(p.obtainedAt, 0, Number.MAX_SAFE_INTEGER);
  if (!id || !from || !kind || !pets.species[kind] || affection === null || satiety === null || at === null || obtainedAt === null) return null;
  if (obtainedAt > at + CLOCK_SKEW || !fresh(at, now, s.adopt.codeDays)) return null;
  const name = cleanName(p.name, s.adopt.nameMax) || pets.species[kind]!.name;
  return { v: 1, id, from, nick: cleanName(p.nick, s.nick.maxLength) || '朋友', kind, name, affection, satiety, obtainedAt, at };
}

export function checkReply(p: unknown, d: GameplayDefs, now: number): ReplyPayload | null {
  const s = d.file.social!;
  if (!isObj(p) || p.v !== 1) return null;
  const to = str(p.to, 40, ID);
  const from = str(p.from, 40, ID);
  const at = int(p.at, 0, Number.MAX_SAFE_INTEGER);
  if (!to || !from || at === null || !fresh(at, now, s.visit.replyDays)) return null;
  const text = cleanName(typeof p.text === 'string' ? p.text.replace(/\s+/g, ' ') : '', s.visit.letterMax);
  const watered = (Array.isArray(p.watered) ? p.watered : []).filter((x): x is string => typeof x === 'string' && x.length <= 60).slice(0, 40);
  if (!text && !watered.length) return null;
  return { v: 1, to, from, nick: cleanName(p.nick, s.nick.maxLength) || '朋友', text, watered: [...new Set(watered)], at };
}

/** 送養時打包的寵物資料 */
export function petPayload(pet: PetState, trade: TradeState, nonce: string, now: number): PetPayload {
  return { v: 1, id: nonce, from: trade.id, nick: trade.nick, kind: pet.kind, name: pet.name, affection: Math.floor(pet.affection), satiety: Math.floor(pet.satiety), obtainedAt: pet.obtainedAt, at: now };
}
