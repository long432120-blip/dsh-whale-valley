// V0.6 寵物系統：商店購買、野外捕捉、飽食度與好感、被動技能；還有跟寵物有關的農場事件
// （地上的掉落物、烏鴉）。全部是純函數，資料來自 pets.json 與 gameplay.json。
// gameplay.ts 的 tickGame / applyAction / gameView 會呼叫這裡。
import {
  COIN,
  type FarmReport, type ForageSpot, type GameAction, type GameEvent, type GameplayDefs, type GameState, type ItemId,
  type PetSkillKind, type PetSpeciesDef, type PetState, type PetView, type PlotState, type Rarity, type WildSpawn,
  type ActError, type GameplayFile,
} from './gameplay-types.ts';
import { addItem, rngFrom, rollLoot, seasonAt, weatherAt, weatherDef, festivalAt, settlePlot } from './gameplay.ts';
import { dayIndex, dayKey, dayPhase, dayStart } from './time.ts';
import { validateDiary } from './diary.ts';
import { validateWishes } from './wishes.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY_MS = 24 * HOUR;

type Outcome = { ok: true; game: GameState; event: GameEvent } | { ok: false; error: ActError };
const ok = (game: GameState, event: GameEvent): Outcome => ({ ok: true, game, event });
const fail = (error: ActError): Outcome => ({ ok: false, error });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 字串 → 32 位元種子（FNV-1a）：同一天、同一張地圖算出來的掉落物和野生寵物永遠一樣 */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

export const speciesOf = (d: GameplayDefs, kind: string): PetSpeciesDef | undefined => d.file.pets?.species[kind];

// ───────────── 技能 ─────────────
/** 某個時間點的飽食度（從 from 的快照往後扣） */
function satietyAt(p: PetState, d: GameplayDefs, from: number, t: number): number {
  const sp = speciesOf(d, p.kind);
  return Math.max(0, p.satiety - Math.max(0, t - from) / HOUR * (sp?.satietyDecay ?? 0));
}

/** 好感越高技能越強：1 ～ 1 + skillBonusAtMax */
export function skillPower(p: PetState, d: GameplayDefs): number {
  const cfg = d.file.pets?.affection;
  if (!cfg) return 1;
  return 1 + (clamp(p.affection, 0, cfg.max) / cfg.max) * cfg.skillBonusAtMax;
}

/** 同一種技能只算最強的那一隻；餓了（飽食度 0）就不算 */
export function bestSkill(g: GameState, d: GameplayDefs, kind: PetSkillKind, at?: { from: number; t: number }) {
  let best: { pet: PetState; power: number } | null = null;
  for (const p of g.pets) {
    const sp = speciesOf(d, p.kind);
    if (sp?.skill.kind !== kind) continue;
    const full = at ? satietyAt(p, d, at.from, at.t) : p.satiety;
    if (full <= 0) continue;
    const power = skillPower(p, d);
    if (!best || power > best.power) best = { pet: p, power };
  }
  return best;
}

/** fishing_luck、mine_luck：稀有掉落的倍率（好感加成只放大「超過 1 的部分」） */
export function petRareMult(g: GameState, d: GameplayDefs, kind: 'fishing_luck' | 'mine_luck'): Record<Rarity, number> {
  const out = { common: 1, epic: 1, legendary: 1 } as Record<Rarity, number>;
  const s = bestSkill(g, d, kind);
  if (!s) return out;
  const rare = speciesOf(d, s.pet.kind)!.skill.rare ?? {};
  for (const r of ['epic', 'legendary'] as Rarity[]) out[r] = 1 + ((rare[r] ?? 1) - 1) * s.power;
  return out;
}

// ───────────── 地上的掉落物 ─────────────
/** 某一天（dayAt = 那天 0 點）每張地圖的掉落物：由日期決定，不吃存檔亂數 */
export function forageFor(dayAt: number, d: GameplayDefs): ForageSpot[] {
  const f = d.file.forage;
  if (!f) return [];
  const noon = dayAt + 12 * HOUR;
  const w = weatherAt(noon, d);
  const ctx = { phase: 'morning' as const, affection: 0, season: seasonAt(noon, d)?.id, weather: w, weatherTags: weatherDef(w, d).tags, festival: festivalAt(noon, d)?.id };
  const out: ForageSpot[] = [];
  for (const [scene, s] of Object.entries(f.scenes)) {
    const rng = rngFrom(hashSeed(`forage:${dayIndex(noon)}:${scene}`));
    const rnd = () => rng.next();
    for (let slot = 0; slot < s.slots; slot++) {
      if (rnd() >= s.chance) continue;
      const item = rollLoot(s.table, ctx, rnd);
      if (item) out.push({ scene, slot, item });
    }
  }
  return out;
}

export function forageLeft(g: GameState, d: GameplayDefs, now: number): ForageSpot[] {
  const today = dayStart(now);
  const picked = g.forage.dayAt === today ? g.forage.picked : {};
  return forageFor(today, d).filter((s) => !picked[`${s.scene}:${s.slot}`]);
}

// ───────────── 野生寵物 ─────────────
/**
 * 一天切成 blockHours 一段。每一段、每張地圖：
 *   1. 找出「這張地圖、這個天氣、這個時段、這個季節」會出現的種類
 *   2. 用（日期:段:地圖）當種子擲骰：< chance × 天氣加成 才出現
 *   3. 依 weight 挑一種
 * 結果只看時間，同一段時間重開幾次都一樣；抓到或跑掉之後這一段就不再出現。
 */
export function wildAt(scene: string, now: number, g: GameState, d: GameplayDefs): WildSpawn | null {
  const P = d.file.pets;
  if (!P) return null;
  const blockMs = P.wild.blockHours * HOUR;
  const start = dayStart(now);
  const block = Math.floor((now - start) / blockMs);
  const id = `${dayIndex(now)}:${block}:${scene}`;
  if (g.wild[id]) return null;
  const mid = start + block * blockMs + blockMs / 2; // 用這一段的中間判斷時段：整段時間結果一致
  const wid = weatherAt(mid, d);
  const tags = [wid, ...(weatherDef(wid, d).tags ?? [])];
  const phase = dayPhase(mid);
  const season = seasonAt(mid, d)?.id;
  const pool = Object.entries(P.species).filter(([, s]) => {
    const w = s.wild;
    if (!w || !w.scenes.includes(scene)) return false;
    if (w.weather && !w.weather.some((x) => tags.includes(x))) return false;
    if (w.phases && !w.phases.includes(phase)) return false;
    if (w.seasons && season && !w.seasons.includes(season)) return false;
    return w.weight > 0;
  });
  if (!pool.length) return null;
  const rng = rngFrom(hashSeed(`wild:${id}`));
  const bonus = Math.max(1, ...tags.map((t) => P.wild.weatherBonus?.[t] ?? 1));
  if (rng.next() >= Math.min(1, P.wild.chance * bonus)) return null;
  const total = pool.reduce((n, [, s]) => n + s.wild!.weight, 0);
  let r = rng.next() * total;
  let kind = pool[0]![0];
  for (const [k, s] of pool) {
    r -= s.wild!.weight;
    if (r < 0) {
      kind = k;
      break;
    }
  }
  return { id, scene, kind, until: start + (block + 1) * blockMs };
}

export function wildList(now: number, g: GameState, d: GameplayDefs): WildSpawn[] {
  const scenes = new Set(Object.values(d.file.pets?.species ?? {}).flatMap((s) => s.wild?.scenes ?? []));
  return [...scenes].map((s) => wildAt(s, now, g, d)).filter((x): x is WildSpawn => !!x);
}

export function catchChance(kind: string, net: ItemId, d: GameplayDefs): number {
  const w = speciesOf(d, kind)?.wild;
  const power = d.items.get(net)?.net?.power ?? 0;
  return w ? clamp(w.catchRate * power, 0, 0.95) : 0;
}

// ───────────── 時間結算（tickGame 裡呼叫） ─────────────
/** 這種作物從種下到成熟要長多久 */
const growMs = (p: PlotState, d: GameplayDefs) => (d.crops.get(p.crop)?.stages.at(-1)?.atMinutes ?? 0) * MIN;
const isMature = (p: PlotState, d: GameplayDefs) => !d.crops.get(p.crop) || p.growthMs >= growMs(p, d);

/**
 * 每個早上（起床時間）依序：先把田結算到那個時間點 → 下雨澆田 → 寵物澆田 → 烏鴉。
 * 跨日時：昨天沒撿的掉落物，狗幫忙撿回一些。最後寵物扣飽食度。
 */
export function tickFarmAndPets(
  g: GameState, plots0: GameState['plots'], from: number, to: number, d: GameplayDefs, rnd: () => number,
  wetAlways: (key: string) => boolean, mornings: number[],
): Pick<GameState, 'plots' | 'pets' | 'forage' | 'wild' | 'farmReport' | 'inventory'> {
  const f = d.file;
  let plots = plots0;
  let report = g.farmReport;
  let inv = g.inventory;
  const rep = (t: number): FarmReport => {
    const day = dayKey(t);
    if (report?.day !== day) report = { day, pecked: [], scared: 0, watered: 0, picked: {} };
    return report;
  };
  for (const t of mornings) {
    // 1. 田先結算到這個早上
    const at: GameState['plots'] = {};
    for (const [k, p] of Object.entries(plots)) at[k] = p ? settlePlot(p, wetAlways(k), t, d) : null;
    plots = at;
    const wet = weatherDef(weatherAt(t, d), d).wet;
    // 2. 下雨：所有的田澆好，撐到隔天早上
    if (wet) for (const [k, p] of Object.entries(plots)) if (p && p.wateredUntil < t + DAY_MS) plots[k] = { ...p, wateredUntil: t + DAY_MS };
    // 3. 寵物澆田（例如小精靈）：挑還乾著的田
    const water = bestSkill(g, d, 'water_plots', { from, t });
    if (water && f.farming) {
      let n = Math.round((speciesOf(d, water.pet.kind)!.skill.plots ?? 1) * water.power);
      for (const [k, p] of Object.entries(plots)) {
        if (n <= 0) break;
        if (!p || wetAlways(k) || p.wateredUntil > t || isMature(p, d)) continue;
        plots[k] = { ...p, wateredUntil: t + f.farming.waterHours * HOUR };
        rep(t).watered++;
        n--;
      }
    }
    // 4. 烏鴉：戶外種的作物夠多才會來（溫室、裝了灑水器的不算）；貓會趕走大部分
    const crows = f.farming?.crows;
    if (crows) {
      const targets = Object.entries(plots).filter(([k, p]) => p && !wetAlways(k)) as [string, PlotState][];
      if (targets.length >= crows.minCrops) {
        const cat = bestSkill(g, d, 'crow_guard', { from, t });
        const keep = cat ? clamp(1 - (1 - (speciesOf(d, cat.pet.kind)!.skill.crowMult ?? 1)) * cat.power, 0, 1) : 1;
        for (const [k, p] of targets) {
          const r = rnd();
          if (r >= crows.chance) continue;
          if (r < crows.chance * keep) {
            // 被啄：生長倒退（已經成熟的也會被啄回還沒熟）
            plots[k] = { ...p, growthMs: Math.max(0, Math.min(p.growthMs, growMs(p, d)) - crows.setbackHours * HOUR) };
            rep(t).pecked.push(k);
          } else rep(t).scared++;
        }
      }
    }
  }
  // 跨日：昨天的掉落物，狗撿回來一些（畫面開著的時候牠會自己走過去撿，這裡補離線的部分）
  let forage = g.forage;
  const today = dayStart(to);
  if (forage.dayAt !== today) {
    const dog = bestSkill(g, d, 'auto_pickup', { from, t: Math.min(to, forage.dayAt + DAY_MS) });
    if (dog && forage.dayAt > 0 && today - forage.dayAt <= 2 * DAY_MS) {
      let n = Math.round((speciesOf(d, dog.pet.kind)!.skill.perDay ?? 0) * dog.power);
      for (const s of forageFor(forage.dayAt, d)) {
        if (n <= 0) break;
        if (forage.picked[`${s.scene}:${s.slot}`]) continue;
        inv = addItem(inv, s.item, 1);
        const r = rep(to);
        r.picked = { ...r.picked, [s.item]: (r.picked[s.item] ?? 0) + 1 };
        n--;
      }
    }
    forage = { dayAt: today, picked: {} };
  }
  // 野生寵物的紀錄只留今天和昨天
  const keepFrom = dayIndex(to) - 1;
  const wild = Object.fromEntries(Object.entries(g.wild).filter(([k]) => Number(k.split(':')[0]) >= keepFrom));
  // 飽食度
  const pets = g.pets.map((p) => ({ ...p, satiety: satietyAt(p, d, from, to) }));
  return { plots, pets, forage, wild, farmReport: report, inventory: inv };
}

// ───────────── 動作 ─────────────
function newPet(g: GameState, d: GameplayDefs, kind: string, name: string | undefined, now: number, how: PetState['how']): PetState {
  const sp = speciesOf(d, kind)!;
  const base = (name ?? '').trim().slice(0, 12) || sp.name;
  let nm = base;
  for (let i = 2; g.pets.some((p) => p.name === nm); i++) nm = `${base}${i}`;
  return { id: g.nextPetId, kind, name: nm, affection: 0, satiety: d.file.pets!.satiety.start, lastPetDay: '', obtainedAt: now, how };
}

type PetActionType = 'buy_pet' | 'feed_pet' | 'pet_pet' | 'set_companion' | 'release_pet' | 'catch_pet' | 'forage';
export type PetAction = Extract<GameAction, { type: PetActionType }>;
const PET_ACTIONS = new Set<string>(['buy_pet', 'feed_pet', 'pet_pet', 'set_companion', 'release_pet', 'catch_pet', 'forage'] satisfies PetActionType[]);
export const isPetAction = (a: GameAction): a is PetAction => PET_ACTIONS.has(a.type);

export function runPet(g: GameState, a: PetAction, d: GameplayDefs, now: number, rnd: () => number): Outcome {
  const P = d.file.pets;
  const today = dayKey(now);
  const findPet = (id: number) => g.pets.find((p) => p.id === id);
  switch (a.type) {
    case 'buy_pet': {
      const sp = speciesOf(d, a.kind);
      if (!P || !sp?.shop) return fail('not_for_sale');
      if (g.pets.length >= P.maxPets) return fail('too_many_pets');
      const price = sp.shop.price;
      if (!Object.entries(price).every(([id, n]) => (g.inventory[id] ?? 0) >= n)) return fail('no_item');
      let inv = g.inventory;
      for (const [id, n] of Object.entries(price)) inv = addItem(inv, id, -n);
      const pet = newPet(g, d, a.kind, a.name, now, 'shop');
      return ok({ ...g, inventory: inv, pets: [...g.pets, pet], nextPetId: pet.id + 1 }, { type: 'pet_bought', pet: pet.id, kind: a.kind, name: pet.name });
    }
    case 'feed_pet': {
      const p = findPet(a.pet);
      const sp = p && speciesOf(d, p.kind);
      if (!P || !p || !sp) return fail('unknown');
      if ((g.inventory[a.item] ?? 0) <= 0) return fail('no_item');
      const cat = d.items.get(a.item)?.category;
      const diet = sp.diet.find((x) => (x.item && x.item === a.item) || (x.category && x.category === cat));
      if (!diet) return fail('not_food');
      if (p.satiety >= P.satiety.max - 1) return fail('not_hungry');
      const next = { ...p, satiety: Math.min(P.satiety.max, p.satiety + diet.satiety), affection: Math.min(P.affection.max, p.affection + P.affection.feedGain) };
      return ok({ ...g, inventory: addItem(g.inventory, a.item, -1), pets: g.pets.map((x) => (x === p ? next : x)) },
        { type: 'pet_fed', pet: p.id, item: a.item, satiety: next.satiety, affection: next.affection });
    }
    case 'pet_pet': {
      const p = findPet(a.pet);
      if (!P || !p) return fail('unknown');
      if (p.lastPetDay === today) return fail('already');
      const next = { ...p, lastPetDay: today, affection: Math.min(P.affection.max, p.affection + P.affection.petGain) };
      return ok({ ...g, pets: g.pets.map((x) => (x === p ? next : x)) }, { type: 'pet_petted', pet: p.id, affection: next.affection });
    }
    case 'set_companion': {
      if (a.pet !== null && !findPet(a.pet)) return fail('unknown');
      return ok({ ...g, companion: a.pet }, { type: 'companion_set', pet: a.pet });
    }
    case 'release_pet': {
      const p = findPet(a.pet);
      if (!p) return fail('unknown');
      return ok({ ...g, pets: g.pets.filter((x) => x !== p), companion: g.companion === p.id ? null : g.companion },
        { type: 'pet_released', pet: p.id, name: p.name });
    }
    case 'catch_pet': {
      if (!P) return fail('unknown');
      const spawn = wildAt(a.scene, now, g, d);
      if (!spawn || spawn.id !== a.spawn) return fail('gone');
      if (!d.items.get(a.net)?.net) return fail('unknown');
      if ((g.inventory[a.net] ?? 0) <= 0) return fail('no_item');
      if (g.pets.length >= P.maxPets) return fail('too_many_pets');
      const chance = catchChance(spawn.kind, a.net, d);
      const inv = addItem(g.inventory, a.net, -1); // 網子丟出去就用掉了
      if (rnd() < chance) {
        const pet = newPet(g, d, spawn.kind, undefined, now, 'wild');
        return ok({ ...g, inventory: inv, pets: [...g.pets, pet], nextPetId: pet.id + 1, wild: { ...g.wild, [spawn.id]: 'caught' } },
          { type: 'pet_caught', pet: pet.id, kind: spawn.kind, name: pet.name, chance, net: a.net });
      }
      const fled = rnd() < (speciesOf(d, spawn.kind)!.wild!.flee);
      return ok({ ...g, inventory: inv, wild: fled ? { ...g.wild, [spawn.id]: 'fled' } : g.wild },
        { type: 'pet_escaped', kind: spawn.kind, fled, chance, net: a.net });
    }
    case 'forage': {
      const spot = forageLeft(g, d, now).find((s) => s.scene === a.scene && s.slot === a.slot);
      if (!spot) return fail('gone');
      if (a.by !== undefined) {
        const p = findPet(a.by);
        if (!p || speciesOf(d, p.kind)?.skill.kind !== 'auto_pickup' || p.satiety <= 0) return fail('unknown');
      }
      const dayAt = dayStart(now);
      const picked = g.forage.dayAt === dayAt ? g.forage.picked : {};
      return ok({ ...g, inventory: addItem(g.inventory, spot.item, 1), forage: { dayAt, picked: { ...picked, [`${a.scene}:${a.slot}`]: true } } },
        { type: 'foraged', scene: a.scene, slot: a.slot, item: spot.item, ...(a.by !== undefined ? { by: a.by } : {}) });
    }
  }
}

// ───────────── 畫面資料、存檔整理、檢查 ─────────────
export function petViews(g: GameState, d: GameplayDefs, now: number): PetView[] {
  const today = dayKey(now);
  const best = new Map<PetSkillKind, number>();
  for (const kind of ['auto_pickup', 'crow_guard', 'fishing_luck', 'water_plots', 'mine_luck'] as PetSkillKind[]) {
    const s = bestSkill(g, d, kind);
    if (s) best.set(kind, s.pet.id);
  }
  return g.pets.map((p) => {
    const sp = speciesOf(d, p.kind);
    return {
      ...p,
      satiety: Math.round(p.satiety),
      emoji: sp?.emoji ?? '🐾',
      speciesName: sp?.name ?? p.kind,
      home: sp?.home ?? d.file.pets?.defaultHome ?? 'garden',
      hungry: p.satiety <= 0,
      pettedToday: p.lastPetDay === today,
      skillActive: !!sp && best.get(sp.skill.kind) === p.id,
      skillPower: skillPower(p, d),
    };
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);

export function normalizePets(r: Record<string, unknown>, now: number, d?: GameplayDefs): Pick<GameState, 'pets' | 'nextPetId' | 'companion' | 'forage' | 'wild' | 'farmReport'> {
  const pets: PetState[] = (Array.isArray(r.pets) ? r.pets : []).filter(isObj).map((p) => ({
    id: num(p.id, 0),
    kind: typeof p.kind === 'string' ? p.kind : '',
    name: typeof p.name === 'string' ? p.name : '',
    affection: num(p.affection, 0),
    satiety: num(p.satiety, d?.file.pets?.satiety.start ?? 60),
    lastPetDay: typeof p.lastPetDay === 'string' ? p.lastPetDay : '',
    obtainedAt: num(p.obtainedAt, now),
    how: p.how === 'wild' ? 'wild' as const : p.how === 'adopt' ? 'adopt' as const : 'shop' as const,
  })).filter((p) => p.id > 0 && p.kind);
  const companion = typeof r.companion === 'number' && pets.some((p) => p.id === r.companion) ? r.companion : null;
  const fr = isObj(r.forage) ? r.forage : {};
  const picked = Object.fromEntries(Object.entries(isObj(fr.picked) ? fr.picked : {}).filter(([, v]) => !!v).map(([k]) => [k, true as const]));
  const wild = Object.fromEntries(Object.entries(isObj(r.wild) ? r.wild : {}).filter(([, v]) => v === 'caught' || v === 'fled')) as GameState['wild'];
  const rep = isObj(r.farmReport) && typeof r.farmReport.day === 'string' ? r.farmReport : null;
  return {
    pets,
    nextPetId: Math.max(num(r.nextPetId, 1), ...pets.map((p) => p.id + 1)),
    companion,
    forage: { dayAt: num(fr.dayAt, dayStart(now)), picked },
    wild,
    farmReport: rep ? {
      day: rep.day as string,
      pecked: Array.isArray(rep.pecked) ? rep.pecked.filter((x): x is string => typeof x === 'string') : [],
      scared: num(rep.scared, 0),
      watered: num(rep.watered, 0),
      picked: Object.fromEntries(Object.entries(isObj(rep.picked) ? rep.picked : {}).filter(([, n]) => typeof n === 'number' && n > 0)) as Record<string, number>,
    } : null,
  };
}

export const newPetState = (now: number): Pick<GameState, 'pets' | 'nextPetId' | 'companion' | 'forage' | 'wild' | 'farmReport'> =>
  ({ pets: [], nextPetId: 1, companion: null, forage: { dayAt: dayStart(now), picked: {} }, wild: {}, farmReport: null });

const SKILLS: PetSkillKind[] = ['auto_pickup', 'crow_guard', 'fishing_luck', 'water_plots', 'mine_luck'];
export function validatePets(f: GameplayFile, has: (id: string, where: string) => void): string[] {
  const errs: string[] = [];
  const P = f.pets;
  for (const it of f.items ?? []) if (it.net && !(it.net.power > 0)) errs.push(`物品 ${it.id}：net.power 要 > 0`);
  if (f.farming?.crows) {
    const c = f.farming.crows;
    if (!(c.chance >= 0 && c.chance <= 1)) errs.push('farming.crows.chance 要在 0～1');
    if (!(c.setbackHours >= 0)) errs.push('farming.crows.setbackHours 要 ≥ 0');
  }
  for (const [scene, s] of Object.entries(f.forage?.scenes ?? {})) {
    if (!(s.slots >= 0) || !(s.chance >= 0 && s.chance <= 1)) errs.push(`forage.${scene}：slots 要 ≥ 0、chance 要在 0～1`);
    for (const e of s.table) has(e.item, `forage.${scene} 的掉落`);
  }
  for (const [sid, sh] of Object.entries(f.shops ?? {})) {
    for (const t of sh.trades) if (t.dailyLimit !== undefined && !(Number.isInteger(t.dailyLimit) && t.dailyLimit >= 1)) errs.push(`商人 ${sid} 的 ${t.id}：dailyLimit 要是 ≥ 1 的整數`);
  }
  // V0.7：stats.json
  const st = f.stats;
  if (st) {
    if (!(st.lowRatio >= 0 && st.lowRatio <= 1)) errs.push('stats.json：lowRatio 要在 0～1');
    if (!(st.stamina.max > 0) || !(st.stamina.start >= 0 && st.stamina.start <= st.stamina.max)) errs.push('stats.json：stamina.max 要 > 0，start 要在 0～max');
    if (!(st.satiety.max > 0) || !(st.satiety.start >= 0 && st.satiety.start <= st.satiety.max)) errs.push('stats.json：satiety.max 要 > 0，start 要在 0～max');
    if (!(st.stamina.regenPerHour >= 0) || !(st.satiety.decayPerHour >= 0) || !(st.affection.decayPerHour >= 0)) errs.push('stats.json：每小時的恢復、流逝不能是負數');
    const we = st.satiety.whenEmpty;
    if (!(we.staminaMaxMult > 0 && we.staminaMaxMult <= 1)) errs.push('stats.json：whenEmpty.staminaMaxMult 要在 0～1（不含 0）');
    if (!(we.affectionLossPerDay >= 0)) errs.push('stats.json：whenEmpty.affectionLossPerDay 要 ≥ 0');
    for (const [k, v] of Object.entries(st.actions)) if (!(v.stamina >= 0)) errs.push(`stats.json：actions.${k}.stamina 要 ≥ 0`);
    for (const t of st.satiety.drink.tables) if (!f.fishing.tables[t]) errs.push(`stats.json：drink.tables 的「${t}」不是釣魚的水域`);
    for (const t of st.satiety.drink.taps ?? []) if (!/^[\w-]{1,40}$/.test(t)) errs.push(`stats.json：drink.taps 的「${t}」名稱不對`);
    if (!(st.satiety.drink.satiety > 0) || !(st.satiety.drink.cooldownMinutes >= 0)) errs.push('stats.json：drink.satiety 要 > 0、cooldownMinutes 要 ≥ 0');
    for (const [k, v] of Object.entries(st.lines)) if (!Array.isArray(v) || !v.length) errs.push(`stats.json：lines.${k} 至少要有一句`);
  }
  // V0.11：leisure.json
  const L = f.leisure;
  if (L) {
    const nonneg = (v: unknown) => typeof v === 'number' && v >= 0;
    if (!nonneg(L.bath?.stamina) || !nonneg(L.bath?.affection) || !nonneg(L.bath?.cooldownHours)) errs.push('leisure.json：bath 的 stamina、affection、cooldownHours 要 ≥ 0');
    const p = L.play;
    if (!p || !Object.keys(p.games ?? {}).length) errs.push('leisure.json：play.games 至少要有一台遊戲');
    else {
      for (const k of ['affectionPerHour', 'maxAffectionPerSession', 'staminaPerHour', 'levelsPerHour', 'afkMinutes'] as const) if (!nonneg(p[k])) errs.push(`leisure.json：play.${k} 要 ≥ 0`);
      if (!(p.maxHours > 0)) errs.push('leisure.json：play.maxHours 要 > 0');
      for (const [id, gm] of Object.entries(p.games)) if (!gm.name || !gm.emoji) errs.push(`leisure.json：遊戲 ${id} 要有 name 和 emoji`);
    }
    for (const k of ['bathIn', 'bathCooldown', 'playStart', 'playing', 'playEnd', 'playQuit', 'afkGo'] as const) {
      if (!Array.isArray(L.lines?.[k]) || !L.lines[k].length) errs.push(`leisure.json：lines.${k} 至少要一句`);
    }
    // V0.16：點心桌、冰箱
    for (const [id, sn] of Object.entries(L.snacks ?? {})) {
      if (!sn.name || !sn.emoji) errs.push(`leisure.json：點心桌 ${id} 要有 name 和 emoji`);
      if (!(sn.perDay > 0) || !nonneg(sn.satiety) || !nonneg(sn.affection) || (sn.stamina !== undefined && !nonneg(sn.stamina))) errs.push(`leisure.json：點心桌 ${id} 的 perDay 要 > 0，satiety、affection、stamina 要 ≥ 0`);
      if (!Array.isArray(sn.lines) || !sn.lines.length) errs.push(`leisure.json：點心桌 ${id} 的 lines 至少要一句`);
    }
    if (L.fridge) {
      const fr = L.fridge;
      if (!(fr.perDay > 0)) errs.push('leisure.json：fridge.perDay 要 > 0');
      if (!fr.finds?.length) errs.push('leisure.json：fridge.finds 至少要一樣東西');
      for (const x of fr.finds ?? []) {
        has(x.item, 'leisure.json fridge.finds');
        if (!(x.weight > 0)) errs.push(`leisure.json：fridge.finds 的 ${x.item} weight 要 > 0`);
      }
      if (!fr.lines?.found?.length || !fr.lines?.empty?.length) errs.push('leisure.json：fridge.lines 要有 found 和 empty');
    }
  }
  // V0.13：tavern.json
  const T = f.tavern;
  if (T) {
    const cf = T.coinFlip;
    if (!(cf?.cost > 0) || !(cf.reward >= 0) || !(cf.affection >= 0) || !(cf.maxAffectionPerDay >= 0)) errs.push('tavern.json：coinFlip 的 cost 要 > 0，reward、affection、maxAffectionPerDay 要 ≥ 0');
    if (!(T.cards?.friendship >= 0) || !(T.cards.maxWinsPerDay >= 0)) errs.push('tavern.json：cards 的 friendship、maxWinsPerDay 要 ≥ 0');
    for (const [k, ls] of [...Object.entries(cf?.lines ?? {}), ...Object.entries(T.cards?.lines ?? {})]) if (!Array.isArray(ls) || !ls.length) errs.push(`tavern.json：lines.${k} 至少要一句`);
    const S = T.social;
    if (!S || !(S.fromHour >= 0 && S.fromHour <= 23) || !(S.toHour >= 0 && S.toHour <= 24) || S.fromHour === S.toHour) errs.push('tavern.json：social.fromHour、toHour 要在 0～24 且不一樣');
    const seen = new Set<string>();
    for (const s of [...(T.residents ?? []), ...(S?.seats ?? [])]) {
      if (!f.npcs?.[s.npc]) errs.push(`tavern.json：居民「${s.npc}」不存在（gameplay.json 的 npcs）`);
      if (seen.has(s.npc)) errs.push(`tavern.json：「${s.npc}」排了兩個位置`);
      seen.add(s.npc);
      if (!(s.at?.x >= 0 && s.at?.y >= 0)) errs.push(`tavern.json：「${s.npc}」的 at 要有 x、y`);
    }
    for (const [npc, ts] of Object.entries(S?.talks ?? {})) {
      if (!f.npcs?.[npc]) errs.push(`tavern.json：talks 的「${npc}」不存在`);
      for (const t of ts) if (!t.her || !t.reply) errs.push(`tavern.json：talks.${npc} 每一段要有 her 和 reply`);
    }
  }
  // V0.17：diary.json
  errs.push(...validateDiary(f.diary));
  // V0.18：wishes.json、摸摸頭
  errs.push(...validateWishes(f.wishes, { items: new Map(f.items.map((i) => [i.id, i])), npcs: f.npcs ?? {} }));
  const hp = f.leisure?.headpat;
  if (hp && (!(hp.clicks >= 2) || !(hp.windowMs > 0) || !(hp.perDay >= 0) || !(hp.affection >= 0) || !hp.lines?.length)) {
    errs.push('leisure.json：headpat 要有 clicks（≥ 2）、windowMs、affection、perDay、lines');
  }
  // V0.14：furniture_shop.json
  const F = f.furniture;
  if (F) {
    if (!(F.resaleRate >= 0 && F.resaleRate <= 1)) errs.push('furniture_shop.json：resaleRate 要在 0～1');
    if (F.npc && !f.npcs?.[F.npc]) errs.push(`furniture_shop.json：居民「${F.npc}」不存在`);
    const seen = new Set<string>();
    for (const e of F.items ?? []) {
      const at = `furniture_shop.json「${e.id}」`;
      if (seen.has(e.id)) errs.push(`${at}：id 重複了`);
      seen.add(e.id);
      if (!/^[a-z0-9_]+$/.test(e.id)) errs.push(`${at}：id 只能用小寫英文、數字、底線`);
      if (!e.name || !e.emoji) errs.push(`${at}：要有 name 和 emoji`);
      if (!(Number.isInteger(e.price) && e.price > 0)) errs.push(`${at}：price 要是正整數`);
      if (!F.categories?.[e.category]) errs.push(`${at}：分類「${e.category}」不在 categories 裡`);
      if (e.size && !([e.size.w, e.size.h].every((v) => Number.isInteger(v) && v >= 1 && v <= 4))) errs.push(`${at}：size 的 w、h 要是 1～4 的整數`);
      const def = f.items.find((x) => x.id === e.id);
      if (e.category === 'floor' || e.category === 'wall') {
        if (!def?.decor) errs.push(`${at}：地板／壁紙要有 decor（換哪些圖塊）`);
      } else if (!def?.place) errs.push(`${at}：沒有擺放設定`);
    }
  }
  if (!P) return errs;
  if (!(P.maxPets >= 1)) errs.push('pets.json：maxPets 要 ≥ 1');
  if (!f.shops[P.shop]) errs.push(`pets.json：寵物店「${P.shop}」不存在`);
  if (!(P.wild.blockHours > 0 && P.wild.blockHours <= 24)) errs.push('pets.json：wild.blockHours 要在 1～24');
  if (!(P.wild.chance >= 0 && P.wild.chance <= 1)) errs.push('pets.json：wild.chance 要在 0～1');
  if (!(P.affection.max > 0)) errs.push('pets.json：affection.max 要 > 0');
  for (const [id, s] of Object.entries(P.species)) {
    if (!s.name || !s.emoji) errs.push(`寵物 ${id}：要有 name 與 emoji`);
    if (!SKILLS.includes(s.skill?.kind)) errs.push(`寵物 ${id}：skill.kind 只能是 ${SKILLS.join(' / ')}`);
    if (!s.diet?.length) errs.push(`寵物 ${id}：diet 至少要有一種食物`);
    for (const x of s.diet ?? []) if (x.item) has(x.item, `寵物 ${id} 的食物`);
    if (!(s.satietyDecay >= 0)) errs.push(`寵物 ${id}：satietyDecay 要 ≥ 0`);
    if (!(s.speed > 0)) errs.push(`寵物 ${id}：speed 要 > 0`);
    const sh = s.sprite?.sheet;
    if (sh && (!(sh.frames >= 1) || !(sh.frameWidth > 0 && sh.frameHeight > 0) || ![...sh.walk, sh.idle].every((i) => Number.isInteger(i) && i >= 0 && i < sh.frames))) {
      errs.push(`寵物 ${id}：sprite.sheet 的格子編號要在 0～frames-1`);
    }
    if (!s.shop && !s.wild) errs.push(`寵物 ${id}：shop 和 wild 至少要有一個（不然拿不到）`);
    for (const k of Object.keys(s.shop?.price ?? {})) if (k !== COIN) has(k, `寵物 ${id} 的價格`);
    if (s.wild) {
      if (!(s.wild.catchRate >= 0 && s.wild.catchRate <= 1)) errs.push(`寵物 ${id}：wild.catchRate 要在 0～1`);
      if (!(s.wild.flee >= 0 && s.wild.flee <= 1)) errs.push(`寵物 ${id}：wild.flee 要在 0～1`);
      if (!s.wild.scenes.length) errs.push(`寵物 ${id}：wild.scenes 至少要有一張地圖`);
    }
  }
  return errs;
}
