import assert from 'node:assert/strict';
import { packGameplay } from './pack-gameplay.ts';
import { test } from 'node:test';
import { applyAction, buildDefs, cropStatus, lootAvailable, mergeGameplay, newGame, rngFrom, rollLoot, seasonAt, tickGame, validateGameplay, weatherAt } from '../src/shared/gameplay.ts';
import type { GameAction, GameState } from '../src/shared/gameplay-types.ts';
import { pickLineDef } from '../src/shared/lines.ts';
import * as rules from '../src/shared/state.ts';
import type { LineDef } from '../src/shared/types.ts';

const T0 = new Date(2026, 10, 10, 13, 0).getTime(); // 下午 1 點
const MIN = 60_000;
const file = await packGameplay();
const defs = buildDefs(file);

/** 連續做幾個動作，回傳最後狀態與每一步的結果 */
function play(g: GameState, steps: [GameAction, number][]) {
  const out = [];
  for (const [a, at] of steps) {
    const r = applyAction(g, a, defs, at);
    g = r.game;
    out.push(r);
  }
  return { g, out };
}

test('內附 gameplay.json 檢查通過', () => {
  assert.deepEqual(validateGameplay(file), []);
});

test('mod：合法的追加成功、引用不存在物品的整個略過', () => {
  const good = { version: 1 as const, items: [{ id: 'fish_eel', name: '鰻魚', emoji: '🐍', category: 'fish', food: { satiety: 20, affection: 4 } }],
    fishing: { tables: { pond: [{ item: 'fish_eel', weight: 5 }] } } };
  const bad = { version: 1 as const, fishing: { tables: { pond: [{ item: 'fish_ghost', weight: 5 }] } } };
  const { file: merged, warnings } = mergeGameplay(file, [{ name: 'eel.json', data: good }, { name: 'bad.json', data: bad }]);
  assert.ok(merged.items.some((i) => i.id === 'fish_eel'));
  assert.ok(merged.fishing.tables.pond!.some((e) => e.item === 'fish_eel'));
  assert.ok(!merged.fishing.tables.pond!.some((e) => e.item === 'fish_ghost'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /bad\.json.*fish_ghost/);
});

test('rollLoot：抽中比例接近權重，河豚只在傍晚以後出現', () => {
  const rng = rngFrom(42);
  const count: Record<string, number> = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const it = rollLoot(file.fishing.tables.pond!, { phase: 'afternoon', affection: 0, season: 'spring', weather: 'sunny' }, () => rng.next())!;
    count[it] = (count[it] ?? 0) + 1;
  }
  assert.equal(count.fish_puffer, undefined);
  // 下午的總權重 = 35 + 30 + 12 + 8 + 7 = 92
  assert.ok(Math.abs(count.fish_shrimp! / N - 35 / 92) < 0.015);
  assert.ok(Math.abs(count.fish_bass! / N - 30 / 92) < 0.015);
  const night = rollLoot([{ item: 'fish_puffer', weight: 1, phases: ['night'] }], { phase: 'night', affection: 0 }, () => 0.5);
  assert.equal(night, 'fish_puffer');
});

test('釣魚：扣體力、進揹包、冷卻中不能再釣、體力不夠會失敗', () => {
  let g = newGame(T0, defs);
  const first = applyAction(g, { type: 'fish', table: 'pond' }, defs, T0);
  assert.equal(first.ok, true);
  g = first.game;
  assert.equal(g.stamina, 90);
  assert.equal(Object.values(g.stats.caught).reduce((a, b) => a + b, 0), 1); // 揹包裡還有新手竹竿和任務獎勵的蚯蚓
  assert.equal(applyAction(g, { type: 'fish', table: 'pond' }, defs, T0 + 500).ok, false);
  const many = play(g, Array.from({ length: 12 }, (_, i) => [{ type: 'fish', table: 'pond' }, T0 + (i + 1) * 2000] as [GameAction, number]));
  const errors = many.out.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.error));
  assert.ok(errors.includes('no_stamina'));
});

test('同一個存檔、同樣的動作 → 同樣的結果（亂數存在存檔裡）', () => {
  const g = newGame(T0, defs, 7);
  const a = applyAction(g, { type: 'fish', table: 'pond' }, defs, T0);
  const b = applyAction(g, { type: 'fish', table: 'pond' }, defs, T0);
  assert.deepEqual(a, b);
});

test('種菜：沒種子不能種 → 跟商人換 → 種下 → 未成熟不能收 → 3 小時後收成', () => {
  let g: GameState = { ...newGame(T0, defs), inventory: { fish_bass: 1 } };
  assert.equal(applyAction(g, { type: 'plant', plot: 'garden/plot-1', seed: 'seed_carrot' }, defs, T0).ok, false);
  const t = applyAction(g, { type: 'trade', shop: 'merchant', trade: 'bass-carrot' }, defs, T0);
  assert.ok(t.ok);
  g = t.game;
  assert.deepEqual(g.inventory, { seed_carrot: 3 });
  const p = applyAction(g, { type: 'plant', plot: 'garden/plot-1', seed: 'seed_carrot' }, defs, T0);
  assert.ok(p.ok);
  g = applyAction(p.game, { type: 'water', plot: 'garden/plot-1' }, defs, T0).game; // 澆水（剛好下雨的話本來就是濕的）
  assert.equal(applyAction(g, { type: 'plant', plot: 'garden/plot-1', seed: 'seed_carrot' }, defs, T0).ok, false);
  const early = applyAction(g, { type: 'harvest', plot: 'garden/plot-1' }, defs, T0 + 179 * MIN);
  assert.ok(!early.ok && early.error === 'not_ready');
  const h = applyAction(g, { type: 'harvest', plot: 'garden/plot-1' }, defs, T0 + 180 * MIN);
  assert.ok(h.ok && h.event.type === 'harvested');
  assert.ok((h.game.inventory.crop_carrot ?? 0) >= 1);
  assert.equal(h.game.plots['garden/plot-1'], null);
});

test('cropStatus：階段邊界剛好在 atMinutes', () => {
  const carrot = defs.crops.get('carrot')!;
  const p = { crop: 'carrot', plantedAt: T0, growthMs: 0, growthAt: T0, wateredUntil: 0 };
  // 有灑水器：全速生長
  assert.equal(cropStatus(p, carrot, T0 + 59 * MIN, defs, true).stage, 0);
  assert.equal(cropStatus(p, carrot, T0 + 60 * MIN, defs, true).stage, 1);
  assert.equal(cropStatus(p, carrot, T0 + 60 * MIN, defs, true).nextAt, T0 + 180 * MIN);
  assert.equal(cropStatus(p, carrot, T0 + 180 * MIN, defs, true).ready, true);
});

// 找一個晴天、一個雨天來測（天氣由日期決定）
const DAY = 24 * 60 * MIN;
const findDay = (want: 'sunny' | 'rainy', season?: string) => {
  for (let i = 0; i < 400; i++) {
    const t = T0 + i * DAY;
    if (weatherAt(t, defs) === want && weatherAt(t + 12 * 60 * MIN, defs) === want && (!season || seasonAt(t, defs)!.id === season)) return t;
  }
  throw new Error('找不到符合的日子');
};

test('季節：7 天一季、四季輪替；同一天的天氣固定', () => {
  const s0 = seasonAt(T0, defs)!;
  assert.equal(seasonAt(T0 + 7 * DAY, defs)!.id !== s0.id, true);
  assert.equal(seasonAt(T0 + 28 * DAY, defs)!.id, s0.id);
  assert.equal(weatherAt(T0, defs), weatherAt(T0 + 60 * MIN, defs));
  const ids = new Set(Array.from({ length: 28 }, (_, i) => seasonAt(T0 + i * DAY, defs)!.id));
  assert.equal(ids.size, 4);
});

test('澆水：沒澆水只有 1/4 速度；澆了全速；重複澆會被擋；雨天自動是濕的', () => {
  const sunny = findDay('sunny', 'autumn');
  let g: GameState = { ...newGame(sunny, defs), inventory: { seed_carrot: 2 } };
  g = applyAction(g, { type: 'plant', plot: 'a', seed: 'seed_carrot' }, defs, sunny).game;
  g = applyAction(g, { type: 'plant', plot: 'b', seed: 'seed_carrot' }, defs, sunny).game;
  const w = applyAction(g, { type: 'water', plot: 'a' }, defs, sunny);
  assert.ok(w.ok && w.event.type === 'watered');
  assert.equal(w.game.stamina, g.stamina - 2);
  const again = applyAction(w.game, { type: 'water', plot: 'a' }, defs, sunny + MIN);
  assert.ok(!again.ok && again.error === 'already_watered');
  const v = rules.toView({ ...rules.createSave(sunny, 'room', defs), game: w.game }, sunny + 180 * MIN, 0, defs).game!;
  assert.equal(v.plots.a!.ready, true); // 澆過水：3 小時成熟
  assert.equal(v.plots.b!.stage, 0); // 沒澆：才長了 45 分鐘
  assert.equal(v.plots.b!.watered, false);
  // 雨天不用澆
  const rainy = findDay('rainy');
  const p = { crop: 'carrot', plantedAt: rainy, growthMs: 0, growthAt: rainy, wateredUntil: 0 };
  const st = cropStatus(p, defs.crops.get('carrot')!, rainy + 60 * MIN, defs);
  assert.equal(st.watered, true);
  assert.equal(st.stage, 1);
});

test('灑水器：裝了之後永遠是濕的，不能重複裝', () => {
  const sunny = findDay('sunny', 'autumn');
  let g: GameState = { ...newGame(sunny, defs), inventory: { seed_carrot: 1, tool_sprinkler: 1 } };
  const s = applyAction(g, { type: 'sprinkler', plot: 'a' }, defs, sunny);
  assert.ok(s.ok && s.event.type === 'sprinkler_placed');
  assert.equal(s.game.inventory.tool_sprinkler, undefined);
  const dup = applyAction({ ...s.game, inventory: { tool_sprinkler: 1 } }, { type: 'sprinkler', plot: 'a' }, defs, sunny);
  assert.ok(!dup.ok && dup.error === 'has_sprinkler');
  g = applyAction(s.game, { type: 'plant', plot: 'a', seed: 'seed_carrot' }, defs, sunny).game;
  const h = applyAction(g, { type: 'harvest', plot: 'a' }, defs, sunny + 180 * MIN);
  assert.ok(h.ok && h.event.type === 'harvested');
  assert.equal(h.game.sprinklers.a, true); // 收成後灑水器還在
});

test('季節作物：不是當季不能播種，種子不會被扣', () => {
  const autumn = findDay('sunny', 'autumn');
  const g: GameState = { ...newGame(autumn, defs), inventory: { seed_strawberry: 1, seed_pumpkin: 1 } };
  const bad = applyAction(g, { type: 'plant', plot: 'a', seed: 'seed_strawberry' }, defs, autumn);
  assert.ok(!bad.ok && bad.error === 'wrong_season');
  assert.equal(bad.game.inventory.seed_strawberry, 1);
  assert.ok(applyAction(g, { type: 'plant', plot: 'a', seed: 'seed_pumpkin' }, defs, autumn).ok);
});

test('釣魚條件：季節魚、雨天魚只在對的時候出現；第一次釣到會標記 first', () => {
  const pond = file.fishing.tables.pond!;
  const can = (item: string, ctx: Parameters<typeof lootAvailable>[1]) => pond.some((e) => e.item === item && lootAvailable(e, ctx));
  const base = { phase: 'afternoon' as const, affection: 0 };
  assert.equal(can('fish_tropical', { ...base, season: 'summer', weather: 'sunny' }), true);
  assert.equal(can('fish_tropical', { ...base, season: 'winter', weather: 'sunny' }), false);
  assert.equal(can('fish_crab', { ...base, season: 'summer', weather: 'rainy' }), true);
  assert.equal(can('fish_crab', { ...base, season: 'summer', weather: 'sunny' }), false);
  assert.equal(can('fish_octopus', { ...base, phase: 'night', season: 'summer' }), true);
  let g = newGame(T0, defs);
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const r = applyAction(g, { type: 'fish', table: 'pond' }, defs, T0 + i * 5000);
    assert.ok(r.ok && r.event.type === 'caught');
    assert.equal(r.event.first, !seen.has(r.event.item));
    seen.add(r.event.item);
    g = r.game;
  }
  const view = rules.toView({ ...rules.createSave(T0, 'room', defs), game: g }, T0 + 60_000, 0, defs).game!;
  assert.equal(Object.values(view.caught).reduce((a, b) => a + b, 0), 6);
  assert.ok(view.season && view.weather.emoji);
});

test('舊存檔的田：之前長的時間照算，補上澆水欄位', () => {
  const save = rules.migrate({ version: 2, sceneId: 'room', createdAt: T0, lastTickAt: T0, lastSeenAt: T0, pokes: 0,
    game: { ...newGame(T0, defs), plots: { a: { crop: 'carrot', plantedAt: T0 - 200 * MIN } }, sprinklers: undefined } }, T0, 'room', defs);
  const v = rules.toView(save, T0, 0, defs).game!;
  assert.equal(v.plots.a!.ready, true);
  assert.deepEqual(v.sprinklers, []);
});

test('餵食：喜歡的好感 ×2、討厭的 0、每日上限、吃飽了不能再吃、升級事件', () => {
  // V0.19：每日上限 30 → 20、「熟悉」30 → 50
  assert.equal(file.affection.dailyCap, 20);
  let g: GameState = { ...newGame(T0, defs), satiety: 0, affection: 40, inventory: { fish_puffer: 5, crop_pepper: 1, fish_bass: 10 } };
  const liked = applyAction(g, { type: 'feed', item: 'fish_puffer' }, defs, T0);
  assert.ok(liked.ok && liked.event.type === 'fed' && liked.event.gain === 10 && liked.event.liked);
  assert.equal(liked.event.levelUp, '熟悉');
  g = liked.game;
  const pepper = applyAction(g, { type: 'feed', item: 'crop_pepper' }, defs, T0);
  assert.ok(pepper.ok && pepper.event.type === 'fed' && pepper.event.gain === 0 && pepper.event.disliked);
  g = pepper.game;
  // 再一條河豚：10 + 10 = 20 → 碰到每日上限 20
  const r3 = applyAction({ ...g, satiety: 0 }, { type: 'feed', item: 'fish_puffer' }, defs, T0);
  assert.ok(r3.ok && r3.event.type === 'fed');
  assert.equal(r3.game.affection, 60);
  const capped = applyAction({ ...r3.game, satiety: 0 }, { type: 'feed', item: 'fish_puffer' }, defs, T0);
  assert.ok(capped.ok && capped.event.type === 'fed' && capped.event.capped && capped.event.gain === 0);
  const full = applyAction({ ...r3.game, satiety: 100, stamina: 100 }, { type: 'feed', item: 'fish_bass' }, defs, T0); // 飽食、體力都滿才吃不下
  assert.ok(!full.ok && full.error === 'full');
});

test('時間流逝（V0.7 stats.json）：體力不會自己回、飽食每小時降 3、過了早上體力補滿、跨日重置每日好感', () => {
  const g = { ...newGame(T0, defs), stamina: 10, satiety: 60, affectionToday: { day: '2026-11-10', gained: 30 } };
  const later = tickGame(g, T0 + 3 * 60 * MIN, defs);
  assert.equal(later.stamina, 10);
  assert.equal(later.satiety, 51);
  assert.equal(later.affectionToday.gained, 30);
  const tomorrow = tickGame({ ...g, satiety: 100 }, new Date(2026, 10, 11, 8, 0).getTime(), defs);
  assert.equal(tomorrow.affectionToday.gained, 0);
  assert.equal(tomorrow.stamina, 100);
});

test('存檔：v1 自動升級成 v2，場景保留；不認得的物品不會被刪', () => {
  const v1 = { version: 1, sceneId: 'garden', createdAt: T0, lastTickAt: T0, lastSeenAt: T0, pokes: 3 };
  const s = rules.migrate(v1, T0, 'room', defs);
  assert.equal(s.version, 2);
  assert.equal(s.sceneId, 'garden');
  assert.equal(s.pokes, 3);
  assert.equal(s.game.stamina, 100);
  const withModItem = { ...s, game: { ...s.game, inventory: { fish_eel: 2 } } };
  assert.equal(rules.migrate(JSON.parse(JSON.stringify(withModItem)), T0, 'room', defs).game.inventory.fish_eel, 2);
  const noGame = rules.act(s, { type: 'fish', table: 'pond' }, T0);
  assert.ok(!noGame.result.ok && noGame.result.error === 'no_game');
});

test('台詞：指定物品的優先、好感夠才解鎖', () => {
  const lines: LineDef[] = [
    { text: '謝謝～', on: ['feed'] },
    { text: '魚！', on: ['feed'], categories: ['fish'] },
    { text: '河豚！', on: ['feed'], items: ['fish_puffer'] },
    { text: '普通', on: ['click'] },
    { text: '好朋友限定', on: ['click'], minAffection: 90 },
  ];
  const base = { trigger: 'feed' as const, sceneId: 'room', phase: 'afternoon' as const };
  assert.equal(pickLineDef(lines, { ...base, item: 'fish_puffer', category: 'fish' })?.text, '河豚！');
  assert.equal(pickLineDef(lines, { ...base, item: 'fish_bass', category: 'fish' })?.text, '魚！');
  assert.equal(pickLineDef(lines, { ...base, item: 'crop_carrot', category: 'crop' })?.text, '謝謝～');
  const click = { trigger: 'click' as const, sceneId: 'room', phase: 'afternoon' as const };
  for (let i = 0; i < 20; i++) assert.equal(pickLineDef(lines, { ...click, affection: 0 }, () => i / 20)?.text, '普通');
  const unlocked = new Set(Array.from({ length: 20 }, (_, i) => pickLineDef(lines, { ...click, affection: 90 }, () => i / 20)?.text));
  assert.ok(unlocked.has('好朋友限定'));
});
