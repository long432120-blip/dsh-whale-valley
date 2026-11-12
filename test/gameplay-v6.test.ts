// V0.6：寵物系統（商店、野外捕捉、飽食度與好感、被動技能）、地上的掉落物、烏鴉
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packGameplay } from './pack-gameplay.ts';
import {
  applyAction, buildDefs, gameView, mergeGameplay, newGame, normalizeGame, rareMultipliers, simulateMine, tickGame, validateGameplay, weatherAt, weatherDef,
} from '../src/shared/gameplay.ts';
import { forageFor, forageLeft, wildAt, catchChance } from '../src/shared/pets.ts';
import type { GameAction, GameEvent, GameplayFile, GameState } from '../src/shared/gameplay-types.ts';
import * as rules from '../src/shared/state.ts';
import { dayStart } from '../src/shared/time.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = new Date(2026, 10, 10, 14, 0).getTime(); // 秋天、下午 2 點
const file: GameplayFile = await packGameplay();
const defs = buildDefs(file);

function must(g: GameState, a: GameAction, at = T0): { g: GameState; e: GameEvent } {
  const r = applyAction(g, a, defs, at);
  assert.ok(r.ok, `${a.type} 失敗：${!r.ok ? r.error : ''}`);
  return { g: r.game, e: r.event };
}
const err = (g: GameState, a: GameAction, at = T0) => {
  const r = applyAction(g, a, defs, at);
  return r.ok ? null : r.error;
};
const withPet = (g: GameState, kind: string, extra: Partial<GameState['pets'][number]> = {}): GameState => ({
  ...g,
  pets: [...g.pets, { id: g.nextPetId, kind, name: kind, affection: 0, satiety: 100, lastPetDay: '', obtainedAt: T0, how: 'shop', ...extra }],
  nextPetId: g.nextPetId + 1,
});

test('pets.json 讀得到、檢查通過：五種寵物（兩種商店、三種野外）、兩種捕捉網', () => {
  assert.deepEqual(validateGameplay(file), []);
  const sp = file.pets!.species;
  assert.deepEqual(Object.keys(sp).sort(), ['cat', 'dog', 'fairy', 'jellyfish', 'mole']);
  assert.deepEqual(Object.keys(sp).filter((k) => sp[k]!.shop).sort(), ['cat', 'dog']);
  assert.ok(defs.items.get('net_basic')?.net && defs.items.get('net_silk')!.net!.power > 1);
  assert.equal(file.npcs!.florist!.shops?.includes('petshop'), true);
});

test('商店買寵物：扣錢、取名不重複、最多 maxPets 隻；野生的買不到', () => {
  let g: GameState = { ...newGame(T0, defs, 1), inventory: { coin: 5000 } };
  assert.equal(err(g, { type: 'buy_pet', kind: 'jellyfish' }), 'not_for_sale');
  const r = must(g, { type: 'buy_pet', kind: 'dog' });
  g = r.g;
  assert.equal(g.inventory.coin, 4200);
  assert.ok(r.e.type === 'pet_bought' && r.e.name === '柴犬');
  g = must(g, { type: 'buy_pet', kind: 'dog' }).g;
  assert.deepEqual(g.pets.map((p) => p.name), ['柴犬', '柴犬2']);
  assert.equal(err({ ...g, inventory: { coin: 10 } }, { type: 'buy_pet', kind: 'cat' }), 'no_item');
  for (let i = 0; i < 4; i++) g = must(g, { type: 'buy_pet', kind: 'cat', name: `咪${i}` }).g;
  assert.equal(g.pets.length, 6);
  assert.equal(err({ ...g, inventory: { coin: 9999 } }, { type: 'buy_pet', kind: 'cat' }), 'too_many_pets');
});

test('飽食度與好感：餵牠吃的東西才算、吃飽了不吃；每天摸一次；會隨時間變餓，餓了技能就停', () => {
  let g = withPet(newGame(T0, defs, 2), 'dog', { satiety: 30 });
  g = { ...g, inventory: { pet_food: 3, crop_carrot: 1, fish_bass: 1 } };
  assert.equal(err(g, { type: 'feed_pet', pet: 1, item: 'crop_carrot' }), 'not_food');
  let r = must(g, { type: 'feed_pet', pet: 1, item: 'pet_food' });
  assert.ok(r.e.type === 'pet_fed' && r.e.satiety === 90 && r.e.affection === 5);
  g = must(r.g, { type: 'feed_pet', pet: 1, item: 'fish_bass' }).g;
  assert.equal(err(g, { type: 'feed_pet', pet: 1, item: 'pet_food' }), 'not_hungry');
  r = must(g, { type: 'pet_pet', pet: 1 });
  assert.ok(r.e.type === 'pet_petted' && r.e.affection === 25);
  assert.equal(err(r.g, { type: 'pet_pet', pet: 1 }), 'already');
  assert.equal(must(r.g, { type: 'pet_pet', pet: 1 }, T0 + DAY).e.type, 'pet_petted');
  // 柴犬每小時 -4：100 → 25 小時後餓了
  const v1 = gameView(tickGame(g, T0 + 10 * HOUR, defs), defs, T0 + 10 * HOUR).pets[0]!;
  assert.equal(v1.satiety, 60);
  assert.equal(v1.skillActive, true);
  const v2 = gameView(tickGame(g, T0 + 30 * HOUR, defs), defs, T0 + 30 * HOUR).pets[0]!;
  assert.equal(v2.hungry, true);
  assert.equal(v2.skillActive, false);
});

test('跟班：指定一隻跟著走；放生時跟班也取消', () => {
  let g = withPet(withPet(newGame(T0, defs, 3), 'dog'), 'cat');
  g = must(g, { type: 'set_companion', pet: 2 }).g;
  assert.equal(gameView(g, defs, T0).companion, 2);
  assert.equal(err(g, { type: 'set_companion', pet: 99 }), 'unknown');
  g = must(g, { type: 'release_pet', pet: 2 }).g;
  assert.equal(g.companion, null);
  assert.deepEqual(g.pets.map((p) => p.kind), ['dog']);
});

/** 找一個「這張地圖有這種野生寵物」的時間 */
function findWild(scene: string, kind: string, g: GameState) {
  for (let i = 0; i < 24 * 120; i++) {
    const t = T0 + i * HOUR;
    const w = wildAt(scene, t, g, defs);
    if (w?.kind === kind) return { t, w };
  }
  throw new Error(`找不到 ${kind}`);
}

test('野生寵物：看天氣、時段、地點出現；同一段時間結果固定；水母只在下雨的海邊', () => {
  const g = newGame(T0, defs, 4);
  const { t, w } = findWild('beach', 'jellyfish', g);
  assert.ok(weatherDef(weatherAt(t, defs), defs).wet, '水母只在雨天');
  assert.deepEqual(wildAt('beach', t + 10 * MIN, g, defs), w);
  assert.ok(w.until > t && w.until - t <= 2 * HOUR);
  const fairy = findWild('garden', 'fairy', g);
  assert.ok(new Date(fairy.t).getHours() >= 17 || new Date(fairy.t).getHours() < 5, '小精靈只在傍晚、晚上');
  const mole = findWild('town', 'mole', g);
  const h = new Date(mole.t).getHours();
  assert.ok(h >= 5 && h < 17, '鼴鼠只在白天');
  // 地圖不對就不會出現
  for (let i = 0; i < 200; i++) assert.notEqual(wildAt('room', T0 + i * HOUR, g, defs)?.kind, 'jellyfish');
  // 雨天加成：海邊雨天出現的比例 = chance × 1.5
  let rain = 0, hit = 0;
  for (let i = 0; i < 24 * 400; i += 2) {
    const tt = T0 + i * HOUR;
    if (!['rainy', 'storm'].includes(weatherAt(tt, defs))) continue; // V0.19：雪天不算下雨
    rain++;
    if (wildAt('beach', tt, g, defs)) hit++;
  }
  assert.ok(Math.abs(hit / rain - 0.6) < 0.08, `雨天海邊出現率 ${hit / rain}`);
});

test('捕捉：網子一定用掉；成功率 = 捕捉率 × 網子；抓到就收進來，抓不到可能跑掉；要在同一張地圖', () => {
  let g = newGame(T0, defs, 5);
  const { t, w } = findWild('beach', 'jellyfish', g);
  assert.equal(catchChance('jellyfish', 'net_basic', defs), 0.35);
  assert.equal(catchChance('jellyfish', 'net_silk', defs), 0.63);
  g = { ...g, inventory: { net_basic: 30 } };
  assert.equal(err(g, { type: 'catch_pet', scene: 'beach', spawn: 'nope', net: 'net_basic' }, t), 'gone');
  assert.equal(err({ ...g, inventory: {} }, { type: 'catch_pet', scene: 'beach', spawn: w.id, net: 'net_basic' }, t), 'no_item');
  // 一直丟到抓到或跑掉
  let tries = 0;
  let last: GameEvent | null = null;
  while (tries < 30) {
    const r = applyAction(g, { type: 'catch_pet', scene: 'beach', spawn: w.id, net: 'net_basic' }, defs, t + tries * 1000);
    if (!r.ok) break;
    tries++;
    g = r.game;
    last = r.event;
    if (r.event.type === 'pet_caught' || (r.event.type === 'pet_escaped' && r.event.fled)) break;
  }
  assert.equal(g.inventory.net_basic, 30 - tries);
  assert.ok(last);
  assert.equal(wildAt('beach', t, g, defs), null, '抓到或跑掉之後這段時間不會再出現');
  if (last.type === 'pet_caught') assert.equal(g.pets[0]!.how, 'wild');
  // 不在同一張地圖不能抓
  let save = rules.createSave(t, 'garden', defs);
  save = { ...save, game: { ...save.game, inventory: { net_basic: 1 } } };
  const nh = rules.act(save, { type: 'catch_pet', scene: 'beach', spawn: w.id, net: 'net_basic' }, t, defs);
  assert.ok(!nh.result.ok && nh.result.error === 'not_here');
  // 統計：成功率接近 35%
  let ok = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const r = applyAction({ ...newGame(T0, defs, 1000 + i), inventory: { net_basic: 1 } }, { type: 'catch_pet', scene: 'beach', spawn: w.id, net: 'net_basic' }, defs, t);
    if (r.ok && r.event.type === 'pet_caught') ok++;
  }
  assert.ok(Math.abs(ok / N - 0.35) < 0.03, `成功率 ${ok / N}`);
});

test('掉落物：每天固定、撿了就沒了；狗撿要真的有狗而且沒餓；畫面關著的日子狗會撿回昨天剩下的', () => {
  let g = newGame(T0, defs, 6);
  const spots = forageLeft(g, defs, T0);
  assert.ok(spots.length > 0);
  assert.deepEqual(forageFor(dayStart(T0), defs), spots);
  const s = spots[0]!;
  assert.equal(err(g, { type: 'forage', scene: s.scene, slot: s.slot, by: 1 }), 'unknown');
  const r = must(g, { type: 'forage', scene: s.scene, slot: s.slot });
  assert.equal(r.g.inventory[s.item], 1);
  assert.equal(err(r.g, { type: 'forage', scene: s.scene, slot: s.slot }), 'gone');
  g = withPet(r.g, 'dog');
  const s2 = forageLeft(g, defs, T0)[0]!;
  const r2 = must(g, { type: 'forage', scene: s2.scene, slot: s2.slot, by: 1 });
  assert.ok(r2.e.type === 'foraged' && r2.e.by === 1);
  assert.equal(err(withPet(newGame(T0, defs, 6), 'dog', { satiety: 0 }), { type: 'forage', scene: s2.scene, slot: s2.slot, by: 1 }), 'unknown');
  // 隔天：狗撿回昨天剩下的（最多 3 個；好感 0 → 3 個）
  const left = forageLeft(r2.g, defs, T0).length;
  const next = tickGame(r2.g, T0 + DAY, defs);
  const got = Object.values(next.farmReport!.picked).reduce((a, b) => a + b, 0);
  assert.equal(got, Math.min(3, left));
  assert.equal(next.forage.dayAt, dayStart(T0 + DAY));
  // 沒有狗就不會
  const none = tickGame(r.g, T0 + DAY, defs);
  assert.equal(Object.keys(none.farmReport?.picked ?? {}).length, 0);
});

/** 在花園種 n 塊胡蘿蔔 */
function farm(seed: number, n: number): GameState {
  let g: GameState = { ...newGame(T0, defs, seed), inventory: { seed_carrot: n }, stamina: 100 };
  for (let i = 1; i <= n; i++) g = must(g, { type: 'plant', plot: `garden/p${i}`, seed: 'seed_carrot' }).g;
  return g;
}

test('烏鴉：戶外種夠多才來，會讓作物倒退；橘貓趕走大部分', () => {
  // 種太少：不會來
  let few = farm(7, 3);
  few = tickGame(few, T0 + 6 * DAY, defs);
  assert.equal(few.farmReport?.pecked.length ?? 0, 0);
  // 種很多、跑很多天：沒有貓 vs 有貓
  let pecked = 0, peckedCat = 0, scared = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let a = farm(seed, 10);
    let b = withPet(farm(seed, 10), 'cat');
    for (let day = 1; day <= 3; day++) {
      a = tickGame(a, T0 + day * DAY - 7 * HOUR, defs);
      b = tickGame(b, T0 + day * DAY - 7 * HOUR, defs);
      pecked += a.farmReport?.pecked.length ?? 0;
      peckedCat += b.farmReport?.pecked.length ?? 0;
      scared += b.farmReport?.scared ?? 0;
      a = { ...a, farmReport: null };
      b = { ...b, farmReport: null, pets: b.pets.map((p) => ({ ...p, satiety: 100 })) };
    }
  }
  assert.ok(pecked > 20, `沒貓被啄 ${pecked}`);
  assert.ok(peckedCat < pecked * 0.45, `有貓被啄 ${peckedCat} / 沒貓 ${pecked}`);
  assert.ok(scared > 0);
});

test('小精靈：每天早上幫忙澆還乾著的田', () => {
  // 找一個晴天，清晨 5 點種 3 塊，6 點起床時小精靈澆 2 塊
  let day = dayStart(T0);
  while (weatherDef(weatherAt(day + 12 * HOUR, defs), defs).wet) day += DAY;
  const at = day + 5 * HOUR;
  let g: GameState = withPet({ ...newGame(at, defs, 8), inventory: { seed_carrot: 3 }, stamina: 100 }, 'fairy');
  for (let i = 1; i <= 3; i++) g = must(g, { type: 'plant', plot: `garden/p${i}`, seed: 'seed_carrot' }, at).g;
  const next = tickGame(g, at + 2 * HOUR, defs);
  assert.equal(next.farmReport!.watered, 2);
  assert.equal(Object.values(next.plots).filter((p) => p && p.wateredUntil > at + 2 * HOUR).length, 2);
  assert.equal(gameView(next, defs, at + 2 * HOUR).farmReport!.watered, 2);
});

test('水母：釣魚稀有倍率；鼴鼠：礦洞稀有倍率；好感越高越強', () => {
  const base = newGame(T0, defs, 9);
  const b = rareMultipliers(base, defs, T0);
  const j = rareMultipliers(withPet(base, 'jellyfish'), defs, T0);
  assert.ok(Math.abs(j.legendary / b.legendary - 1.4) < 1e-9);
  const j2 = rareMultipliers(withPet(base, 'jellyfish', { affection: 1000 }), defs, T0);
  assert.ok(Math.abs(j2.legendary / b.legendary - 1.6) < 1e-9, '好感滿：1 + 0.4 × 1.5');
  const hungry = rareMultipliers(withPet(base, 'jellyfish', { satiety: 0 }), defs, T0);
  assert.equal(hungry.legendary, b.legendary);
  // 礦洞：同一組亂數，有鼴鼠時寶石變多（統計）
  let gems = 0, gemsMole = 0;
  const g0: GameState = { ...base, inventory: { pickaxe_gold: 1, sword_crystal: 1, armor_crystal: 1 } };
  for (let i = 0; i < 300; i++) {
    const mk = () => {
      let s = 1000 + i;
      return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    };
    const count = (r: ReturnType<typeof simulateMine>) => Object.entries(r.items).filter(([id]) => id.startsWith('gem_')).reduce((n, [, v]) => n + v, 0);
    gems += count(simulateMine(g0, defs, 15, mk()));
    gemsMole += count(simulateMine(withPet(g0, 'mole', { affection: 1000 }), defs, 15, mk()));
  }
  assert.ok(gemsMole > gems, `寶石：有鼴鼠 ${gemsMole}、沒有 ${gems}`);
});

test('mod 可以加寵物；寫錯會被擋', () => {
  const { file: merged, warnings } = mergeGameplay(file, [{ name: 'frog.json', data: {
    version: 1,
    petSpecies: { frog: { name: '青蛙', emoji: '🐸', wild: { scenes: ['garden'], weather: ['rainy'], weight: 5, catchRate: 0.5, flee: 0.2 },
      diet: [{ category: 'fish', satiety: 20 }], satietyDecay: 2, speed: 2, skill: { kind: 'crow_guard', name: '吃蟲', description: '', crowMult: 0.6 } } },
  } }]);
  assert.deepEqual(warnings, []);
  assert.ok(merged.pets!.species.frog);
  const bad = mergeGameplay(file, [{ name: 'bad.json', data: { version: 1, petSpecies: { x: { name: 'x', emoji: 'x', diet: [], satietyDecay: 1, speed: 1, skill: { kind: 'fly' as never, name: '', description: '' } } } } }]);
  assert.equal(bad.warnings.length, 1);
  assert.ok(bad.warnings[0]!.includes('skill.kind'));
});

test('V0.5 舊存檔：沒有寵物欄位也讀得進來', () => {
  const old = { ...newGame(T0, defs, 10) } as Record<string, unknown>;
  for (const k of ['pets', 'nextPetId', 'companion', 'forage', 'wild', 'farmReport']) delete old[k];
  const g = normalizeGame(old, T0, defs);
  assert.deepEqual(g.pets, []);
  assert.equal(g.companion, null);
  assert.equal(g.forage.dayAt, dayStart(T0));
  const v = gameView(g, defs, T0);
  assert.deepEqual(v.pets, []);
  assert.ok(Array.isArray(v.wild) && Array.isArray(v.forage));
});

test('V0.6.2 每天限量：換完回 sold_out，隔天恢復；畫面拿得到今天的次數', () => {
  let g: GameState = { ...newGame(T0, defs, 11), inventory: { coin: 99999 } };
  const t = file.shops.fisher!.trades.find((x) => x.id === 'shell')!;
  assert.equal(t.dailyLimit, 1);
  g = must(g, { type: 'trade', shop: 'fisher', trade: 'shell' }).g;
  assert.equal(gameView(g, defs, T0).shopToday['fisher:shell'], 1);
  assert.equal(err(g, { type: 'trade', shop: 'fisher', trade: 'shell' }), 'sold_out');
  assert.equal(must(g, { type: 'trade', shop: 'fisher', trade: 'shell' }, T0 + DAY).e.type, 'traded');
  assert.deepEqual(gameView(g, defs, T0 + DAY).shopToday, {});
  // 沒有限量的照常
  for (let i = 0; i < 5; i++) g = must(g, { type: 'trade', shop: 'fisher', trade: 'worm' }).g;
});
