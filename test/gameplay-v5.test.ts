// V0.5：引導任務、魚竿魚餌與稀有度、湖中女神、weather.json、睡覺快轉、幼崽成長與賣動物
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packGameplay } from './pack-gameplay.ts';
import {
  applyAction, buildDefs, gameView, gearOf, mergeGameplay, newGame, rareMultipliers, rollLoot, seasonAt, validateGameplay, weatherAt, weatherDef,
} from '../src/shared/gameplay.ts';
import type { GameAction, GameEvent, GameplayFile, GameState } from '../src/shared/gameplay-types.ts';
import * as rules from '../src/shared/state.ts';
import { normalizeGame, rngFrom } from '../src/shared/gameplay.ts';

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
const findDay = (pred: (t: number) => boolean) => {
  for (let i = 0; i < 400; i++) if (pred(T0 + i * DAY)) return T0 + i * DAY;
  throw new Error('找不到符合的日子');
};

test('五個 JSON 組起來檢查通過；拆檔之後 V0.4 的單檔也讀得到', () => {
  assert.deepEqual(validateGameplay(file), []);
  assert.ok(file.quests && file.weather && file.animals && file.fishing.goddess);
});

test('引導任務：照順序 釣魚 → 賣給老陳 → 跟小葵買種子 → 種下 → 睡覺 → 收成；做錯的事不算', () => {
  let g = newGame(T0, defs);
  const v0 = gameView(g, defs, T0).quest!;
  assert.equal(v0.chain, 'tutorial');
  assert.equal(v0.step, 0); // tutorial_step = 0
  assert.equal(v0.target?.scene, 'garden');
  // 賣東西不會讓「釣魚」完成
  g = { ...g, inventory: { ...g.inventory, junk_can: 1 } };
  g = must(g, { type: 'sell', item: 'junk_can', count: 1 }).g;
  assert.equal(g.quest.step, 0);
  // 0. 釣到魚（釣到垃圾不算：重試到釣到魚為止）
  let t = T0;
  while (g.quest.step === 0) {
    t += 5000;
    g = must({ ...g, stamina: 100 }, { type: 'fish', table: 'pond' }, t).g;
  }
  assert.equal(g.quest.step, 1);
  assert.equal(g.quest.last?.step, 'fish');
  assert.ok((g.inventory.bait_worm ?? 0) >= 4); // 任務獎勵 5 條蚯蚓（可能已經用掉 1 條以上）
  // 1. 賣給出貨箱不算，賣給老陳（fishmonger）才算
  const fish = Object.keys(g.inventory).find((id) => defs.items.get(id)?.category === 'fish')!;
  const box = must({ ...g, inventory: { ...g.inventory, [fish]: 2 } }, { type: 'sell', item: fish, count: 1 }, t);
  assert.equal(box.g.quest.step, 1);
  g = must(box.g, { type: 'sell', item: fish, count: 1, shop: 'fishmonger' }, t).g;
  assert.equal(g.quest.step, 2);
  assert.ok(g.inventory.coin! >= 30); // 獎勵 30 金幣
  // 老陳只收魚
  const can = applyAction({ ...g, inventory: { ...g.inventory, crop_carrot: 1 } }, { type: 'sell', item: 'crop_carrot', count: 1, shop: 'fishmonger' }, defs, t);
  assert.ok(!can.ok && can.error === 'wrong_shop');
  // 2. 跟小葵買當季種子（秋天：胡蘿蔔）；非當季的買不到
  g = { ...g, inventory: { ...g.inventory, coin: 500 } };
  assert.equal(applyAction(g, { type: 'trade', shop: 'florist', trade: 'seed-strawberry' }, defs, t).ok, false);
  g = must(g, { type: 'trade', shop: 'florist', trade: 'seed-carrot' }, t).g;
  assert.equal(g.quest.step, 3);
  // 3. 種下、澆水
  g = must(g, { type: 'plant', plot: 'garden/plot-1', seed: 'seed_carrot' }, t).g;
  assert.equal(g.quest.step, 4);
  g = applyAction(g, { type: 'water', plot: 'garden/plot-1' }, defs, t).game;
  // 4. 睡覺（快轉到隔天早上 6 點）
  const sl = must(g, { type: 'sleep' }, t);
  assert.ok(sl.e.type === 'slept');
  g = sl.g;
  assert.equal(g.quest.step, 5);
  // 5. 收成 → 整條任務線完成，換下一條
  const wake = (sl.e as Extract<GameEvent, { type: 'slept' }>).to;
  g = must(g, { type: 'harvest', plot: 'garden/plot-1' }, wake + MIN).g;
  assert.equal(g.quest.done.tutorial, true);
  assert.equal(g.quest.chain, 'town-life');
  assert.equal(g.quest.last?.chainDone, true);
});

test('引導任務：「揹包已經有」也算完成；走進地圖（enter）由 setScene 觸發', () => {
  // 進到「買種子」這一步時，揹包裡本來就有種子 → 直接跳過
  let g = newGame(T0, defs);
  g = { ...g, quest: { ...g.quest, step: 1 }, inventory: { ...g.inventory, seed_pumpkin: 1, fish_bass: 1 } };
  g = must(g, { type: 'sell', item: 'fish_bass', count: 1, shop: 'fishmonger' }).g;
  assert.equal(g.quest.step, 3);
  // 第二條任務線的「去海邊看看」
  let save = rules.createSave(T0, 'room', defs);
  save = { ...save, game: { ...save.game, quest: { chain: 'town-life', step: 1, progress: 0, done: { tutorial: true }, nagAt: 0, last: null } } };
  save = rules.setScene(save, 'garden', T0, defs);
  assert.equal(save.game.quest.step, 1);
  save = rules.setScene(save, 'beach', T0, defs);
  assert.equal(save.game.quest.step, 2);
});

test('睡覺：只能在房間；遊戲時間跳到隔天早上 6 點、體力回滿；之後的時間都照新的時間走', () => {
  let save = rules.createSave(T0, 'garden', defs);
  const no = rules.act(save, { type: 'sleep' }, T0, defs);
  assert.ok(!no.result.ok && no.result.error === 'not_here');
  save = { ...save, sceneId: 'room', game: { ...save.game, stamina: 10 } };
  const r = rules.act(save, { type: 'sleep' }, T0, defs);
  assert.ok(r.result.ok);
  const wake = new Date(2026, 10, 11, 6, 0).getTime();
  assert.equal(r.result.view.now, wake);
  assert.equal(r.result.view.phase, 'morning');
  assert.equal(r.result.view.game!.stamina, 100);
  // 現實時間過了 10 分鐘 → 遊戲時間是 6:10
  assert.equal(rules.toView(r.next, T0 + 10 * MIN, 0, defs).now, wake + 10 * MIN);
});

test('天氣：weather.json 有晴、雨、雷雨、雪（V0.19：冬天只下雪）；雷雨也算雨天；下雨天早上田自動澆好（快轉也一樣）', () => {
  assert.deepEqual(file.weather!.types.map((t) => t.id), ['sunny', 'rainy', 'storm', 'snowy']);
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const w = weatherAt(T0 + i * DAY, defs);
    seen.add(w);
    const s = seasonAt(T0 + i * DAY, defs)!.id;
    if (s === 'winter') assert.ok(w === 'sunny' || w === 'snowy', `冬天不下雨：${w}`);
    else assert.notEqual(w, 'snowy', '只有冬天下雪');
  }
  assert.deepEqual([...seen].sort(), ['rainy', 'snowy', 'storm', 'sunny']);
  assert.equal(weatherDef('storm', defs).wet, true);
  assert.ok(weatherDef('storm', defs).flash);
  // 找一個「今天晴、明天下雨」的日子，睡一覺：醒來時田已經澆好（且是因為早上下雨）
  const today = findDay((t) => weatherAt(t, defs) === 'sunny' && weatherDef(weatherAt(t + DAY, defs), defs).wet && seasonAt(t, defs)!.id === 'autumn');
  let save = rules.createSave(today, 'room', defs);
  save = { ...save, game: { ...save.game, inventory: { seed_carrot: 1 } } };
  save = rules.act(save, { type: 'plant', plot: 'garden/plot-1', seed: 'seed_carrot' }, today, defs).next;
  assert.equal(rules.toView(save, today, 0, defs).game!.plots['garden/plot-1']!.watered, false);
  const r = rules.act(save, { type: 'sleep' }, today, defs);
  assert.ok(r.result.ok && r.result.event.type === 'slept' && r.result.event.watered === 1);
  const plot = r.result.view.game!.plots['garden/plot-1']!;
  assert.equal(plot.watered, true);
  // 太陽出來了也還是濕的（早上澆的水撐到隔天早上）
  assert.ok(r.next.game.plots['garden/plot-1']!.wateredUntil >= r.result.view.now + DAY - MIN);
});

test('釣具：竹竿是新手裝備；魚餌每拋一次用掉一個、用完自動卸下；稀有度倍率相乘', () => {
  let g = newGame(T0, defs);
  assert.equal(gearOf(g, defs).rod?.id, 'rod_bamboo');
  const sunny = findDay((t) => weatherAt(t, defs) === 'sunny');
  assert.deepEqual(rareMultipliers(g, defs, sunny), { common: 1, epic: 1, legendary: 1 });
  g = { ...g, inventory: { ...g.inventory, rod_iridium: 1, bait_magic: 2 } };
  g = must(g, { type: 'set_gear', slot: 'bait', item: 'bait_magic' }, sunny).g;
  const m = rareMultipliers(g, defs, sunny);
  assert.equal(m.legendary, 1.8 * 2.5); // 銥金竿（自動挑最好的）× 魔法魚餌
  assert.equal(gameView(g, defs, sunny).fishing.waitMs, Math.round(file.fishing.durationMs * 0.7 * 0.9));
  g = must(g, { type: 'fish', table: 'pond' }, sunny).g;
  assert.equal(g.inventory.bait_magic, 1);
  g = must({ ...g, stamina: 100 }, { type: 'fish', table: 'pond', quality: 'miss' }, sunny + 5000).g; // 跑掉也會用掉魚餌
  assert.equal(g.inventory.bait_magic, undefined);
  assert.equal(g.gear.bait, null);
  // 雨天 +20%
  const rainy = findDay((t) => weatherAt(t, defs) === 'rainy');
  assert.ok(Math.abs(rareMultipliers(newGame(rainy, defs), defs, rainy).epic - 1.2) < 1e-9);
});

test('稀有度：倍率越高，傳說魚越常出現（同一組亂數比較）', () => {
  const pond = file.fishing.tables.pond!;
  const ctx = { phase: 'afternoon' as const, affection: 0, season: 'autumn', weather: 'sunny' };
  const count = (legendary: number) => {
    const rng = rngFrom(42);
    let n = 0;
    for (let i = 0; i < 4000; i++) if (rollLoot(pond, ctx, () => rng.next(), (e) => (defs.items.get(e.item)?.rarity === 'legendary' ? legendary : 1)) === 'fish_koi_king') n++;
    return n;
  };
  assert.ok(count(10) > count(1) * 4);
});

test('湖中女神：1% 機率；出現時好運持續到隔天早上 6 點，稀有倍率再乘上去', () => {
  let g = newGame(T0, defs);
  let ev: Extract<GameEvent, { type: 'caught' }> | null = null;
  let t = T0;
  for (let i = 0; i < 3000 && !ev?.goddess; i++) {
    t += 5000;
    const r = must({ ...g, stamina: 100 }, { type: 'fish', table: 'pond' }, t);
    g = r.g;
    if (r.e.type === 'caught') ev = r.e;
  }
  assert.ok(ev?.goddess, '3000 次都沒遇到女神');
  const tomorrow6 = new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate() + 1, 6).getTime();
  assert.equal(ev!.goddess!.until, tomorrow6);
  const sunny = weatherDef(weatherAt(t, defs), defs).rareBonus ?? 0;
  assert.ok(Math.abs(rareMultipliers(g, defs, t).legendary - 3 * (1 + sunny)) < 1e-9);
  assert.equal(rareMultipliers(g, defs, tomorrow6 + 1).legendary, 1 + (weatherDef(weatherAt(tomorrow6 + 1, defs), defs).rareBonus ?? 0));
});

test('女神出現的頻率大約是 1%', () => {
  let g = newGame(T0, defs, 123);
  let n = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const r = applyAction({ ...g, stamina: 100, luckUntil: 0 }, { type: 'fish', table: 'pond' }, defs, T0 + i * 5000);
    if (r.ok && r.event.type === 'caught' && r.event.goddess) n++;
    g = r.game;
  }
  assert.ok(n > N * 0.004 && n < N * 0.02, `出現 ${n} 次`);
});

test('動物：買幼崽 → 長大才產出；可以賣給商人，長大、好感高比較值錢', () => {
  let g: GameState = { ...newGame(T0, defs), inventory: { coin: 10000, hay: 10 } };
  g = must(g, { type: 'unlock', id: 'coop' }).g;
  g = must(g, { type: 'buy_animal', kind: 'chicken' }).g;
  const a = g.animals[0]!;
  assert.equal(a.name, '小雞1');
  const v = gameView(g, defs, T0).animals[0]!;
  assert.equal(v.adult, false);
  assert.equal(v.sellPrice, 150);
  // 一天之內不會產蛋（就算吃飽）
  g = must(g, { type: 'feed_animals', building: 'coop' }).g;
  assert.equal(applyAction(g, { type: 'collect_animals', building: 'coop' }, defs, T0 + 23 * HOUR).ok, false);
  const grown = gameView(g, defs, T0 + DAY).animals[0]!;
  assert.equal(grown.adult, true);
  assert.equal(grown.sellPrice, 450);
  const sold = must(g, { type: 'sell_animal', animal: a.id }, T0 + DAY);
  assert.ok(sold.e.type === 'animal_sold' && sold.e.coins === 450);
  assert.equal(sold.g.animals.length, 0);
});

test('mod：可以加任務線和天氣', () => {
  const { file: merged, warnings } = mergeGameplay(file, [{ name: 'q.json', data: {
    version: 1,
    questChains: [{ id: 'extra', name: '額外', requires: 'tutorial', steps: [{ id: 'a', task: '餵她', say: ['肚子餓了'], done: { event: 'fed' } }] }],
    weatherTypes: [{ id: 'snow', name: '下雪', emoji: '❄️', wet: false, particles: { count: 50, speed: 40, length: 1, slant: 10, color: '#fff' } }],
    weatherSeasons: { winter: { sunny: 5, snow: 5 } },
  } }]);
  assert.deepEqual(warnings, []);
  assert.ok(merged.quests!.chains.some((c) => c.id === 'extra'));
  const d2 = buildDefs(merged);
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const t = T0 + i * DAY;
    if (seasonAt(t, d2)!.id === 'winter') seen.add(weatherAt(t, d2));
  }
  assert.ok(seen.has('snow'));
});

test('V0.4 舊存檔：動物當成已經長大、任務從新手引導開始、沒有好運', () => {
  const old = { ...newGame(T0, defs, 7), animals: [{ id: 1, kind: 'chicken', name: '雞1', building: 'coop', fedUntil: T0, mood: 80, friendship: 0, lastPetDay: '', readyAt: T0 + HOUR, pending: null }] } as Record<string, unknown>;
  delete old.quest; delete old.luckUntil; delete old.gear; delete old.clockOffset;
  const g = normalizeGame(old, T0, defs);
  assert.equal(g.animals[0]!.bornAt, 0);
  assert.equal(gameView(g, defs, T0).animals[0]!.adult, true);
  assert.equal(g.quest.chain, 'tutorial');
  assert.equal(g.quest.step, 0);
  assert.equal(g.luckUntil, 0);
  assert.equal(g.clockOffset, 0);
});

test('檢查：天氣權重、釣具倍率、任務條件寫錯會被擋下', () => {
  const bad = structuredClone(file);
  bad.weather!.default = { ...bad.weather!.default, rainy: -1 };
  bad.items = bad.items.map((i) => (i.id === 'bait_magic' ? { ...i, gear: { kind: 'bait' as const, bite: 1, rare: { legendary: 0 } } } : i));
  bad.quests!.chains[0]!.steps[0]!.done = {};
  const errs = validateGameplay(bad);
  assert.ok(errs.some((e) => e.includes('權重')), errs.join('\n'));
  assert.ok(errs.some((e) => e.includes('gear.rare')));
  assert.ok(errs.some((e) => e.includes('done 要有')));
});
