// 玩法規則：全部是純函數，host（DSH service）和 demo（LocalBridge）共用。
// 時間 now 由呼叫端傳入、亂數狀態存在存檔裡，所以同樣的輸入一定得到同樣的結果。
import {
  COIN, RARITIES,
  type ActError, type AnimalState, type CollectionReward, type Cost, type CropDef, type FestivalDef,
  type GameAction, type GameEvent, type GameplayDefs, type GameplayFile, type GameplayMod, type GameState, type GameView,
  type ItemDef, type ItemId, type LootEntry, type MineReport, type MineZone, type NpcState, type PlotState, type PlotView,
  type QuestCondition, type QuestLog, type QuestView, type Rarity, type SeasonId, type StatView, type TavernFile, type WeatherDef, type WeatherId,
} from './gameplay-types.ts';
import { dayIndex, dayKey, dayPhase, dayStart } from './time.ts';
import { normalizeWish, rollWish, wishHit, type WishTrigger } from './wishes.ts';
import { dayFacts, emptyLog, logEvent, normalizeDiary, normalizeLog, templateDiary, type DiaryEntry } from './diary.ts';
import {
  forageLeft, isPetAction, newPetState, normalizePets, petRareMult, petViews, runPet, tickFarmAndPets, validatePets, wildList,
} from './pets.ts';
import type { DayPhase } from './types.ts';
import { isSocialAction, runSocial } from './social-rules.ts';
import { emptyTrade, marketOffers, normalizeMailbox, normalizeTrade, HOUR as T_HOUR } from './trade.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY_MS = 24 * HOUR;
const MAX_OFFLINE_MS = 72 * HOUR;

// ───────────── 亂數（mulberry32） ─────────────
export function rngFrom(seed: number) {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get state() {
      return a;
    },
  };
}

export { dayKey };

// ───────────── 季節、天氣、節慶：只看日期就能算出來，不用存檔 ─────────────
export function seasonAt(now: number, d: GameplayDefs) {
  const c = d.file.calendar;
  if (!c?.seasons.length) return null;
  const idx = dayIndex(now);
  if (!Number.isFinite(idx)) return null; // V0.21：時間壞掉（例如存檔被手改）就當作沒有季節，不要讓遊戲當掉
  const len = Math.max(1, c.seasonDays);
  const n = c.seasons.length;
  const s = c.seasons[((Math.floor(idx / len) % n) + n) % n]!;
  return { ...s, day: (((idx % len) + len) % len) + 1, days: len };
}

/** 沒有 weather.json 時的兩種天氣 */
const BUILTIN_WEATHER: Record<string, WeatherDef> = {
  sunny: { id: 'sunny', name: '晴天', emoji: '☀️', wet: false },
  rainy: { id: 'rainy', name: '雨天', emoji: '🌧️', wet: true, rareBonus: 0.2, particles: { count: 70, speed: 190, length: 3, slant: 30, color: 'rgba(205,225,255,0.6)' }, tint: 'rgba(40,60,110,0.12)' },
};

/**
 * 每天的天氣固定（同一天怎麼問都一樣），用日期當種子。
 * 有 weather.json：照那一季的權重抽；沒有：照 calendar 的 rainChance。
 */
export function weatherAt(now: number, d: GameplayDefs): WeatherId {
  const s = seasonAt(now, d);
  if (!s) return 'sunny';
  const r = rngFrom(dayIndex(now) * 7919 + 17).next();
  const w = d.file.weather;
  if (!w) return r < s.rainChance ? 'rainy' : 'sunny';
  const weights = Object.entries(w.seasons[s.id] ?? w.default).filter(([id, n]) => n > 0 && w.types.some((t) => t.id === id));
  const total = weights.reduce((n, [, x]) => n + x, 0);
  let x = r * total;
  for (const [id, n] of weights) {
    x -= n;
    if (x < 0) return id;
  }
  return weights.at(-1)?.[0] ?? 'sunny';
}

export function weatherDef(id: WeatherId, d: GameplayDefs): WeatherDef {
  return d.file.weather?.types.find((t) => t.id === id) ?? BUILTIN_WEATHER[id] ?? BUILTIN_WEATHER.sunny!;
}

export function festivalAt(now: number, d: GameplayDefs): FestivalDef | null {
  const s = seasonAt(now, d);
  if (!s) return null;
  return d.file.calendar?.festivals?.find((f) => f.season === s.id && f.day === s.day) ?? null;
}


// ───────────── 定義：建立、合併 mod、檢查 ─────────────
export function buildDefs(file: GameplayFile): GameplayDefs {
  const items = new Map(file.items.map((i) => [i.id, i]));
  const crops = new Map(file.crops.map((c) => [c.id, c]));
  const cropBySeed = new Map(file.crops.map((c) => [c.seed, c]));
  return { file, items, crops, cropBySeed };
}

function upsert<T extends { id: string }>(list: T[], add: T[] | undefined) {
  for (const it of add ?? []) {
    const i = list.findIndex((x) => x.id === it.id);
    if (i >= 0) list[i] = it;
    else list.push(it);
  }
}

/**
 * 合併 mods：同 id 覆蓋、新 id 新增；掉落表、交換清單往後追加；calendar 整個換掉。
 * 有問題的 mod 整個略過，不會讓遊戲壞掉。
 */
export function mergeGameplay(base: GameplayFile, mods: { name: string; data: GameplayMod }[]): { file: GameplayFile; warnings: string[] } {
  let file: GameplayFile = structuredClone(base);
  const warnings: string[] = [];
  for (const mod of mods) {
    const next: GameplayFile = structuredClone(file);
    const m = mod.data;
    if (m?.version !== 1) {
      warnings.push(`${mod.name} 已略過：version 必須是 1`);
      continue;
    }
    upsert(next.items, m.items);
    upsert(next.crops, m.crops);
    for (const [t, entries] of Object.entries(m.fishing?.tables ?? {})) {
      next.fishing.tables[t] = [...(next.fishing.tables[t] ?? []), ...entries];
    }
    for (const [id, s] of Object.entries(m.shops ?? {})) {
      const cur = next.shops[id];
      next.shops[id] = {
        name: s.name ?? cur?.name ?? id,
        emoji: s.emoji ?? cur?.emoji ?? '🧳',
        greeting: s.greeting ?? cur?.greeting,
        verb: s.verb ?? cur?.verb,
        mode: s.mode ?? cur?.mode,
        trades: [...(cur?.trades ?? []), ...(s.trades ?? [])],
      };
    }
    if (m.calendar) next.calendar = structuredClone(m.calendar);
    if (m.festivals?.length) {
      if (!next.calendar) warnings.push(`${mod.name}：沒有 calendar，節慶不會出現`);
      else {
        next.calendar.festivals ??= [];
        upsert(next.calendar.festivals, m.festivals);
      }
    }
    next.unlocks = { ...next.unlocks, ...m.unlocks };
    next.machines = { ...next.machines, ...m.machines };
    next.buildings = { ...next.buildings, ...m.buildings };
    next.animals = { ...next.animals, ...m.animals };
    next.npcs = { ...next.npcs, ...m.npcs };
    if (m.collections?.length) {
      next.collections ??= [];
      upsert(next.collections, m.collections);
    }
    if (m.questChains?.length) {
      next.quests ??= { version: 1, nagEverySec: 60, chains: [] };
      upsert(next.quests.chains, m.questChains);
    }
    if (m.weatherTypes?.length || m.weatherSeasons) {
      if (!next.weather) warnings.push(`${mod.name}：沒有 weather.json，天氣設定不會生效`);
      else {
        upsert(next.weather.types, m.weatherTypes);
        next.weather.seasons = { ...next.weather.seasons, ...m.weatherSeasons };
      }
    }
    if (m.petSpecies) {
      if (!next.pets) warnings.push(`${mod.name}：沒有 pets.json，寵物不會出現`);
      else next.pets.species = { ...next.pets.species, ...m.petSpecies };
    }
    const errs = validateGameplay(next);
    if (errs.length) {
      warnings.push(`${mod.name} 已略過：${errs.join('；')}`);
      continue;
    }
    file = next;
  }
  return { file, warnings };
}

export function validateGameplay(f: GameplayFile): string[] {
  const errs: string[] = [];
  if (f.version !== 1) errs.push('gameplay.json：version 必須是 1');
  const ids = new Set<string>();
  for (const it of f.items ?? []) {
    if (!it.id || ids.has(it.id)) errs.push(`物品 id「${it.id}」空白或重複`);
    ids.add(it.id);
    if (!it.name || !it.emoji) errs.push(`物品 ${it.id}：要有 name 與 emoji`);
    if (it.price !== undefined && !(it.price >= 0)) errs.push(`物品 ${it.id}：price 要 ≥ 0`);
  }
  const has = (id: string | undefined, where: string) => {
    if (!id || !ids.has(id)) errs.push(`${where}：物品「${id}」不存在`);
  };
  const cost = (c: Cost | undefined, where: string) => {
    for (const [k, n] of Object.entries(c ?? {})) {
      has(k, where);
      if (!(Number.isInteger(n) && n > 0)) errs.push(`${where}：數量要是正整數`);
    }
  };
  const cropIds = new Set((f.crops ?? []).map((c) => c.id));
  for (const it of f.items ?? []) if (it.plants && !cropIds.has(it.plants)) errs.push(`物品 ${it.id}：plants 指定的作物「${it.plants}」不存在`);
  for (const [t, entries] of Object.entries(f.fishing?.tables ?? {})) {
    if (!entries.length) errs.push(`掉落表 ${t}：至少要有一項`);
    for (const e of entries) {
      has(e.item, `掉落表 ${t}`);
      if (!(e.weight > 0)) errs.push(`掉落表 ${t}：${e.item} 的 weight 要 > 0`);
    }
  }
  for (const c of f.crops ?? []) {
    has(c.seed, `作物 ${c.id} 的 seed`);
    has(c.harvest?.item, `作物 ${c.id} 的 harvest`);
    if (!c.stages?.length || c.stages[0]!.atMinutes !== 0) errs.push(`作物 ${c.id}：第一個階段的 atMinutes 要是 0`);
    for (let i = 1; i < (c.stages?.length ?? 0); i++) {
      if (!(c.stages[i]!.atMinutes > c.stages[i - 1]!.atMinutes)) errs.push(`作物 ${c.id}：stages 的 atMinutes 要遞增`);
    }
    if (!(c.harvest?.min >= 0 && c.harvest.max >= c.harvest.min)) errs.push(`作物 ${c.id}：harvest 要 0 ≤ min ≤ max`);
  }
  for (const [id, s] of Object.entries(f.shops ?? {})) {
    const tids = new Set<string>();
    for (const t of s.trades ?? []) {
      if (!t.id || tids.has(t.id)) errs.push(`商人 ${id}：交換 id「${t.id}」空白或重複`);
      tids.add(t.id);
      cost(t.give, `商人 ${id} 的交換 ${t.id}`);
      cost(t.get, `商人 ${id} 的交換 ${t.id}`);
    }
  }
  for (const k of Object.keys(f.starter ?? {})) has(k, 'starter');
  for (const k of [...(f.affection?.likes ?? []), ...(f.affection?.dislikes ?? [])]) has(k, 'affection 的 likes / dislikes');
  if (!f.affection?.levels?.length || f.affection.levels[0]!.min !== 0) errs.push('affection.levels：第一個等級的 min 要是 0');

  const seasonIds = new Set((f.calendar?.seasons ?? []).map((s) => s.id));
  if (f.calendar) {
    if (!(f.calendar.seasonDays >= 1)) errs.push('calendar.seasonDays 要 ≥ 1');
    if (!f.calendar.seasons?.length) errs.push('calendar.seasons 至少要有一季');
    for (const s of f.calendar.seasons ?? []) if (!(s.rainChance >= 0 && s.rainChance <= 1)) errs.push(`季節 ${s.id}：rainChance 要在 0～1`);
    const noSeason = (list: string[] | undefined, where: string) => {
      for (const s of list ?? []) if (!seasonIds.has(s)) errs.push(`${where}：季節「${s}」不存在`);
    };
    for (const c of f.crops ?? []) noSeason(c.seasons, `作物 ${c.id}`);
    for (const [t, entries] of Object.entries(f.fishing?.tables ?? {})) for (const e of entries) noSeason(e.seasons, `掉落表 ${t} 的 ${e.item}`);
    for (const fe of f.calendar.festivals ?? []) {
      noSeason([fe.season], `節慶 ${fe.id}`);
      if (!(fe.day >= 1 && fe.day <= f.calendar.seasonDays)) errs.push(`節慶 ${fe.id}：day 要在 1～${f.calendar.seasonDays}`);
    }
  }
  if (f.farming) {
    if (!(f.farming.waterHours > 0)) errs.push('farming.waterHours 要 > 0');
    if (!(f.farming.dryGrowthRate >= 0 && f.farming.dryGrowthRate <= 1)) errs.push('farming.dryGrowthRate 要在 0～1');
    if (f.farming.sprinklerItem) has(f.farming.sprinklerItem, 'farming.sprinklerItem');
  }
  for (const [id, u] of Object.entries(f.unlocks ?? {})) {
    cost(u.cost, `解鎖 ${id}`);
    if (u.requires && !f.unlocks?.[u.requires]) errs.push(`解鎖 ${id}：requires「${u.requires}」不存在`);
  }
  for (const [id, m] of Object.entries(f.machines ?? {})) {
    for (const r of m.recipes ?? []) {
      cost(r.give, `機器 ${id} 的 ${r.id}`);
      cost(r.get, `機器 ${id} 的 ${r.id}`);
      if (!(r.minutes > 0)) errs.push(`機器 ${id} 的 ${r.id}：minutes 要 > 0`);
    }
  }
  for (const c of f.collections ?? []) {
    for (const i of c.items) has(i, `收集 ${c.id}`);
    cost(c.reward, `收集 ${c.id} 的獎勵`);
  }
  for (const [id, b] of Object.entries(f.buildings ?? {})) {
    if (!b.levels?.length) errs.push(`建築 ${id}：至少要有一級`);
    for (const l of b.levels ?? []) if (!(l.capacity > 0)) errs.push(`建築 ${id}：capacity 要 > 0`);
    if (!f.unlocks?.[id]) errs.push(`建築 ${id}：要有同名的 unlocks.${id} 才蓋得起來`);
  }
  for (const [id, a] of Object.entries(f.animals ?? {})) {
    if (!f.buildings?.[a.building]) errs.push(`動物 ${id}：建築「${a.building}」不存在`);
    has(a.product, `動物 ${id} 的 product`);
    if (a.goodProduct) has(a.goodProduct, `動物 ${id} 的 goodProduct`);
    has(a.feed, `動物 ${id} 的 feed`);
    cost(a.price, `動物 ${id} 的 price`);
    if (!(a.hours > 0)) errs.push(`動物 ${id}：hours 要 > 0`);
  }
  for (const [id, n] of Object.entries(f.npcs ?? {})) {
    for (const i of [...(n.loves ?? []), ...(n.likes ?? []), ...(n.dislikes ?? [])]) has(i, `居民 ${id} 的喜好`);
    if (!n.lines?.length) errs.push(`居民 ${id}：至少要有一句台詞`);
    if (n.shop && !f.shops[n.shop]) errs.push(`居民 ${id}：商店「${n.shop}」不存在`);
  }
  if (f.marriage) has(f.marriage.item, 'marriage.item');
  for (const it of f.items ?? []) {
    if (it.gear && !(it.gear.bite > 0)) errs.push(`物品 ${it.id}：gear.bite 要 > 0`);
    for (const [r, n] of Object.entries(it.gear?.rare ?? {})) if (!(n! > 0)) errs.push(`物品 ${it.id}：gear.rare.${r} 要 > 0`);
    if (it.rarity && !RARITIES.includes(it.rarity)) errs.push(`物品 ${it.id}：rarity 只能是 ${RARITIES.join(' / ')}`);
  }
  const g = f.fishing?.goddess;
  if (g && !(g.chance >= 0 && g.chance <= 1)) errs.push('fishing.goddess.chance 要在 0～1');
  for (const [id, sh] of Object.entries(f.shops ?? {})) {
    if (sh.buys && sh.mode !== 'sell') errs.push(`商人 ${id}：buys 只能用在 mode = sell`);
  }
  for (const [id, n] of Object.entries(f.npcs ?? {})) {
    for (const sid of n.shops ?? []) if (!f.shops[sid]) errs.push(`居民 ${id}：商店「${sid}」不存在`);
  }
  for (const [id, a] of Object.entries(f.animals ?? {})) {
    if (a.baby && !(a.baby.growHours >= 0)) errs.push(`動物 ${id}：baby.growHours 要 ≥ 0`);
  }
  if (f.weather) {
    const wids = new Set(f.weather.types.map((t) => t.id));
    if (!f.weather.types.length) errs.push('weather.json：至少要有一種天氣');
    for (const [sid, ws] of [['default', f.weather.default], ...Object.entries(f.weather.seasons)] as [string, Record<string, number>][]) {
      for (const [k, n] of Object.entries(ws ?? {})) {
        if (!wids.has(k)) errs.push(`weather.json 的 ${sid}：天氣「${k}」不存在`);
        if (!(n >= 0)) errs.push(`weather.json 的 ${sid}：「${k}」的權重要 ≥ 0`);
      }
    }
  }
  if (f.quests) {
    const cids = new Set<string>();
    for (const c of f.quests.chains) {
      if (cids.has(c.id)) errs.push(`任務線 id「${c.id}」重複`);
      cids.add(c.id);
      if (!c.steps.length) errs.push(`任務線 ${c.id}：至少要有一步`);
      for (const st of c.steps) {
        if (!st.done || (!st.done.event && !st.done.have)) errs.push(`任務 ${c.id}/${st.id}：done 要有 event 或 have`);
        if (st.done?.item) has(st.done.item, `任務 ${c.id}/${st.id}`);
        if (st.done?.have?.item) has(st.done.have.item, `任務 ${c.id}/${st.id}`);
        if (st.done?.shop && !f.shops[st.done.shop]) errs.push(`任務 ${c.id}/${st.id}：商人「${st.done.shop}」不存在`);
        if (st.done?.npc && !f.npcs?.[st.done.npc]) errs.push(`任務 ${c.id}/${st.id}：居民「${st.done.npc}」不存在`);
        cost(st.reward, `任務 ${c.id}/${st.id} 的獎勵`);
      }
    }
    for (const c of f.quests.chains) if (c.requires && !cids.has(c.requires)) errs.push(`任務線 ${c.id}：requires「${c.requires}」不存在`);
  }
  errs.push(...validatePets(f, has));
  if (f.mine) {
    let prev = 0;
    for (const z of f.mine.zones) {
      if (z.from !== prev + 1 || z.to < z.from) errs.push(`礦洞 ${z.name}：樓層要從 ${prev + 1} 接續`);
      prev = z.to;
      for (const e of z.loot) has(e.item, `礦洞 ${z.name} 的掉落`);
      for (const m of z.monsters) if (m.drop) has(m.drop, `礦洞 ${z.name} 的 ${m.name}`);
      if (!z.monsters.length) errs.push(`礦洞 ${z.name}：至少要有一種怪物`);
    }
  }
  return errs;
}

// ───────────── 狀態：新建、整理、時間結算 ─────────────
export function newGame(now: number, d?: GameplayDefs, seed = now): GameState {
  return {
    rngSeed: (seed * 2654435761) >>> 0 || 1,
    stamina: d?.file.stats?.stamina.start ?? d?.file.stamina.max ?? 100,
    satiety: d?.file.satiety.start ?? 60,
    affection: d?.file.stats?.affection.start ?? 0,
    lastDrinkAt: 0,
    lastBathAt: 0,
    play: null,
    tavernToday: { day: '', flipGain: 0, cardWins: {} },
    pantryToday: { day: '', snacks: {}, fridge: 0 },
    dayLog: emptyLog(now),
    diary: [],
    wish: null,
    headpatToday: { day: '', n: 0 },
    furnitureBought: {},
    affectionToday: { day: dayKey(now), gained: 0 },
    lastTickAt: now,
    lastFishAt: 0,
    inventory: { ...(d?.file.starter ?? {}) },
    plots: {},
    sprinklers: {},
    unlocked: {},
    machines: {},
    claimed: {},
    buildingLevels: {},
    animals: [],
    nextAnimalId: 1,
    placed: {},
    decor: {},
    npcs: {},
    marriedAt: 0,
    help: null,
    mine: { deepest: 0, trip: null },
    redeemed: {},
    clockOffset: 0,
    luckUntil: 0,
    gear: { rod: null, bait: null },
    quest: firstQuest(d, {}),
    ...newPetState(now),
    // V0.22：交易代號用存檔建立時間當種子（每個存檔不一樣，跟個人資料無關）
    trade: (() => { const r = rngFrom((seed ^ 0x5bd1e995) >>> 0); return emptyTrade(d?.file.social?.nick.default ?? '主人', () => r.next(), now); })(),
    mailbox: [],
    shopToday: { day: dayKey(now), bought: {} },
    stats: { caught: {}, harvested: 0, fed: 0, traded: 0, sold: 0, earned: 0, kills: 0 },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
const str = (v: unknown, f: string) => (typeof v === 'string' ? v : f);
const counts = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(isObj(v) ? v : {}).filter(([, n]) => typeof n === 'number' && n > 0) as [string, number][]);
/**
 * V0.21：揹包讀檔時順便「防手改」：只留認得的物品、數量取整數並設上限。
 * 單機版的存檔在玩家自己的瀏覽器裡，擋不住真的想改的人；這裡只保證改壞了也不會讓遊戲出錯或數字爆掉。
 */
export const MAX_COINS = 99_999_999;
export const MAX_STACK = 9_999;
export const MAX_AFFECTION = 99_999;
export const MAX_CLOCK_OFFSET = 10 * 365 * 24 * 3_600_000;
const inventoryOf = (v: unknown, d?: GameplayDefs): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(isObj(v) ? v : {})) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) continue;
    if (d && k !== COIN && !d.items.has(k)) continue; // 不認得的物品（手改、或之後版本拿掉的）
    out[k] = Math.min(Math.floor(n), k === COIN ? MAX_COINS : MAX_STACK);
  }
  return out;
};
const flags = (v: unknown): Record<string, true> =>
  Object.fromEntries(Object.entries(isObj(v) ? v : {}).filter(([, x]) => !!x).map(([k]) => [k, true as const]));

/** 讀存檔時逐欄位檢查型別，壞掉的欄位補預設值 */
export function normalizeGame(raw: unknown, now: number, d?: GameplayDefs): GameState {
  const base = newGame(now, d);
  if (!isObj(raw)) return base;
  const r = raw as Partial<GameState> & Record<string, unknown>;
  const plots: Record<string, PlotState | null> = {};
  for (const [k, p] of Object.entries(isObj(r.plots) ? r.plots : {})) {
    const q = p as Partial<PlotState> | null;
    if (!q || typeof q.crop !== 'string' || typeof q.plantedAt !== 'number') {
      plots[k] = null;
      continue;
    }
    // V0.2 的存檔沒有澆水欄位：之前長的時間全部算數，從現在開始才需要澆水
    const old = typeof q.growthMs !== 'number';
    plots[k] = {
      crop: q.crop,
      plantedAt: q.plantedAt,
      growthMs: old ? Math.max(0, now - q.plantedAt) : num(q.growthMs, 0),
      growthAt: old ? now : num(q.growthAt, now),
      wateredUntil: num(q.wateredUntil, 0),
    };
  }
  const machines: GameState['machines'] = {};
  for (const [k, m] of Object.entries(isObj(r.machines) ? r.machines : {})) {
    machines[k] = isObj(m) && typeof m.machine === 'string' && typeof m.recipe === 'string'
      ? { machine: m.machine, recipe: m.recipe, readyAt: num(m.readyAt, now) } : null;
  }
  const animals: AnimalState[] = (Array.isArray(r.animals) ? r.animals : []).filter(isObj).map((a) => ({
    id: num(a.id, 0),
    kind: str(a.kind, ''),
    bornAt: num(a.bornAt, 0),
    name: str(a.name, ''),
    building: str(a.building, ''),
    fedUntil: num(a.fedUntil, 0),
    mood: num(a.mood, 50),
    friendship: num(a.friendship, 0),
    lastPetDay: str(a.lastPetDay, ''),
    readyAt: num(a.readyAt, now),
    pending: typeof a.pending === 'string' ? a.pending : null,
  })).filter((a) => a.id > 0 && a.kind);
  const placed: GameState['placed'] = {};
  for (const [scene, list] of Object.entries(isObj(r.placed) ? r.placed : {})) {
    placed[scene] = (Array.isArray(list) ? list : []).filter(isObj)
      .filter((p) => typeof p.item === 'string' && Number.isInteger(p.x) && Number.isInteger(p.y))
      .map((p) => ({ item: p.item as string, x: p.x as number, y: p.y as number }));
  }
  const decor: GameState['decor'] = {};
  for (const [scene, v] of Object.entries(isObj(r.decor) ? r.decor : {})) {
    if (!isObj(v)) continue;
    decor[scene] = {};
    if (typeof v.floor === 'string') decor[scene].floor = v.floor;
    if (typeof v.wall === 'string') decor[scene].wall = v.wall;
  }
  const npcs: Record<string, NpcState> = {};
  for (const [id, n] of Object.entries(isObj(r.npcs) ? r.npcs : {})) {
    if (!isObj(n)) continue;
    npcs[id] = { friendship: num(n.friendship, 0), talkDay: str(n.talkDay, ''), giftDay: str(n.giftDay, ''), events: flags(n.events) };
  }
  const mineRaw: Record<string, unknown> = isObj(r.mine) ? r.mine : {};
  const t = isObj(mineRaw.trip) ? mineRaw.trip : null;
  const trip = t && typeof t.floor === 'number' ? { floor: t.floor, startedAt: num(t.startedAt, now), endsAt: num(t.endsAt, now) } : null;
  const help = isObj(r.help) && typeof r.help.day === 'string'
    ? { day: r.help.day, watered: num(r.help.watered, 0), petted: num(r.help.petted, 0) } : null;
  const s: Record<string, unknown> = isObj(r.stats) ? r.stats : {};
  // 壞檔、手改存檔或舊版存檔可能帶負數／超界值。這裡一定要夾回合法範圍，
  // 否則 HUD 會直接顯示「-50/50」，而且體力要很久才爬得回來。
  // 只夾硬上限（f.stamina.max）；「餓肚子時上限減半」留給 tickGame 依 satiety 算。
  const staminaMax = d?.file.stamina?.max ?? base.stamina;
  const satietyMax = d?.file.satiety?.max ?? base.satiety;
  return {
    rngSeed: num(r.rngSeed, base.rngSeed) >>> 0,
    stamina: clamp(num(r.stamina, base.stamina), 0, staminaMax),
    satiety: clamp(num(r.satiety, base.satiety), 0, satietyMax),
    affection: Math.min(MAX_AFFECTION, Math.max(0, Math.floor(num(r.affection, 0)))),
    affectionToday: {
      day: str(r.affectionToday?.day, base.affectionToday.day),
      gained: num(r.affectionToday?.gained, 0),
    },
    lastTickAt: num(r.lastTickAt, now),
    lastFishAt: num(r.lastFishAt, 0),
    inventory: inventoryOf(r.inventory, d),
    plots,
    sprinklers: flags(r.sprinklers),
    unlocked: flags(r.unlocked),
    machines,
    claimed: flags(r.claimed),
    buildingLevels: Object.fromEntries(Object.entries(isObj(r.buildingLevels) ? r.buildingLevels : {})
      .filter(([, n]) => typeof n === 'number' && n >= 0) as [string, number][]),
    animals,
    nextAnimalId: Math.max(num(r.nextAnimalId, 1), ...animals.map((a) => a.id + 1)),
    placed,
    decor,
    npcs,
    marriedAt: num(r.marriedAt, 0),
    help,
    mine: { deepest: num(mineRaw.deepest, 0), trip },
    redeemed: flags(r.redeemed),
    // V0.21：時間偏移設上限（10 年）：手改成超大數字會讓日期算不出來
    clockOffset: Math.min(MAX_CLOCK_OFFSET, Math.max(0, num(r.clockOffset, 0))),
    luckUntil: num(r.luckUntil, 0),
    lastDrinkAt: num(r.lastDrinkAt, 0),
    lastBathAt: num(r.lastBathAt, 0),
    play: isObj(r.play) && typeof r.play.game === 'string' && d?.file.leisure?.play.games[r.play.game]
      ? { game: r.play.game, since: num(r.play.since, 0) } : null,
    tavernToday: isObj(r.tavernToday)
      ? {
        day: str(r.tavernToday.day, ''),
        flipGain: num(r.tavernToday.flipGain, 0),
        cardWins: isObj(r.tavernToday.cardWins) ? Object.fromEntries(Object.entries(r.tavernToday.cardWins).filter(([, v]) => typeof v === 'number')) as Record<string, number> : {},
      }
      : { day: '', flipGain: 0, cardWins: {} },
    pantryToday: isObj(r.pantryToday)
      ? {
        day: str(r.pantryToday.day, ''),
        snacks: isObj(r.pantryToday.snacks) ? Object.fromEntries(Object.entries(r.pantryToday.snacks).filter(([, v]) => typeof v === 'number' && v >= 0)) as Record<string, number> : {},
        fridge: num(r.pantryToday.fridge, 0),
      }
      : { day: '', snacks: {}, fridge: 0 },
    wish: normalizeWish(r.wish),
    headpatToday: isObj(r.headpatToday) ? { day: str(r.headpatToday.day, ''), n: num(r.headpatToday.n, 0) } : { day: '', n: 0 },
    dayLog: normalizeLog(r.dayLog, now),
    diary: normalizeDiary(r.diary, d?.file.diary?.keep ?? 60, now),
    furnitureBought: isObj(r.furnitureBought)
      ? Object.fromEntries(Object.entries(r.furnitureBought).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<ItemId, number>
      : {},
    gear: {
      rod: isObj(r.gear) && typeof r.gear.rod === 'string' ? r.gear.rod : null,
      bait: isObj(r.gear) && typeof r.gear.bait === 'string' ? r.gear.bait : null,
    },
    quest: normalizeQuest(r.quest, d),
    ...normalizePets(r, now, d),
    trade: normalizeTrade(r.trade, base.trade, d?.file.social),
    mailbox: normalizeMailbox(r.mailbox, d?.file.social?.mailbox.keep ?? 30),
    shopToday: isObj(r.shopToday) && typeof r.shopToday.day === 'string'
      ? { day: r.shopToday.day, bought: counts(r.shopToday.bought) } : { day: dayKey(now), bought: {} },
    stats: {
      caught: counts(s.caught),
      harvested: num(s.harvested, 0),
      fed: num(s.fed, 0),
      traded: num(s.traded, 0),
      sold: num(s.sold, 0),
      earned: num(s.earned, 0),
      kills: num(s.kills, 0),
    },
  };
}

// ───────────── 農田：澆水才會全速生長 ─────────────
const farming = (d: GameplayDefs) => d.file.farming ?? { waterHours: 0, waterStaminaCost: 0, dryGrowthRate: 1 };
const sceneOf = (key: string) => key.split('/')[0] ?? '';
/** 溫室裡的田：不分季節、永遠濕潤 */
export const inGreenhouse = (key: string, d: GameplayDefs) => !!d.file.farming?.greenhouseScenes?.includes(sceneOf(key));

/** from～to 之間，土是濕的時間有多長（澆的水＋雨天） */
function wetMs(from: number, to: number, wateredUntil: number, d: GameplayDefs): number {
  if (to <= from) return 0;
  const a = Math.min(to, Math.max(from, wateredUntil)); // 澆的水撐到這裡
  let wet = a - from;
  // 剩下的時間一天一天看有沒有下雨（最多看 400 天，避免壞掉的時間戳記卡死）
  let t = a;
  for (let i = 0; t < to && i < 400; i++) {
    const end = Math.min(to, dayStart(t) + DAY_MS);
    const next = end > t ? end : t + DAY_MS; // 日光節約時間等特殊情況的保險
    if (weatherDef(weatherAt(t, d), d).wet) wet += Math.min(to, next) - t;
    t = next;
  }
  return wet;
}

/** 把生長時間結算到 now；alwaysWet = 灑水器或溫室 */
export function settlePlot(p: PlotState, alwaysWet: boolean, now: number, d: GameplayDefs): PlotState {
  if (now <= p.growthAt) return p;
  const span = now - p.growthAt;
  const wet = alwaysWet || !d.file.farming ? span : wetMs(p.growthAt, now, p.wateredUntil, d);
  return { ...p, growthMs: p.growthMs + wet + (span - wet) * farming(d).dryGrowthRate, growthAt: now };
}

export function isWet(p: PlotState, alwaysWet: boolean, now: number, d: GameplayDefs): boolean {
  return alwaysWet || !d.file.farming || p.wateredUntil > now || weatherDef(weatherAt(now, d), d).wet;
}

const plotAlwaysWet = (g: GameState, key: string, d: GameplayDefs) => !!g.sprinklers[key] || inGreenhouse(key, d);

/** 時間流逝：體力、飽食、作物生長、動物產出、婚後幫忙、跨日重置 */
function statView(g: GameState, d: GameplayDefs, now: number): StatView {
  const f = d.file;
  const st = f.stats;
  const low = st?.lowRatio ?? 0.3;
  return {
    lowRatio: low,
    low: { stamina: g.stamina < f.stamina.max * low, satiety: g.satiety < f.satiety.max * low },
    starving: !!st && g.satiety <= 0,
    staminaBase: f.stamina.max,
    costs: { fish: f.fishing.staminaCost, plant: st?.actions.plant.stamina ?? 0, water: f.farming?.waterStaminaCost ?? 0, mine: f.mine?.staminaCost ?? 0 },
    drinkReadyAt: st ? g.lastDrinkAt + st.satiety.drink.cooldownMinutes * MIN : 0,
    drinkTables: [...(st?.satiety.drink.tables ?? []), ...(st?.satiety.drink.taps ?? [])],
    bathReadyAt: f.leisure ? g.lastBathAt + f.leisure.bath.cooldownHours * HOUR : 0,
    play: g.play && f.leisure?.play.games[g.play.game]
      ? { ...g.play, name: f.leisure.play.games[g.play.game]!.name, emoji: f.leisure.play.games[g.play.game]!.emoji } : null,
    tavern: f.tavern
      ? (() => {
        const t = tavernDay(g, now);
        return {
          social: isSocialHour(f.tavern, now),
          npcs: tavernNpcs(f.tavern, now),
          flipAffectionLeft: Math.max(0, f.tavern.coinFlip.maxAffectionPerDay - t.flipGain),
          cardWins: t.cardWins,
        };
      })()
      : null,
    pantry: (() => {
      const p = pantryDay(g, now);
      const L = f.leisure;
      return {
        snacks: Object.fromEntries(Object.entries(L?.snacks ?? {}).map(([id, s]) => [id, Math.max(0, s.perDay - (p.snacks[id] ?? 0))])),
        fridge: L?.fridge ? Math.max(0, L.fridge.perDay - p.fridge) : 0,
      };
    })(),
  };
}

/** V0.16：今天的點心、冰箱紀錄（跨日就是新的一天） */
function pantryDay(g: GameState, now: number): GameState['pantryToday'] {
  const today = dayKey(now);
  return g.pantryToday.day === today ? g.pantryToday : { day: today, snacks: {}, fridge: 0 };
}

// ───────────── V0.14：家具 ─────────────

/** 二手價：買價 × resaleRate（至少 1） */
export const resalePrice = (price: number, rate: number) => Math.max(1, Math.floor(price * rate));

/** 一件擺出去的家具佔的範圍（格子） */
export function footprint(item: ItemId, x: number, y: number, d: GameplayDefs): { x: number; y: number; w: number; h: number } {
  const s = d.items.get(item)?.place?.size;
  return { x, y, w: s?.w ?? 1, h: s?.h ?? 1 };
}
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inFootprint = (r: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

// ───────────── V0.13：酒館 ─────────────

/** 社交時間：本機時間 fromHour ≤ 幾點 < toHour（toHour 可以寫 24） */
export function isSocialHour(t: TavernFile, now: number): boolean {
  const h = new Date(now).getHours();
  const { fromHour: a, toHour: b } = t.social;
  return a <= b ? h >= a && h < b : h >= a || h < b; // 跨午夜（例如 20～2）也可以
}

/** 現在酒館裡有誰：老闆一直在；社交時間再加上 seats 裡的 NPC */
export function tavernNpcs(t: TavernFile, now: number): string[] {
  return [...t.residents.map((r) => r.npc), ...(isSocialHour(t, now) ? t.social.seats.map((s) => s.npc) : [])];
}

/** 今天的酒館紀錄（跨日就是新的一天） */
function tavernDay(g: GameState, now: number): GameState['tavernToday'] {
  const today = dayKey(now);
  return g.tavernToday.day === today ? g.tavernToday : { day: today, flipGain: 0, cardWins: {} };
}

/** 現在的體力上限：飽食度歸零時打折（stats.json 的 whenEmpty.staminaMaxMult） */
export function staminaCap(satiety: number, d: GameplayDefs): number {
  const st = d.file.stats;
  return satiety <= 0 && st ? Math.floor(d.file.stamina.max * st.satiety.whenEmpty.staminaMaxMult) : d.file.stamina.max;
}

/** opts.satietyMult：這段時間飽食度流逝的倍率（睡覺快轉時比較慢） */
export function tickGame(g: GameState, now: number, d: GameplayDefs, opts: { satietyMult?: number } = {}): GameState {
  const elapsed = Math.min(Math.max(0, now - g.lastTickAt), MAX_OFFLINE_MS) / HOUR;
  const f = d.file;
  const today = dayKey(now);
  const rng = rngFrom(g.rngSeed);
  const rnd = () => rng.next();
  // 每個早上：下雨澆田、寵物澆田、烏鴉；跨日的掉落物；寵物飽食度（V0.6 pets.ts）
  const wake = d.file.sleep?.wakeHour ?? 6;
  const fp = tickFarmAndPets(g, g.plots, g.lastTickAt, now, d, rnd, (k) => plotAlwaysWet(g, k, d), mornings(g.lastTickAt, now, wake));
  const plots: GameState['plots'] = {};
  for (const [k, p] of Object.entries(fp.plots)) plots[k] = p ? settlePlot(p, plotAlwaysWet(g, k, d), now, d) : null;
  const lucky = g.luckUntil > now;
  let animals = g.animals.map((a) => produce(a, now, d, rnd, lucky));
  let help = g.help;
  const newDay = g.affectionToday.day !== today;
  // V0.7 數值：飽食度流逝；歸零的每個早上扣好感；過了早上體力補滿（上限看有沒有餓）
  const st = f.stats;
  const decay = f.satiety.decayPerHour * (opts.satietyMult ?? 1);
  const satiety = Math.max(0, g.satiety - elapsed * decay);
  const wakes = mornings(g.lastTickAt, now, wake);
  let affection = Math.max(0, g.affection - elapsed * (st?.affection.decayPerHour ?? 0));
  if (st) {
    for (const t of wakes) {
      const at = g.satiety - ((t - g.lastTickAt) / HOUR) * decay;
      if (at <= 0) affection = Math.max(0, affection - st.satiety.whenEmpty.affectionLossPerDay);
    }
  }
  const cap = staminaCap(satiety, d);
  let stamina = Math.min(cap, g.stamina + elapsed * f.stamina.regenPerHour);
  if (wakes.length && (st?.stamina.restoreOnMorning ?? false)) stamina = cap;
  // 婚後：每天第一次結算時，她幫忙澆水、摸動物
  if (newDay && g.marriedAt && f.marriage) {
    let watered = 0;
    let petted = 0;
    if (f.marriage.helps.water && f.farming) {
      for (const [k, p] of Object.entries(plots)) {
        if (!p || plotAlwaysWet(g, k, d) || p.wateredUntil > now) continue;
        plots[k] = { ...p, wateredUntil: now + f.farming.waterHours * HOUR };
        watered++;
      }
    }
    if (f.marriage.helps.animals) {
      animals = animals.map((a) => {
        petted++;
        return { ...a, mood: clamp(a.mood + 10, 0, 100) };
      });
    }
    help = { day: today, watered, petted };
  }
  // V0.18：新的一天：她許一個新的小願望
  let wish = g.wish;
  if (f.wishes && wish?.day !== today) {
    wish = rollWish(f.wishes, d, { day: today, season: seasonAt(now, d)?.id, questDone: g.quest.done, yesterday: wish?.id }, rnd);
  }
  return {
    ...g,
    wish,
    rngSeed: rng.state,
    plots,
    animals,
    help,
    inventory: fp.inventory,
    pets: fp.pets,
    forage: fp.forage,
    wild: fp.wild,
    farmReport: fp.farmReport,
    stamina,
    satiety,
    affection,
    affectionToday: newDay ? { day: today, gained: 0 } : g.affectionToday,
    lastTickAt: Math.max(g.lastTickAt, now),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** from（不含）～ to（含）之間每一天的起床時間；最多看 4 天 */
export function mornings(from: number, to: number, hour: number): number[] {
  const out: number[] = [];
  if (to <= from) return out;
  let t = dayStart(Math.max(from, to - 4 * DAY_MS)) + hour * HOUR;
  for (let i = 0; i < 6 && t <= to; i++, t = dayStart(t + DAY_MS + HOUR) + hour * HOUR) if (t > from) out.push(t);
  return out;
}

/** 下一次起床的時間（遊戲時間） */
export function nextWake(now: number, hour: number): number {
  const today = dayStart(now) + hour * HOUR;
  return now < today ? today : dayStart(now + DAY_MS + HOUR) + hour * HOUR;
}

/** 動物產出：時間到了、有吃飽就產一個；沒收走之前不會再產 */
function produce(a0: AnimalState, now: number, d: GameplayDefs, rnd: () => number, lucky = false): AnimalState {
  const def = d.file.animals?.[a0.kind];
  if (!def) return a0;
  const a = { ...a0 };
  if (a.readyAt < now - MAX_OFFLINE_MS) a.readyAt = now - MAX_OFFLINE_MS;
  for (let guard = 0; a.pending === null && a.readyAt <= now && guard < 100; guard++) {
    if (a.fedUntil >= a.readyAt) {
      a.mood = clamp(a.mood + 5, 0, 100);
      if (a.mood >= (def.minMood ?? 0)) {
        const boost = lucky ? d.file.fishing.goddess?.goodProduct ?? 1 : 1;
        const goodChance = def.goodProduct ? Math.min(0.95, ((a.mood / 100) * 0.4 + (a.friendship / 1000) * 0.3) * boost) : 0;
        a.pending = def.goodProduct && rnd() < goodChance ? def.goodProduct : def.product;
      }
    } else {
      a.mood = clamp(a.mood - 20, 0, 100);
    }
    a.readyAt += def.hours * HOUR;
  }
  return a;
}

// ───────────── 小工具 ─────────────
export function addItem(inv: Record<ItemId, number>, id: ItemId, n: number): Record<ItemId, number> {
  const next = { ...inv, [id]: (inv[id] ?? 0) + n };
  if (next[id]! <= 0) delete next[id];
  return next;
}

const canPay = (inv: Record<ItemId, number>, c: Cost) => Object.entries(c).every(([id, n]) => (inv[id] ?? 0) >= n);
function pay(inv: Record<ItemId, number>, c: Cost) {
  for (const [id, n] of Object.entries(c)) inv = addItem(inv, id, -n);
  return inv;
}
function give(inv: Record<ItemId, number>, c: Record<ItemId, number>) {
  for (const [id, n] of Object.entries(c)) inv = addItem(inv, id, n);
  return inv;
}

export function levelOf(affection: number, levels: GameplayFile['affection']['levels']) {
  let cur = levels[0]!;
  let next: number | null = null;
  for (const l of levels) {
    if (affection >= l.min) cur = l;
    else if (next === null) next = l.min;
  }
  return { name: cur.name, nextAt: next };
}

const levelName = (g: GameState, d: GameplayDefs, affection = g.affection) =>
  g.marriedAt && d.file.marriage ? d.file.marriage.levelName : levelOf(affection, d.file.affection.levels).name;

export interface LootContext {
  phase: DayPhase;
  affection: number;
  season?: SeasonId;
  weather?: WeatherId;
  /** 這個天氣也算哪些天氣（雷雨也算 rainy） */
  weatherTags?: string[];
  festival?: string;
}

/** 這一筆掉落現在拿不拿得到 */
export function lootAvailable(e: LootEntry, ctx: LootContext): boolean {
  const w = ctx.weather ?? 'sunny';
  return (!e.phases || e.phases.includes(ctx.phase)) &&
    (e.minAffection ?? 0) <= ctx.affection &&
    (!e.seasons || ctx.season === undefined || e.seasons.includes(ctx.season)) &&
    (!e.weather || e.weather.includes(w) || !!ctx.weatherTags?.some((t) => e.weather!.includes(t))) &&
    (!e.festival || e.festival === ctx.festival);
}

/** 加權隨機：先依條件篩選，再照 weight（× 稀有度倍率）抽 */
export function rollLoot(entries: LootEntry[], ctx: LootContext, rnd: () => number, mult?: (e: LootEntry) => number): ItemId | null {
  const pool = entries.filter((e) => lootAvailable(e, ctx)).map((e) => ({ e, w: e.weight * (mult?.(e) ?? 1) }));
  const total = pool.reduce((n, x) => n + x.w, 0);
  if (total <= 0) return null;
  let r = rnd() * total;
  for (const x of pool) {
    r -= x.w;
    if (r < 0) return x.e.item;
  }
  return pool[pool.length - 1]!.e.item;
}

export function lootContext(g: GameState, d: GameplayDefs, now: number): LootContext {
  const w = weatherAt(now, d);
  return { phase: dayPhase(now), affection: g.affection, season: seasonAt(now, d)?.id, weather: w, weatherTags: weatherDef(w, d).tags, festival: festivalAt(now, d)?.id };
}

export const rarityOf = (id: ItemId, d: GameplayDefs): Rarity => d.items.get(id)?.rarity ?? 'common';

/** 選用中的魚竿、魚餌（沒選或用完：魚竿用揹包裡最好的、魚餌不用） */
export function gearOf(g: GameState, d: GameplayDefs): { rod: ItemDef | null; bait: ItemDef | null } {
  const owned = (id: ItemId | null, kind: 'rod' | 'bait') => {
    const it = id ? d.items.get(id) : undefined;
    return it?.gear?.kind === kind && (g.inventory[it.id] ?? 0) > 0 ? it : null;
  };
  let rod = owned(g.gear.rod, 'rod');
  if (!rod) {
    const score = (it: ItemDef) => (it.gear!.rare?.legendary ?? 1) + (it.gear!.rare?.epic ?? 1) + 1 / it.gear!.bite;
    rod = Object.keys(g.inventory).map((id) => owned(id, 'rod')).filter((x): x is ItemDef => !!x).sort((a, b) => score(b) - score(a))[0] ?? null;
  }
  return { rod, bait: owned(g.gear.bait, 'bait') };
}

/**
 * 稀有度倍率：魚竿 × 魚餌 × 天氣加成 × 女神好運。
 * 例：銥金釣竿（傳說 ×1.8）＋魔法魚餌（傳說 ×2.5）＋雨天（+20%）＋好運（傳說 ×3）→ 傳說魚權重 ×16.2
 */
export function rareMultipliers(g: GameState, d: GameplayDefs, now: number): Record<Rarity, number> {
  const { rod, bait } = gearOf(g, d);
  const bonus = weatherDef(weatherAt(now, d), d).rareBonus ?? 0;
  const lucky = g.luckUntil > now;
  const pet = petRareMult(g, d, 'fishing_luck'); // V0.6：水母之類的寵物
  const out = { common: 1, epic: 1, legendary: 1 } as Record<Rarity, number>;
  for (const r of ['epic', 'legendary'] as Rarity[]) {
    out[r] = (rod?.gear?.rare?.[r] ?? 1) * (bait?.gear?.rare?.[r] ?? 1) * (1 + bonus) * (lucky ? d.file.fishing.goddess?.luck[r] ?? 1 : 1) * pet[r];
  }
  return out;
}

/** 任何時間點都能算出作物長到哪個階段 */
export function cropStatus(p0: PlotState, c: CropDef, now: number, d: GameplayDefs, alwaysWet = false): PlotView {
  const p = settlePlot(p0, alwaysWet, now, d);
  const minutes = p.growthMs / MIN;
  let i = 0;
  while (i + 1 < c.stages.length && c.stages[i + 1]!.atMinutes <= minutes) i++;
  const last = c.stages.length - 1;
  // 預估下一階段：先用掉剩下的水，之後用乾的速度（不預測之後會不會下雨）
  let nextAt: number | null = null;
  if (i < last) {
    const need = c.stages[i + 1]!.atMinutes * MIN - p.growthMs;
    const dry = farming(d).dryGrowthRate;
    const wetLeft = alwaysWet || !d.file.farming ? Infinity : Math.max(0, p.wateredUntil - now);
    if (need <= wetLeft) nextAt = now + need;
    else if (dry > 0) nextAt = now + wetLeft + (need - wetLeft) / dry;
  }
  return {
    crop: c.id,
    stage: i,
    stageName: c.stages[i]!.name,
    emoji: c.stages[i]!.emoji,
    ready: i === last,
    nextAt,
    watered: isWet(p, alwaysWet, now, d),
    sprinkler: alwaysWet,
  };
}

/** 揹包裡每一類最強的裝備 */
export function equipmentOf(inv: Record<ItemId, number>, d: GameplayDefs): GameView['equipment'] {
  const out: GameView['equipment'] = { weapon: { item: null, power: 0 }, armor: { item: null, power: 0 }, pickaxe: { item: null, power: 0 } };
  for (const [id, n] of Object.entries(inv)) {
    const e = n > 0 ? d.items.get(id)?.equip : undefined;
    if (e && e.power > out[e.slot].power) out[e.slot] = { item: id, power: e.power };
  }
  return out;
}

export const hearts = (friendship: number) => Math.floor(friendship / 100);
export const mineZone = (d: GameplayDefs, floor: number): MineZone | undefined => d.file.mine?.zones.find((z) => floor >= z.from && floor <= z.to);
export const mineMaxFloor = (d: GameplayDefs) => d.file.mine?.zones.at(-1)?.to ?? 0;
const capacityOf = (d: GameplayDefs, b: string, level: number) => d.file.buildings?.[b]?.levels[level]?.capacity ?? 0;

export function gameView(g: GameState, d: GameplayDefs, now: number): GameView {
  const lv = levelOf(g.affection, d.file.affection.levels);
  const plots: Record<string, PlotView | null> = {};
  for (const [k, p] of Object.entries(g.plots)) {
    const crop = p ? d.crops.get(p.crop) : undefined;
    const wet = plotAlwaysWet(g, k, d);
    plots[k] = p && crop ? cropStatus(p, crop, now, d, wet)
      : p ? { crop: p.crop, stage: 0, stageName: '未知作物', emoji: '❓', ready: true, nextAt: null, watered: true, sprinkler: wet } : null;
  }
  const season = seasonAt(now, d);
  const weather = weatherDef(weatherAt(now, d), d);
  const today = dayKey(now);
  const buildings: GameView['buildings'] = {};
  for (const [id, lvl] of Object.entries(g.buildingLevels)) {
    buildings[id] = {
      level: lvl,
      capacity: capacityOf(d, id, lvl),
      count: g.animals.filter((a) => a.building === id).length,
      maxLevel: (d.file.buildings?.[id]?.levels.length ?? 1) - 1,
    };
  }
  const machines: GameView['machines'] = {};
  for (const [k, m] of Object.entries(g.machines)) machines[k] = m ? { ...m, ready: now >= m.readyAt } : null;
  const npcs: GameView['npcs'] = {};
  for (const id of Object.keys(d.file.npcs ?? {})) {
    const n = g.npcs[id] ?? { friendship: 0, talkDay: '', giftDay: '', events: {} };
    npcs[id] = { friendship: n.friendship, hearts: hearts(n.friendship), talkedToday: n.talkDay === today, giftedToday: n.giftDay === today, events: Object.keys(n.events) };
  }
  const mar = d.file.marriage;
  const latest = g.diary[g.diary.length - 1];
  const w = g.wish && g.wish.day === today ? g.wish : null;
  return {
    wish: w ? { id: w.id, day: w.day, text: w.text, emoji: w.emoji, hint: w.hint, progress: w.progress, need: w.need, done: w.done, affection: w.affection } : null,
    diary: {
      entries: [...g.diary].reverse(),
      unread: latest && !latest.read ? latest.id : null,
      today: Object.values(g.dayLog.counts).filter((n) => n && n > 0).length,
    },
    stamina: Math.floor(g.stamina),
    staminaMax: staminaCap(g.satiety, d),
    satiety: Math.round(g.satiety),
    satietyMax: d.file.satiety.max,
    affection: g.affection,
    level: levelName(g, d),
    nextLevelAt: g.marriedAt ? null : lv.nextAt,
    inventory: { ...g.inventory },
    coins: g.inventory[COIN] ?? 0,
    plots,
    fishReadyAt: g.lastFishAt + d.file.fishing.cooldownMs,
    caught: { ...g.stats.caught },
    claimed: Object.keys(g.claimed),
    sprinklers: Object.keys(g.sprinklers),
    season: season ? { id: season.id, name: season.name, emoji: season.emoji, day: season.day, days: season.days } : null,
    weather,
    festival: festivalAt(now, d),
    unlocked: Object.keys(g.unlocked),
    machines,
    buildings,
    animals: g.animals.map((a) => {
      const growsAt = a.bornAt + (d.file.animals?.[a.kind]?.baby?.growHours ?? 0) * HOUR;
      return { ...a, hungry: a.fedUntil <= now, pettedToday: a.lastPetDay === today, adult: now >= growsAt, growsAt, sellPrice: animalPrice(a, d, now) };
    }),
    placed: structuredClone(g.placed),
    decor: structuredClone(g.decor),
    npcs,
    married: !!g.marriedAt,
    canPropose: !!mar && !g.marriedAt && g.affection >= mar.minAffection,
    help: g.help && g.help.day === today && (g.help.watered || g.help.petted) ? { watered: g.help.watered, petted: g.help.petted } : null,
    mine: { deepest: g.mine.deepest, trip: g.mine.trip ? { ...g.mine.trip, ready: now >= g.mine.trip.endsAt } : null },
    equipment: equipmentOf(g.inventory, d),
    fishing: (() => {
      const { rod, bait } = gearOf(g, d);
      return {
        rod: rod?.id ?? null,
        bait: bait?.id ?? null,
        baitLeft: bait ? g.inventory[bait.id] ?? 0 : 0,
        waitMs: Math.round(d.file.fishing.durationMs * (rod?.gear?.bite ?? 1) * (bait?.gear?.bite ?? 1)),
        rare: rareMultipliers(g, d, now),
      };
    })(),
    luckUntil: g.luckUntil,
    furniture: {
      bought: g.furnitureBought,
      placed: Object.values(g.placed).flat().reduce<Record<ItemId, number>>((m, p) => ((m[p.item] = (m[p.item] ?? 0) + 1), m), {}),
    },
    quest: questView(g, d),
    questLast: g.quest.last,
    pets: petViews(g, d, now),
    companion: g.companion,
    social: d.file.social ? (() => {
      const t = g.trade;
      const s = d.file.social!;
      const today = dayKey(now);
      return {
        id: t.id, nick: t.nick, stall: t.stall.map((l) => ({ ...l })),
        market: marketOffers(d, now, t.market.day === today ? t.market.bought : {}),
        adoptReadyAt: t.adoptCodeAt ? t.adoptCodeAt + s.adopt.cooldownHours * T_HOUR : 0,
        mailbox: [...g.mailbox].reverse(), unread: g.mailbox.filter((l) => !l.read).length,
      };
    })() : null,
    wild: wildList(now, g, d),
    forage: forageLeft(g, d, now),
    farmReport: g.farmReport?.day === today ? structuredClone(g.farmReport) : null,
    shopToday: g.shopToday.day === today ? { ...g.shopToday.bought } : {},
    stats: statView(g, d, now),
  };
}

export function animalPrice(a: AnimalState, d: GameplayDefs, now: number): number {
  const def = d.file.animals?.[a.kind];
  if (!def?.sellPrice) return 0;
  const adult = now >= a.bornAt + (def.baby?.growHours ?? 0) * HOUR;
  return Math.round((adult ? def.sellPrice.adult : def.sellPrice.baby) * (1 + Math.min(a.friendship, 1000) / 2000));
}

// ───────────── V0.5：任務（引導）系統 ─────────────
/** 觸發任務進度的訊號：動作成功的事件，或走進某張地圖 */
export interface QuestTrigger {
  event: GameEvent['type'] | 'enter';
  items: ItemId[];
  shop?: string;
  npc?: string;
  scene?: string;
  count: number;
}

/** 動作事件 → 任務訊號 */
export function triggerOf(e: GameEvent): QuestTrigger {
  const t: QuestTrigger = { event: e.type, items: [], count: 1 };
  switch (e.type) {
    case 'caught': t.items = [e.item]; t.count = e.count; break;
    case 'sold': t.items = [e.item]; t.shop = e.shop; t.count = e.count; break;
    case 'traded': t.items = Object.keys(e.get); t.shop = e.shop; break;
    case 'planted': t.items = [e.seed]; break;
    case 'harvested': t.items = [e.item]; t.count = e.count; break;
    case 'fed': t.items = [e.item]; break;
    case 'talked': t.npc = e.npc; break;
    case 'gifted': t.npc = e.npc; t.items = [e.item]; break;
    case 'machine_collected': t.items = Object.keys(e.get); break;
    case 'animals_collected': t.items = Object.keys(e.items); break;
    case 'animal_bought': t.items = [e.kind]; break;
  }
  return t;
}

function matches(c: QuestCondition, t: QuestTrigger, d: GameplayDefs): boolean {
  if (!c.event || c.event !== t.event) return false;
  if (c.shop && c.shop !== t.shop) return false;
  if (c.npc && c.npc !== t.npc) return false;
  if (c.scene && c.scene !== t.scene) return false;
  if (c.item && !t.items.includes(c.item)) return false;
  if (c.category && !t.items.some((i) => d.items.get(i)?.category === c.category)) return false;
  if (c.rarity && !t.items.some((i) => RARITIES.indexOf(rarityOf(i, d)) >= RARITIES.indexOf(c.rarity!))) return false;
  return true;
}

function hasNow(c: QuestCondition, g: GameState, d: GameplayDefs): boolean {
  const h = c.have;
  if (!h) return false;
  const n = Object.entries(g.inventory).filter(([id]) => (!h.item || id === h.item) && (!h.category || d.items.get(id)?.category === h.category))
    .reduce((x, [, v]) => x + v, 0);
  return n >= (h.count ?? 1);
}

/** 第一條還沒做完、前置也做完的任務線 */
function firstQuest(d: GameplayDefs | undefined, done: Record<string, true>, after?: QuestLog): GameState['quest'] {
  const next = d?.file.quests?.chains.find((c) => !done[c.id] && (!c.requires || done[c.requires]));
  return { chain: next?.id ?? null, step: 0, progress: 0, done, nagAt: 0, last: after ?? null };
}

function normalizeQuest(raw: unknown, d?: GameplayDefs): GameState['quest'] {
  if (!isObj(raw)) return firstQuest(d, {});
  const done = flags(raw.done);
  const chain = typeof raw.chain === 'string' && d?.file.quests?.chains.some((c) => c.id === raw.chain) ? raw.chain : null;
  const q = chain ? { chain, step: Math.max(0, Math.floor(num(raw.step, 0))), progress: num(raw.progress, 0), done, nagAt: 0, last: null } : firstQuest(d, done);
  const last = isObj(raw.last) && typeof raw.last.chain === 'string' ? (raw.last as unknown as QuestLog) : null;
  return { ...q, last };
}

/** 收到訊號（或什麼都沒收到，只檢查「揹包有沒有」）：推進任務，發獎勵 */
export function advanceQuests(g: GameState, triggers: QuestTrigger[], d: GameplayDefs, now: number): GameState {
  let q = g.quest;
  let inv = g.inventory;
  for (let guard = 0; guard < 20 && q.chain; guard++) {
    const chain = d.file.quests?.chains.find((c) => c.id === q.chain);
    const step = chain?.steps[q.step];
    if (!chain || !step) {
      q = firstQuest(d, chain ? { ...q.done, [chain.id]: true } : q.done, q.last ?? undefined);
      continue;
    }
    const hit = triggers.filter((t) => matches(step.done, t, d)).reduce((n, t) => n + t.count, 0);
    const progress = q.progress + hit;
    triggers = []; // 一個訊號只算一步
    if (progress < (step.count ?? 1) && !hasNow(step.done, { ...g, inventory: inv }, d)) {
      q = { ...q, progress };
      break;
    }
    // 這一步完成
    for (const [id, n] of Object.entries(step.reward ?? {})) inv = addItem(inv, id, n);
    const lastStep = q.step + 1 >= chain.steps.length;
    const log: QuestLog = { chain: chain.id, step: step.id, task: step.task, reward: { ...step.reward }, chainDone: lastStep, at: now };
    q = lastStep ? firstQuest(d, { ...q.done, [chain.id]: true }, log) : { ...q, step: q.step + 1, progress: 0, last: log };
  }
  return { ...g, inventory: inv, quest: q };
}

export function questView(g: GameState, d: GameplayDefs): QuestView | null {
  const chain = d.file.quests?.chains.find((c) => c.id === g.quest.chain);
  const step = chain?.steps[g.quest.step];
  if (!chain || !step) return null;
  return {
    chain: chain.id, chainName: chain.name, step: g.quest.step, total: chain.steps.length, stepId: step.id, task: step.task,
    progress: g.quest.progress, need: step.count ?? 1, say: step.say, nag: step.nag ?? [], target: step.target,
    nagEverySec: d.file.quests?.nagEverySec ?? 60,
  };
}

// ───────────── 禮物碼（擴展 E6） ─────────────
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

export function encodeGift(item: ItemId, count: number, nonce: string, salt: string): string {
  const payload = `${item}|${count}|${nonce}`;
  return `WG-${b64(payload)}-${fnv(payload + salt)}`;
}

export function decodeGift(code: string, salt: string): { item: ItemId; count: number; nonce: string } | null {
  const m = /^WG-([A-Za-z0-9_-]+)-([0-9a-z]+)$/.exec(code.trim());
  if (!m) return null;
  let payload: string;
  try {
    payload = unb64(m[1]!);
  } catch {
    return null;
  }
  if (fnv(payload + salt) !== m[2]) return null;
  const [item, n, nonce] = payload.split('|');
  const count = Number(n);
  if (!item || !nonce || !Number.isInteger(count) || count < 1 || count > 99) return null;
  return { item, count, nonce };
}

// ───────────── 動作：唯一入口 ─────────────
type Outcome = { ok: true; game: GameState; event: GameEvent } | { ok: false; error: ActError };
const ok = (game: GameState, event: GameEvent): Outcome => ({ ok: true, game, event });
const fail = (error: ActError): Outcome => ({ ok: false, error });

/** 她去礦洞時不在家，這些事做不了 */
const NEEDS_HER = new Set<GameAction['type']>(['fish', 'plant', 'harvest', 'water', 'feed', 'propose', 'mine_start', 'mine_loot', 'coin_flip', 'cards', 'snack', 'headpat']);

/**
 * 吃舊狀態、吐新狀態。失敗時只會推進時間（體力回復等），不會扣任何東西。
 */
export function applyAction(
  g0: GameState,
  a: GameAction,
  d: GameplayDefs,
  now: number,
): { game: GameState; ok: true; event: GameEvent } | { game: GameState; ok: false; error: ActError } {
  const g = tickGame(g0, now, d);
  const rng = rngFrom(g.rngSeed);
  const rnd = () => rng.next();
  const r = g.mine.trip && NEEDS_HER.has(a.type) ? fail('away') : run(g, a, d, now, rnd);
  if (!r.ok) return { game: g, ok: false, error: r.error };
  // 任務：動作成功的事件就是任務訊號（睡覺之後用起床的時間記錄）
  const at = r.event.type === 'slept' ? r.event.to : now;
  let game = advanceQuests(r.game, [triggerOf(r.event)], d, at);
  // V0.18：今天的小願望
  game = progressWish(game, triggerOf(r.event), d);
  // V0.17：記進今天的紀錄；睡覺就寫一篇日記
  let event = r.event;
  if (event.type === 'slept') {
    const entry = writeDiary(game, d, event.from, rnd);
    const keep = d.file.diary?.keep ?? 60;
    game = { ...game, diary: [...game.diary, entry].slice(-keep), dayLog: emptyLog(event.to) };
    event = { ...event, diary: entry.id };
  } else {
    game = { ...game, dayLog: logEvent(game.dayLog, event, d) };
  }
  return { game: { ...game, rngSeed: rng.state }, ok: true, event };
}

/** V0.18：一個訊號（動作的事件、走進地圖）推進今天的願望；完成就給獎勵（好感不算在每日上限裡）並記進日記 */
export function progressWish(g: GameState, t: WishTrigger, d: GameplayDefs): GameState {
  const w = g.wish;
  const hit = w ? wishHit(w, t) : 0;
  if (!w || !hit) return g;
  const progress = Math.min(w.need, w.progress + hit);
  if (progress < w.need) return { ...g, wish: { ...w, progress } };
  const counts = { ...g.dayLog.counts, wish: (g.dayLog.counts.wish ?? 0) + 1 };
  const items = { ...g.dayLog.items, wish: { ...(g.dayLog.items.wish ?? {}), [w.text]: 1 } };
  return {
    ...g,
    wish: { ...w, progress, done: true },
    affection: g.affection + w.affection,
    inventory: w.coins ? addItem(g.inventory, COIN, w.coins) : g.inventory,
    dayLog: { ...g.dayLog, counts, items },
  };
}

/** V0.17：今天的紀錄 → 一篇日記（用 diary.json 的句子拼；DSH 的 host 之後會請 AI 重寫） */
export function writeDiary(g: GameState, d: GameplayDefs, at: number, rnd: () => number): DiaryEntry {
  const s = seasonAt(at, d);
  const w = weatherDef(weatherAt(at, d), d);
  const date = s ? `${s.name.endsWith('季') ? s.name : `${s.name}季`}第${s.day}天` : `第${dayIndex(at) + 1}天`;
  const file = d.file.diary;
  const facts = file ? dayFacts(g.dayLog, d, file) : [];
  const text = file ? templateDiary(facts, { date, weatherId: w.id, weatherName: w.name }, file, rnd) : `${date}，${w.name}。`;
  return { id: `d${at}`, at, date, weather: { id: w.id, name: w.name, emoji: w.emoji }, facts: facts.map((f) => f.text), text, source: 'template', read: false };
}

/** 釣到新東西時，看看有沒有集滿哪一組 */
function claimCollections(g: GameState, d: GameplayDefs): { game: GameState; rewards: CollectionReward[] } {
  const rewards: CollectionReward[] = [];
  let inv = g.inventory;
  const claimed = { ...g.claimed };
  for (const c of d.file.collections ?? []) {
    if (claimed[c.id] || !c.items.every((i) => g.stats.caught[i])) continue;
    claimed[c.id] = true;
    inv = give(inv, c.reward);
    rewards.push({ id: c.id, name: c.name, reward: { ...c.reward } });
  }
  return { game: { ...g, inventory: inv, claimed }, rewards };
}

function run(g: GameState, a: GameAction, d: GameplayDefs, now: number, rnd: () => number): Outcome {
  if (isPetAction(a)) return runPet(g, a, d, now, rnd);
  if (isSocialAction(a)) return runSocial(g, a, d, now, rnd); // V0.22
  const f = d.file;
  const today = dayKey(now);
  switch (a.type) {
    case 'fish': {
      const fd = f.fishing;
      if (now - g.lastFishAt < fd.cooldownMs) return fail('cooldown');
      if (g.stamina < fd.staminaCost) return fail('no_stamina');
      const table = fd.tables[a.table];
      if (!table) return fail('unknown');
      // 稀有度倍率先算（用的是拋竿當下的魚竿、魚餌、天氣、好運）
      const mult = rareMultipliers(g, d, now);
      const { bait } = gearOf(g, d);
      // 魚餌：每拋一次竿用掉一個（跑掉也算）
      let inv = bait ? addItem(g.inventory, bait.id, -1) : g.inventory;
      const gear = bait && !inv[bait.id] ? { ...g.gear, bait: null } : g.gear;
      const spent = { ...g, inventory: inv, gear, stamina: g.stamina - fd.staminaCost, lastFishAt: now };
      if (a.quality === 'miss') return ok(spent, { type: 'escaped', bait: bait?.id });
      const item = rollLoot(table, lootContext(g, d, now), rnd, (e) => mult[rarityOf(e.item, d)]);
      if (!item) return fail('unknown');
      const first = !g.stats.caught[item];
      const count = a.quality === 'perfect' && rnd() < (fd.minigame?.doubleChance ?? 0.5) ? 2 : 1;
      inv = addItem(inv, item, count);
      // 湖中女神：釣到東西時 1% 機率出現，好運持續到隔天早上
      const gd = fd.goddess;
      let goddess: { until: number } | undefined;
      let luckUntil = g.luckUntil;
      if (gd && rnd() < gd.chance) {
        luckUntil = Math.max(luckUntil, dayStart(now) + DAY_MS + gd.untilHour * HOUR);
        goddess = { until: luckUntil };
      }
      const caught = { ...spent, inventory: inv, luckUntil, stats: { ...g.stats, caught: addItem(g.stats.caught, item, count) } };
      const { game, rewards } = claimCollections(caught, d);
      return ok(game, { type: 'caught', item, count, first, rewards, rarity: rarityOf(item, d), goddess, bait: bait?.id });
    }
    case 'set_gear': {
      if (a.item !== null) {
        const it = d.items.get(a.item);
        if (it?.gear?.kind !== a.slot) return fail('unknown');
        if ((g.inventory[a.item] ?? 0) <= 0) return fail('no_item');
      }
      return ok({ ...g, gear: { ...g.gear, [a.slot]: a.item } }, { type: 'gear_set', slot: a.slot, item: a.item });
    }
    case 'sleep': {
      // 睡覺：遊戲時間直接跳到下一個起床時間，中間的事（作物、動物、下雨澆水）照常結算
      const wake = f.sleep?.wakeHour ?? 6;
      const to = nextWake(now, wake);
      const before = Object.values(g.plots).filter((p) => p && p.wateredUntil > to).length;
      // V0.11：睡覺就不玩了（不結算；畫面會先請她停下來結算）
      const woke = tickGame({ ...g, play: null, clockOffset: g.clockOffset + (to - now) }, to, d, { satietyMult: f.stats?.satiety.sleepDecayMult });
      const after = Object.values(woke.plots).filter((p) => p && p.wateredUntil > to).length;
      // 睡飽了：體力補滿（餓著睡的話只能補到打折後的上限）
      return ok({ ...woke, stamina: staminaCap(woke.satiety, d) }, { type: 'slept', from: now, to, weather: weatherAt(to, d), watered: Math.max(0, after - before) });
    }
    case 'sell_animal': {
      const x = g.animals.find((y) => y.id === a.animal);
      if (!x) return fail('unknown');
      const coins = animalPrice(x, d, now);
      if (!coins) return fail('not_for_sale');
      return ok({ ...g, animals: g.animals.filter((y) => y !== x), inventory: addItem(g.inventory, COIN, coins), stats: { ...g.stats, earned: g.stats.earned + coins } },
        { type: 'animal_sold', animal: x.id, name: x.name, coins });
    }
    case 'plant': {
      if (g.plots[a.plot]) return fail('plot_busy');
      const crop = d.cropBySeed.get(a.seed);
      if (!crop) return fail('not_seed');
      if ((g.inventory[a.seed] ?? 0) <= 0) return fail('no_item');
      const season = seasonAt(now, d);
      if (crop.seasons && season && !crop.seasons.includes(season.id) && !inGreenhouse(a.plot, d)) return fail('wrong_season');
      const cost = crop.staminaCost ?? 0;
      if (g.stamina < cost) return fail('no_stamina');
      return ok({
        ...g,
        stamina: g.stamina - cost,
        inventory: addItem(g.inventory, a.seed, -1),
        plots: { ...g.plots, [a.plot]: { crop: crop.id, plantedAt: now, growthMs: 0, growthAt: now, wateredUntil: 0 } },
      }, { type: 'planted', plot: a.plot, crop: crop.id, seed: a.seed });
    }
    case 'harvest': {
      const p = g.plots[a.plot];
      if (!p) return fail('plot_empty');
      const crop = d.crops.get(p.crop);
      if (!crop) return ok({ ...g, plots: { ...g.plots, [a.plot]: null } }, { type: 'cleared', plot: a.plot }); // mod 被移除的作物：清掉
      if (!cropStatus(p, crop, now, d, plotAlwaysWet(g, a.plot, d)).ready) return fail('not_ready');
      const { item, min, max } = crop.harvest;
      const count = min + Math.floor(rnd() * (max - min + 1));
      return ok({
        ...g,
        inventory: addItem(g.inventory, item, count),
        plots: { ...g.plots, [a.plot]: null },
        stats: { ...g.stats, harvested: g.stats.harvested + count },
      }, { type: 'harvested', plot: a.plot, item, count });
    }
    case 'water': {
      const p = g.plots[a.plot];
      if (!p) return fail('plot_empty');
      const fm = f.farming;
      if (!fm) return fail('unknown');
      if (isWet(p, plotAlwaysWet(g, a.plot, d), now, d)) return fail('already_watered');
      if (g.stamina < fm.waterStaminaCost) return fail('no_stamina');
      return ok({
        ...g,
        stamina: g.stamina - fm.waterStaminaCost,
        plots: { ...g.plots, [a.plot]: { ...p, wateredUntil: now + fm.waterHours * HOUR } },
      }, { type: 'watered', plot: a.plot });
    }
    case 'sprinkler': {
      const item = f.farming?.sprinklerItem;
      if (!item) return fail('unknown');
      if (g.sprinklers[a.plot]) return fail('has_sprinkler');
      if ((g.inventory[item] ?? 0) <= 0) return fail('no_item');
      return ok({
        ...g,
        inventory: addItem(g.inventory, item, -1),
        sprinklers: { ...g.sprinklers, [a.plot]: true },
      }, { type: 'sprinkler_placed', plot: a.plot });
    }
    case 'feed': {
      const def = d.items.get(a.item);
      if (!def?.food) return fail('not_food');
      if ((g.inventory[a.item] ?? 0) <= 0) return fail('no_item');
      // 吃東西：飽食度 + food.satiety，體力 + food.stamina（沒寫就用飽食度 × eat.staminaPerSatiety）
      const satAfter = Math.min(f.satiety.max, g.satiety + def.food.satiety);
      const capAfter = staminaCap(satAfter, d);
      const stGain = def.food.stamina ?? Math.round(def.food.satiety * (f.stats?.eat.staminaPerSatiety ?? 0));
      const stAfter = Math.max(g.stamina, Math.min(capAfter, g.stamina + stGain));
      if (g.satiety >= f.satiety.max && stAfter <= g.stamina) return fail('full'); // 兩個都滿了才吃不下
      const liked = !!f.affection.likes?.includes(a.item);
      const disliked = !!f.affection.dislikes?.includes(a.item);
      const raw = def.food.affection * (liked ? 2 : disliked ? 0 : 1);
      const room = Math.max(0, f.affection.dailyCap - g.affectionToday.gained);
      const gain = Math.min(raw, room);
      const before = levelName(g, d);
      const affection = g.affection + gain;
      const after = levelName(g, d, affection);
      return ok({
        ...g,
        inventory: addItem(g.inventory, a.item, -1),
        satiety: satAfter,
        stamina: stAfter,
        affection,
        affectionToday: { ...g.affectionToday, gained: g.affectionToday.gained + gain },
        stats: { ...g.stats, fed: g.stats.fed + 1 },
      }, { type: 'fed', item: a.item, gain, liked, disliked, capped: gain < raw, levelUp: after !== before ? after : undefined, satiety: satAfter - g.satiety, stamina: stAfter - g.stamina });
    }
    case 'drink': {
      const dk = f.stats?.satiety.drink;
      if (!dk || !(dk.tables.includes(a.table) || dk.taps?.includes(a.table))) return fail('unknown');
      if (g.satiety >= f.satiety.max) return fail('full');
      if (now < g.lastDrinkAt + dk.cooldownMinutes * MIN) return fail('cooldown');
      const next = Math.min(f.satiety.max, g.satiety + dk.satiety);
      return ok({ ...g, satiety: next, lastDrinkAt: now }, { type: 'drank', satiety: next - g.satiety });
    }
    // ───────────── V0.18：摸摸頭 ─────────────
    case 'headpat': {
      const hp = f.leisure?.headpat;
      if (!hp) return fail('unknown');
      const today = dayKey(now);
      const n = g.headpatToday.day === today ? g.headpatToday.n : 0;
      // 摸夠了還是可以摸（她還是會開心、也算願望），只是不再加好感
      const room = Math.max(0, f.affection.dailyCap - g.affectionToday.gained);
      const gain = n < hp.perDay ? Math.min(hp.affection, room) : 0;
      const before = levelName(g, d);
      const affection = g.affection + gain;
      const after = levelName(g, d, affection);
      return ok({
        ...g,
        affection,
        affectionToday: { ...g.affectionToday, gained: g.affectionToday.gained + gain },
        headpatToday: { day: today, n: n + 1 },
      }, { type: 'headpat', gain, left: Math.max(0, hp.perDay - n - 1), levelUp: after !== before ? after : undefined });
    }
    // ───────────── V0.17：日記 ─────────────
    case 'diary_read': {
      if (typeof a.id !== 'string' || !g.diary.some((e) => e.id === a.id)) return fail('unknown');
      return ok({ ...g, diary: g.diary.map((e) => (e.id === a.id ? { ...e, read: true } : e)) }, { type: 'diary_read', id: a.id });
    }
    // ───────────── V0.16：點心桌、冰箱（leisure.json） ─────────────
    case 'snack': {
      const sn = f.leisure?.snacks?.[a.table];
      if (!sn) return fail('unknown');
      const day = pantryDay(g, now);
      const used = day.snacks[a.table] ?? 0;
      if (used >= sn.perDay) return fail('sold_out');
      const satAfter = Math.min(f.satiety.max, g.satiety + sn.satiety);
      const capAfter = staminaCap(satAfter, d);
      const stGain = sn.stamina ?? Math.round(sn.satiety * (f.stats?.eat.staminaPerSatiety ?? 0));
      const stAfter = Math.max(g.stamina, Math.min(capAfter, g.stamina + stGain));
      if (g.satiety >= f.satiety.max && stAfter <= g.stamina) return fail('full');
      const room = Math.max(0, f.affection.dailyCap - g.affectionToday.gained);
      const gain = Math.min(sn.affection, room);
      const before = levelName(g, d);
      const affection = g.affection + gain;
      const after = levelName(g, d, affection);
      return ok({
        ...g,
        satiety: satAfter,
        stamina: stAfter,
        affection,
        affectionToday: { ...g.affectionToday, gained: g.affectionToday.gained + gain },
        pantryToday: { ...day, snacks: { ...day.snacks, [a.table]: used + 1 } },
      }, { type: 'snacked', table: a.table, satiety: satAfter - g.satiety, stamina: stAfter - g.stamina, gain, left: sn.perDay - used - 1, levelUp: after !== before ? after : undefined });
    }
    case 'fridge': {
      const fr = f.leisure?.fridge;
      if (!fr) return fail('unknown');
      const day = pantryDay(g, now);
      if (day.fridge >= fr.perDay) return ok(g, { type: 'fridge_opened', item: null, count: 0, left: 0 }); // 今天找過了：還是可以打開看看
      const pool = fr.finds.filter((x) => d.items.has(x.item) && x.weight > 0);
      const total = pool.reduce((t, x) => t + x.weight, 0);
      let r = rnd() * total;
      const got = pool.find((x) => (r -= x.weight) < 0) ?? pool[pool.length - 1];
      if (!got) return ok(g, { type: 'fridge_opened', item: null, count: 0, left: 0 });
      const count = Math.max(1, got.count ?? 1);
      return ok({ ...g, inventory: addItem(g.inventory, got.item, count), pantryToday: { ...day, fridge: day.fridge + 1 } },
        { type: 'fridge_opened', item: got.item, count, left: fr.perDay - day.fridge - 1 });
    }
    // ───────────── V0.11：泡澡、玩遊戲（leisure.json） ─────────────
    case 'bath': {
      const L = f.leisure;
      if (!L) return fail('unknown');
      if (now < g.lastBathAt + L.bath.cooldownHours * HOUR) return fail('cooldown');
      const cap = staminaCap(g.satiety, d);
      const stAfter = Math.max(g.stamina, Math.min(cap, g.stamina + L.bath.stamina));
      const room = Math.max(0, f.affection.dailyCap - g.affectionToday.gained);
      const gain = Math.min(L.bath.affection, room);
      const before = levelName(g, d);
      const affection = g.affection + gain;
      const after = levelName(g, d, affection);
      return ok({
        ...g,
        stamina: stAfter,
        affection,
        affectionToday: { ...g.affectionToday, gained: g.affectionToday.gained + gain },
        lastBathAt: now,
      }, { type: 'bathed', stamina: stAfter - g.stamina, gain, levelUp: after !== before ? after : undefined });
    }
    case 'play': {
      const L = f.leisure;
      if (!L?.play.games[a.game]) return fail('unknown');
      if (g.play) return ok(g, { type: 'play_started', game: g.play.game, since: g.play.since }); // 已經在玩了
      return ok({ ...g, play: { game: a.game, since: now } }, { type: 'play_started', game: a.game, since: now });
    }
    case 'stop_play': {
      const L = f.leisure;
      if (!L || !g.play) return fail('not_playing');
      const p = L.play;
      const hours = Math.max(0, Math.min(p.maxHours, (now - g.play.since) / HOUR));
      const minutes = Math.floor(hours * 60);
      const room = Math.max(0, f.affection.dailyCap - g.affectionToday.gained);
      const gain = Math.min(Math.floor(hours * p.affectionPerHour), p.maxAffectionPerSession, room);
      const cap = staminaCap(g.satiety, d);
      const stAfter = Math.max(g.stamina, Math.min(cap, g.stamina + Math.floor(hours * p.staminaPerHour)));
      const level = 1 + Math.floor(hours * p.levelsPerHour);
      const before = levelName(g, d);
      const affection = g.affection + gain;
      const after = levelName(g, d, affection);
      return ok({
        ...g,
        play: null,
        stamina: stAfter,
        affection,
        affectionToday: { ...g.affectionToday, gained: g.affectionToday.gained + gain },
      }, { type: 'play_stopped', game: g.play.game, minutes, gain, stamina: stAfter - g.stamina, level, levelUp: after !== before ? after : undefined });
    }
    // ───────────── V0.14：家具目錄（furniture_shop.json） ─────────────
    case 'buy_furniture': {
      const e = f.furniture?.items.find((x) => x.id === a.item);
      if (!e || !d.items.has(a.item)) return fail('unknown');
      const count = a.count === undefined ? 1 : a.count;
      if (!Number.isInteger(count) || count < 1 || count > 20) return fail('unknown');
      const cost = e.price * count;
      if ((g.inventory[COIN] ?? 0) < cost) return fail('no_item'); // 金幣不夠
      const inv = addItem(addItem(g.inventory, COIN, -cost), a.item, count);
      return ok({ ...g, inventory: inv, furnitureBought: { ...g.furnitureBought, [a.item]: (g.furnitureBought[a.item] ?? 0) + count } },
        { type: 'furniture_bought', item: a.item, count, cost });
    }
    case 'sell_furniture': {
      const F = f.furniture;
      const e = F?.items.find((x) => x.id === a.item);
      if (!F || !e) return fail('unknown');
      if ((g.inventory[a.item] ?? 0) <= 0) return fail('no_item'); // 擺出去的要先收回揹包
      const coins = resalePrice(e.price, F.resaleRate);
      return ok({ ...g, inventory: addItem(addItem(g.inventory, a.item, -1), COIN, coins) }, { type: 'furniture_sold', item: a.item, coins });
    }
    // ───────────── V0.13：酒館（tavern.json） ─────────────
    case 'coin_flip': {
      const T = f.tavern;
      if (!T || (a.guess !== 'heads' && a.guess !== 'tails')) return fail('unknown');
      const cf = T.coinFlip;
      if ((g.inventory[COIN] ?? 0) < cf.cost) return fail('no_item');
      const result = rnd() < 0.5 ? 'heads' : 'tails';
      const win = result === a.guess;
      const day = tavernDay(g, now);
      // 好感：猜對才有；同時受「猜硬幣每天上限」和「每天好感上限」限制
      const room = Math.max(0, Math.min(cf.maxAffectionPerDay - day.flipGain, f.affection.dailyCap - g.affectionToday.gained));
      const gain = win ? Math.min(cf.affection, room) : 0;
      const coins = win ? cf.reward - cf.cost : -cf.cost;
      const before = levelName(g, d);
      const affection = g.affection + gain;
      const after = levelName(g, d, affection);
      const inv = { ...g.inventory, [COIN]: (g.inventory[COIN] ?? 0) + coins };
      return ok({
        ...g,
        inventory: inv,
        affection,
        affectionToday: { ...g.affectionToday, gained: g.affectionToday.gained + gain },
        tavernToday: { ...day, flipGain: day.flipGain + gain },
      }, { type: 'coin_flipped', guess: a.guess, result, win, coins, gain, levelUp: after !== before ? after : undefined });
    }
    case 'cards': {
      const T = f.tavern;
      const n = f.npcs?.[a.npc];
      if (!T || !n) return fail('unknown');
      if (!tavernNpcs(T, now).includes(a.npc)) return fail('not_here'); // 不在酒館的人沒辦法陪你打牌
      // 各抽一張 1～13
      const mine = 1 + Math.floor(rnd() * 13);
      const theirs = 1 + Math.floor(rnd() * 13);
      const outcome = mine > theirs ? 'win' : mine < theirs ? 'lose' : 'tie';
      const day = tavernDay(g, now);
      const wins = day.cardWins[a.npc] ?? 0;
      const counted = outcome === 'win' && wins < T.cards.maxWinsPerDay;
      const st = g.npcs[a.npc] ?? { friendship: 0, talkDay: '', giftDay: '', events: {} };
      const friendship = clamp(st.friendship + (counted ? T.cards.friendship : 0), 0, 1000);
      const gain = friendship - st.friendship;
      return ok({
        ...g,
        npcs: { ...g.npcs, [a.npc]: { ...st, friendship } },
        tavernToday: { ...day, cardWins: outcome === 'win' ? { ...day.cardWins, [a.npc]: wins + 1 } : day.cardWins },
      }, { type: 'cards_played', npc: a.npc, mine, theirs, outcome, gain, friendship });
    }
    case 'trade': {
      const t = f.shops[a.shop]?.trades.find((x) => x.id === a.trade);
      if (!t) return fail('unknown');
      if (t.festival && festivalAt(now, d)?.id !== t.festival) return fail('not_today');
      const season = seasonAt(now, d);
      if (t.seasons && season && !t.seasons.includes(season.id)) return fail('not_today');
      const key = `${a.shop}:${t.id}`;
      const bought = g.shopToday.day === today ? g.shopToday.bought : {};
      if (t.dailyLimit !== undefined && (bought[key] ?? 0) >= t.dailyLimit) return fail('sold_out');
      if (!canPay(g.inventory, t.give)) return fail('no_item');
      const shopToday = { day: today, bought: { ...bought, [key]: (bought[key] ?? 0) + 1 } };
      return ok({ ...g, inventory: give(pay(g.inventory, t.give), t.get), shopToday, stats: { ...g.stats, traded: g.stats.traded + 1 } },
        { type: 'traded', shop: a.shop, trade: a.trade, get: { ...t.get } });
    }
    case 'sell': {
      const price = d.items.get(a.item)?.price;
      if (!price || a.item === COIN) return fail('not_for_sale');
      // 指定商人（例如老陳的魚攤）：只收他要的分類
      const shop = a.shop ? f.shops[a.shop] : undefined;
      if (a.shop && (!shop || shop.mode !== 'sell')) return fail('unknown');
      if (shop?.buys && !shop.buys.includes(d.items.get(a.item)?.category ?? '')) return fail('wrong_shop');
      if (!Number.isInteger(a.count) || a.count < 1) return fail('unknown');
      if ((g.inventory[a.item] ?? 0) < a.count) return fail('no_item');
      const coins = price * a.count;
      return ok({
        ...g,
        inventory: addItem(addItem(g.inventory, a.item, -a.count), COIN, coins),
        stats: { ...g.stats, sold: g.stats.sold + a.count, earned: g.stats.earned + coins },
      }, { type: 'sold', item: a.item, count: a.count, coins, ...(a.shop ? { shop: a.shop } : {}) });
    }
    case 'unlock': {
      const u = f.unlocks?.[a.id];
      if (!u) return fail('unknown');
      if (g.unlocked[a.id]) return fail('already');
      if (u.requires && !g.unlocked[u.requires]) return fail('locked');
      if (!canPay(g.inventory, u.cost)) return fail('no_item');
      const isBuilding = !!f.buildings?.[a.id];
      return ok({
        ...g,
        inventory: pay(g.inventory, u.cost),
        unlocked: { ...g.unlocked, [a.id]: true },
        buildingLevels: isBuilding ? { ...g.buildingLevels, [a.id]: 0 } : g.buildingLevels,
      }, { type: 'unlocked', id: a.id });
    }
    case 'machine_start': {
      const m = f.machines?.[a.machine];
      const r = m?.recipes.find((x) => x.id === a.recipe);
      if (!m || !r) return fail('unknown');
      if (g.machines[a.key]) return fail('busy');
      if (!canPay(g.inventory, r.give)) return fail('no_item');
      const readyAt = now + r.minutes * MIN;
      return ok({ ...g, inventory: pay(g.inventory, r.give), machines: { ...g.machines, [a.key]: { machine: a.machine, recipe: a.recipe, readyAt } } },
        { type: 'machine_started', key: a.key, readyAt });
    }
    case 'machine_collect': {
      const st = g.machines[a.key];
      if (!st) return fail('plot_empty');
      if (now < st.readyAt) return fail('not_ready');
      const r = f.machines?.[st.machine]?.recipes.find((x) => x.id === st.recipe);
      const get = r ? { ...r.get } : {};
      return ok({ ...g, inventory: give(g.inventory, get), machines: { ...g.machines, [a.key]: null } }, { type: 'machine_collected', key: a.key, get });
    }
    case 'upgrade_building': {
      const b = f.buildings?.[a.building];
      const cur = g.buildingLevels[a.building];
      if (!b) return fail('unknown');
      if (cur === undefined) return fail('locked');
      const next = b.levels[cur + 1];
      if (!next) return fail('already');
      if (!canPay(g.inventory, next.cost)) return fail('no_item');
      return ok({ ...g, inventory: pay(g.inventory, next.cost), buildingLevels: { ...g.buildingLevels, [a.building]: cur + 1 } },
        { type: 'building_upgraded', building: a.building, level: cur + 1, capacity: next.capacity });
    }
    case 'buy_animal': {
      const def = f.animals?.[a.kind];
      if (!def) return fail('unknown');
      const lvl = g.buildingLevels[def.building];
      if (lvl === undefined) return fail('locked');
      if (g.animals.filter((x) => x.building === def.building).length >= capacityOf(d, def.building, lvl)) return fail('no_room');
      if (!canPay(g.inventory, def.price)) return fail('no_item');
      const id = g.nextAnimalId;
      const name = (a.name ?? '').trim().slice(0, 12) || `${def.baby?.name ?? def.name}${id}`;
      // 買來的是幼崽：長大（growHours）之後才開始算產出
      const grow = (def.baby?.growHours ?? 0) * HOUR;
      const animal: AnimalState = { id, kind: a.kind, name, building: def.building, bornAt: now, fedUntil: now, mood: 60, friendship: 0, lastPetDay: '', readyAt: now + grow + def.hours * HOUR, pending: null };
      return ok({ ...g, inventory: pay(g.inventory, def.price), animals: [...g.animals, animal], nextAnimalId: id + 1 },
        { type: 'animal_bought', animal: id, kind: a.kind, name });
    }
    case 'feed_animals': {
      let inv = g.inventory;
      let count = 0;
      let hungry = 0;
      const animals = g.animals.map((x) => {
        if (x.building !== a.building || x.fedUntil > now) return x;
        hungry++;
        const feed = f.animals?.[x.kind]?.feed;
        if (!feed || (inv[feed] ?? 0) <= 0) return x;
        inv = addItem(inv, feed, -1);
        count++;
        return { ...x, fedUntil: now + DAY_MS };
      });
      if (!hungry) return fail('already');
      if (!count) return fail('no_item');
      return ok({ ...g, inventory: inv, animals }, { type: 'animals_fed', building: a.building, count });
    }
    case 'pet_animal': {
      const x = g.animals.find((y) => y.id === a.animal);
      if (!x) return fail('unknown');
      if (x.lastPetDay === today) return fail('already');
      const next = { ...x, lastPetDay: today, mood: clamp(x.mood + 15, 0, 100), friendship: clamp(x.friendship + 30, 0, 1000) };
      return ok({ ...g, animals: g.animals.map((y) => (y.id === a.animal ? next : y)) },
        { type: 'animal_petted', animal: a.animal, mood: next.mood, friendship: next.friendship });
    }
    case 'collect_animals': {
      let inv = g.inventory;
      const items: Record<ItemId, number> = {};
      const animals = g.animals.map((x) => {
        if (x.building !== a.building || !x.pending) return x;
        inv = addItem(inv, x.pending, 1);
        items[x.pending] = (items[x.pending] ?? 0) + 1;
        const hours = f.animals?.[x.kind]?.hours ?? 24;
        return { ...x, pending: null, readyAt: x.readyAt <= now ? now + hours * HOUR : x.readyAt };
      });
      if (!Object.keys(items).length) return fail('not_ready');
      return ok({ ...g, inventory: inv, animals }, { type: 'animals_collected', building: a.building, items });
    }
    case 'place': {
      const def = d.items.get(a.item);
      if (!def?.place) return fail('unknown');
      if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || a.x < 0 || a.y < 0 || !/^[a-z0-9-]+$/.test(a.scene)) return fail('unknown');
      if ((g.inventory[a.item] ?? 0) <= 0) return fail('no_item');
      const list = g.placed[a.scene] ?? [];
      // V0.14：家具可以佔好幾格；地毯和非地毯可以疊（桌子擺在地毯上），同一類不能重疊
      const mine = footprint(a.item, a.x, a.y, d);
      if (list.some((p) => !!d.items.get(p.item)?.place?.rug === !!def.place?.rug && overlaps(mine, footprint(p.item, p.x, p.y, d)))) return fail('plot_busy');
      return ok({ ...g, inventory: addItem(g.inventory, a.item, -1), placed: { ...g.placed, [a.scene]: [...list, { item: a.item, x: a.x, y: a.y }] } },
        { type: 'placed', scene: a.scene, item: a.item, x: a.x, y: a.y });
    }
    case 'pickup': {
      const list = g.placed[a.scene] ?? [];
      // V0.14：點到家具佔的任何一格都算；疊在地毯上的家具先收
      const hits = list.filter((q) => inFootprint(footprint(q.item, q.x, q.y, d), a.x, a.y));
      const p = hits.find((q) => !d.items.get(q.item)?.place?.rug) ?? hits[0];
      if (!p) return fail('unknown');
      const at = { x: p.x, y: p.y };
      const key = `${a.scene}/placed-${at.x}-${at.y}`;
      if (d.items.get(p.item)?.place?.plot && g.plots[key]) return fail('plot_busy');
      let inv = addItem(g.inventory, p.item, 1);
      const sprinklers = { ...g.sprinklers };
      if (sprinklers[key] && f.farming?.sprinklerItem) {
        delete sprinklers[key];
        inv = addItem(inv, f.farming.sprinklerItem, 1);
      }
      return ok({ ...g, inventory: inv, sprinklers, placed: { ...g.placed, [a.scene]: list.filter((q) => q !== p) } },
        { type: 'picked_up', scene: a.scene, item: p.item });
    }
    case 'decorate': {
      const dec = d.items.get(a.item)?.decor;
      if (!dec) return fail('unknown');
      if ((g.inventory[a.item] ?? 0) <= 0) return fail('no_item');
      const cur = g.decor[a.scene] ?? {};
      const returned = cur[dec.kind];
      if (returned === a.item) return fail('already');
      let inv = addItem(g.inventory, a.item, -1);
      if (returned) inv = addItem(inv, returned, 1);
      return ok({ ...g, inventory: inv, decor: { ...g.decor, [a.scene]: { ...cur, [dec.kind]: a.item } } },
        { type: 'decorated', scene: a.scene, item: a.item, returned });
    }
    case 'talk': {
      const n = f.npcs?.[a.npc];
      if (!n) return fail('unknown');
      const st = g.npcs[a.npc] ?? { friendship: 0, talkDay: '', giftDay: '', events: {} };
      const gain = st.talkDay === today ? 0 : 20;
      const friendship = clamp(st.friendship + gain, 0, 1000);
      const ev = n.events?.find((e) => e.minFriendship <= friendship && !st.events[e.id]);
      const phase = dayPhase(now);
      const pool = n.lines.filter((l) => (l.minFriendship ?? 0) <= friendship && (!l.phases || l.phases.includes(phase)));
      const top = Math.max(0, ...pool.map((l) => l.minFriendship ?? 0));
      // 一半機率說目前解鎖的最新台詞，一半隨機
      const best = pool.filter((l) => (l.minFriendship ?? 0) === top);
      const from = rnd() < 0.5 ? best : pool;
      const pick = from[Math.floor(rnd() * from.length)] ?? pool[0];
      const next: NpcState = { ...st, friendship, talkDay: today, events: ev ? { ...st.events, [ev.id]: true } : st.events };
      return ok({ ...g, npcs: { ...g.npcs, [a.npc]: next } },
        { type: 'talked', npc: a.npc, text: pick?.text ?? '……', gain, event: ev ? { id: ev.id, lines: [...ev.lines] } : undefined });
    }
    case 'gift': {
      const n = f.npcs?.[a.npc];
      if (!n) return fail('unknown');
      if ((g.inventory[a.item] ?? 0) <= 0 || a.item === COIN) return fail('no_item');
      const st = g.npcs[a.npc] ?? { friendship: 0, talkDay: '', giftDay: '', events: {} };
      if (st.giftDay === today) return fail('too_soon');
      const reaction = n.loves?.includes(a.item) ? 'love' : n.likes?.includes(a.item) ? 'like' : n.dislikes?.includes(a.item) ? 'dislike' : 'neutral';
      const gain = { love: 80, like: 45, neutral: 20, dislike: -20 }[reaction];
      return ok({
        ...g,
        inventory: addItem(g.inventory, a.item, -1),
        npcs: { ...g.npcs, [a.npc]: { ...st, giftDay: today, friendship: clamp(st.friendship + gain, 0, 1000) } },
      }, { type: 'gifted', npc: a.npc, item: a.item, gain, reaction });
    }
    case 'propose': {
      const m = f.marriage;
      if (!m) return fail('unknown');
      if (g.marriedAt) return fail('already');
      if (g.affection < m.minAffection) return fail('locked');
      if ((g.inventory[m.item] ?? 0) <= 0) return fail('no_item');
      return ok({ ...g, inventory: addItem(g.inventory, m.item, -1), marriedAt: now }, { type: 'married' });
    }
    case 'mine_start': {
      const mine = f.mine;
      if (!mine) return fail('unknown');
      if (g.mine.trip) return fail('busy');
      if (!Number.isInteger(a.floor) || a.floor < 1 || a.floor > mineMaxFloor(d) || a.floor > g.mine.deepest + 1) return fail('too_deep');
      const zone = mineZone(d, a.floor)!;
      if (equipmentOf(g.inventory, d).pickaxe.power < zone.needPickaxe) return fail('weak_pickaxe');
      if (g.stamina < mine.staminaCost) return fail('no_stamina');
      const endsAt = now + zone.minutes * MIN;
      return ok({ ...g, stamina: g.stamina - mine.staminaCost, mine: { ...g.mine, trip: { floor: a.floor, startedAt: now, endsAt } } },
        { type: 'mine_started', floor: a.floor, endsAt });
    }
    case 'mine_collect': {
      const trip = g.mine.trip;
      if (!trip) return fail('unknown');
      if (now < trip.endsAt) return fail('not_ready');
      const report = simulateMine(g, d, trip.floor, rnd);
      return ok({
        ...g,
        stamina: report.injured ? 0 : g.stamina,
        inventory: give(g.inventory, report.items),
        mine: { deepest: report.deepest, trip: null },
        stats: { ...g.stats, kills: g.stats.kills + report.kills.reduce((n, k) => n + k.count, 0) },
      }, { type: 'mine_returned', report });
    }
    case 'mine_loot': {
      // 擴展 E4（即時戰鬥）：畫面送來戰利品，host 只收這一層可能掉的東西、每樣最多 20 個
      const zone = mineZone(d, a.floor);
      if (!zone || !Number.isInteger(a.floor) || a.floor > g.mine.deepest + 3) return fail('too_deep');
      // 一路往下打，會帶著上面幾層的東西：這一層以上所有區域的掉落都算
      const zones = f.mine!.zones.filter((z) => z.from <= a.floor);
      const allowed = new Set(zones.flatMap((z) => [...z.loot.map((e) => e.item), ...z.monsters.flatMap((m) => (m.drop ? [m.drop] : []))]));
      const items: Record<ItemId, number> = {};
      for (const [id, n] of Object.entries(a.items)) {
        if (!allowed.has(id) || !Number.isInteger(n) || n < 1) continue;
        const kept = a.died ? Math.floor(Math.min(n, 20) / 2) : Math.min(n, 20);
        if (kept > 0) items[id] = kept;
      }
      const kills = clamp(Math.floor(a.kills) || 0, 0, 50);
      const deepest = a.died ? g.mine.deepest : Math.max(g.mine.deepest, a.floor);
      const report: MineReport = { floor: a.floor, reached: a.died ? a.floor - 1 : a.floor, injured: a.died, kills: [], damage: clamp(Math.floor(a.damage ?? 0) || 0, 0, 9999), items, deepest };
      return ok({
        ...g,
        stamina: a.died ? 0 : g.stamina,
        inventory: give(g.inventory, items),
        mine: { ...g.mine, deepest },
        stats: { ...g.stats, kills: g.stats.kills + kills },
      }, { type: 'mine_returned', report });
    }
    case 'gift_send': {
      if (!d.items.has(a.item) || !Number.isInteger(a.count) || a.count < 1 || a.count > 99) return fail('unknown');
      if ((g.inventory[a.item] ?? 0) < a.count) return fail('no_item');
      const nonce = `${Math.floor(rnd() * 2 ** 32).toString(36)}${now.toString(36)}`;
      return ok({ ...g, inventory: addItem(g.inventory, a.item, -a.count), redeemed: { ...g.redeemed, [nonce]: true } },
        { type: 'gift_code', code: encodeGift(a.item, a.count, nonce, f.gifts?.salt ?? 'whale') });
    }
    case 'gift_redeem': {
      const gift = decodeGift(a.code, f.gifts?.salt ?? 'whale');
      if (!gift || !d.items.has(gift.item)) return fail('bad_code');
      if (g.redeemed[gift.nonce]) return fail('already');
      return ok({ ...g, inventory: addItem(g.inventory, gift.item, gift.count), redeemed: { ...g.redeemed, [gift.nonce]: true } },
        { type: 'gift_received', items: { [gift.item]: gift.count } });
    }
  }
}

/** 派遣礦洞：一次算完這一趟（打怪、受傷、挖礦） */
export function simulateMine(g: GameState, d: GameplayDefs, floor: number, rnd: () => number): MineReport {
  const mine = d.file.mine!;
  const zone = mineZone(d, floor)!;
  const eq = equipmentOf(g.inventory, d);
  const power = mine.basePower + eq.weapon.power;
  const armor = eq.armor.power;
  let hp = mine.baseHp + armor * 2;
  const depth = floor - zone.from; // 同一區越深越強
  const kills = new Map<string, { name: string; emoji: string; count: number }>();
  const items: Record<ItemId, number> = {};
  let injured = false;
  let damage = 0;
  const fights = 2 + Math.floor(floor / 3);
  for (let i = 0; i < fights && !injured; i++) {
    const m = zone.monsters[Math.floor(rnd() * zone.monsters.length)]!;
    let mhp = Math.ceil(m.hp * (1 + depth * 0.15));
    while (mhp > 0) {
      mhp -= power;
      if (mhp <= 0) break;
      const hit = Math.max(1, Math.ceil(m.atk * (1 + depth * 0.1)) - armor);
      hp -= hit;
      damage += hit;
      if (hp <= 0) {
        injured = true;
        break;
      }
    }
    if (injured) break;
    const k = kills.get(m.name) ?? { name: m.name, emoji: m.emoji, count: 0 };
    k.count++;
    kills.set(m.name, k);
    if (m.drop && rnd() < 0.5) items[m.drop] = (items[m.drop] ?? 0) + 1;
  }
  let rolls = 2 + Math.floor(floor / 2);
  if (injured) rolls = Math.floor(rolls / 2);
  const ctx = lootContext(g, d, 0);
  // 好運（女神）也讓礦洞的稀有掉落變多；派遣出發時有好運就算
  const lucky = g.luckUntil > (g.mine.trip?.startedAt ?? 0);
  const luck = d.file.fishing.goddess?.luck ?? {};
  const pet = petRareMult(g, d, 'mine_luck'); // V0.6：鼴鼠之類的寵物
  for (let i = 0; i < rolls; i++) {
    const it = rollLoot(zone.loot, { ...ctx, phase: 'afternoon' }, rnd, (e) => {
      const r = rarityOf(e.item, d);
      return (lucky ? luck[r] ?? 1 : 1) * pet[r];
    });
    if (it) items[it] = (items[it] ?? 0) + 1;
  }
  const reached = injured ? floor - 1 : floor;
  return { floor, reached, injured, kills: [...kills.values()], damage, items, deepest: Math.max(g.mine.deepest, reached) };
}
