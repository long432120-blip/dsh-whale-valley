// V0.7：數值狀態系統（stats.json）：體力、飽食／水分、好感的消耗與恢復
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packGameplay } from './pack-gameplay.ts';
import { applyAction, buildDefs, gameView, newGame, normalizeGame, staminaCap, tickGame, validateGameplay, weatherAt, weatherDef } from '../src/shared/gameplay.ts';
import type { GameAction, GameplayFile, GameState } from '../src/shared/gameplay-types.ts';
import * as rules from '../src/shared/state.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date(2026, 10, 10, 14, 0).getTime(); // 下午 2 點
const file: GameplayFile = await packGameplay();
const defs = buildDefs(file);
const st = file.stats!;

const must = (g: GameState, a: GameAction, at = T0) => {
  const r = applyAction(g, a, defs, at);
  assert.ok(r.ok, `${a.type} 失敗：${!r.ok ? r.error : ''}`);
  return r;
};
const err = (g: GameState, a: GameAction, at = T0) => {
  const r = applyAction(g, a, defs, at);
  return r.ok ? null : r.error;
};

test('stats.json 是數值來源：初始值、上限、動作消耗都寫回規則用的欄位', () => {
  assert.deepEqual(validateGameplay(file), []);
  assert.equal(file.stamina.max, st.stamina.max);
  assert.equal(file.satiety.decayPerHour, st.satiety.decayPerHour);
  assert.equal(file.fishing.staminaCost, 10);
  assert.equal(file.farming!.waterStaminaCost, 2);
  assert.ok(file.crops.every((c) => c.staminaCost === 2));
  const g = newGame(T0, defs, 1);
  assert.equal(g.stamina, st.stamina.start);
  assert.equal(g.satiety, st.satiety.start);
  assert.deepEqual(gameView(g, defs, T0).stats.costs, { fish: 10, plant: 2, water: 2, mine: 30 });
});

test('體力：釣魚 -10、種田 -2、澆水 -2；歸零後這些動作都被拒絕', () => {
  let t = T0; // 找一個晴天（下雨天田本來就是濕的，不用澆）
  while (weatherDef(weatherAt(t, defs), defs).wet) t += 24 * HOUR;
  let g: GameState = { ...newGame(t, defs, 2), inventory: { seed_carrot: 5 } };
  g = must(g, { type: 'fish', table: 'pond' }, t).game;
  assert.equal(g.stamina, 90);
  g = must(g, { type: 'plant', plot: 'garden/p1', seed: 'seed_carrot' }, t).game;
  assert.equal(g.stamina, 88);
  g = must(g, { type: 'water', plot: 'garden/p1' }, t).game;
  assert.equal(g.stamina, 86);
  const tired = { ...g, stamina: 1 };
  assert.equal(err(tired, { type: 'fish', table: 'pond' }, t + HOUR), 'no_stamina');
  assert.equal(err(tired, { type: 'plant', plot: 'garden/p2', seed: 'seed_carrot' }, t), 'no_stamina');
  const dry = { ...tired, plots: { ...tired.plots, 'garden/p1': { ...tired.plots['garden/p1']!, wateredUntil: 0 } } };
  assert.equal(err(dry, { type: 'water', plot: 'garden/p1' }, t), 'no_stamina');
  // 過 3 小時也不會自己回（regenPerHour = 0）
  assert.equal(tickGame(tired, t + 3 * HOUR, defs).stamina, 1);
});

test('體力恢復：睡覺補滿；吃東西恢復飽食度和體力（體力 = 飽食度的一半，物品可以自己寫）', () => {
  let g: GameState = { ...newGame(T0, defs, 3), stamina: 5, satiety: 50, inventory: { fish_bass: 2 } };
  const bass = defs.items.get('fish_bass')!.food!;
  const r = must(g, { type: 'feed', item: 'fish_bass' });
  assert.ok(r.event.type === 'fed');
  assert.equal(r.game.satiety, 50 + bass.satiety);
  assert.equal(r.game.stamina, 5 + Math.round(bass.satiety * 0.5));
  assert.equal(r.event.type === 'fed' && r.event.stamina, Math.round(bass.satiety * 0.5));
  // 飽食度滿了，但體力還沒滿：還是可以吃（補體力）
  g = { ...r.game, satiety: 100, stamina: 20 };
  assert.equal(must(g, { type: 'feed', item: 'fish_bass' }).game.stamina, 20 + Math.round(bass.satiety * 0.5));
  // 兩個都滿：吃不下
  assert.equal(err({ ...g, stamina: 100, inventory: { fish_bass: 1 } }, { type: 'feed', item: 'fish_bass' }), 'full');
  // 睡覺：補滿
  const slept = must({ ...g, stamina: 0 }, { type: 'sleep' });
  assert.equal(slept.game.stamina, 100);
});

test('飽食度：每小時 -3（V0.18 從 4 調成 3）；睡覺那段時間只掉一半；歸零時體力上限減半', () => {
  const g: GameState = { ...newGame(T0, defs, 4), satiety: 80, stamina: 100 };
  assert.equal(file.stats!.satiety.decayPerHour, 3);
  assert.equal(tickGame(g, T0 + 5 * HOUR, defs).satiety, 65);
  // 下午 2 點睡到隔天 6 點 = 16 小時 × 3 × 0.5 = 24
  const slept = must(g, { type: 'sleep' });
  assert.equal(slept.game.satiety, 56);
  // 歸零：上限 50，體力被壓到 50；睡覺也只能補到 50
  const starving = tickGame({ ...g, satiety: 4 }, T0 + 2 * HOUR, defs);
  assert.equal(starving.satiety, 0);
  assert.equal(staminaCap(0, defs), 50);
  assert.equal(starving.stamina, 50);
  const v = gameView(starving, defs, T0 + 2 * HOUR);
  assert.equal(v.staminaMax, 50);
  assert.equal(v.stats.starving, true);
  assert.equal(v.stats.staminaBase, 100);
  assert.equal(must(starving, { type: 'sleep' }, T0 + 2 * HOUR).game.stamina, 50);
  // 吃東西之後上限恢復，體力可以超過 50
  const fed = must({ ...starving, inventory: { fish_bass: 1 } }, { type: 'feed', item: 'fish_bass' }, T0 + 2 * HOUR);
  assert.equal(gameView(fed.game, defs, T0 + 2 * HOUR).staminaMax, 100);
  assert.ok(fed.game.stamina > 50);
});

test('餓著過夜：每過一個早上好感 -5（不會低於 0）；沒餓就不扣', () => {
  const base: GameState = { ...newGame(T0, defs, 5), affection: 40 };
  const hungry = tickGame({ ...base, satiety: 0 }, T0 + 24 * HOUR, defs); // 經過 1 個早上
  assert.equal(hungry.affection, 35);
  const three = tickGame({ ...base, satiety: 0 }, T0 + 72 * HOUR, defs);
  assert.equal(three.affection, 25);
  // 飽食度夠撐過早上：不扣
  const ok = tickGame({ ...base, satiety: 100 }, T0 + 17 * HOUR, defs); // 隔天早上 7 點：100 - 68 = 32
  assert.equal(ok.affection, 40);
  assert.equal(tickGame({ ...base, satiety: 0, affection: 3 }, T0 + 24 * HOUR, defs).affection, 0);
});

test('喝水：只能在池塘、河邊；一次 +20；10 分鐘冷卻；滿了不用喝', () => {
  let g: GameState = { ...newGame(T0, defs, 6), satiety: 30 };
  assert.equal(err(g, { type: 'drink', table: 'sea' }), 'unknown'); // 海水不能喝
  const r = must(g, { type: 'drink', table: 'pond' });
  assert.ok(r.event.type === 'drank' && r.event.satiety === 20);
  g = r.game;
  assert.equal(g.satiety, 50);
  assert.equal(err(g, { type: 'drink', table: 'pond' }, T0 + 5 * MIN), 'cooldown');
  assert.equal(must(g, { type: 'drink', table: 'pond' }, T0 + 11 * MIN).event.type, 'drank');
  assert.equal(err({ ...newGame(T0, defs, 6), satiety: 100 }, { type: 'drink', table: 'pond' }), 'full');
  assert.ok(gameView(g, defs, T0).stats.drinkReadyAt > T0);
});

test('低於 30%：畫面拿得到 low 旗標', () => {
  const g = newGame(T0, defs, 7);
  assert.deepEqual(gameView(g, defs, T0).stats.low, { stamina: false, satiety: false });
  assert.deepEqual(gameView({ ...g, stamina: 29, satiety: 29 }, defs, T0).stats.low, { stamina: true, satiety: true });
  assert.deepEqual(gameView({ ...g, stamina: 30, satiety: 30 }, defs, T0).stats.low, { stamina: false, satiety: false });
});

test('demo 的快轉（時間往前跳）：飽食度照樣流逝、過了早上體力補滿', () => {
  let save = rules.createSave(T0, 'room', defs);
  save = { ...save, game: { ...save.game, stamina: 12, satiety: 80 } };
  const three = rules.tick(save, T0 + 3 * HOUR, defs);
  assert.equal(three.game.satiety, 71);
  assert.equal(three.game.stamina, 12);
  const day = rules.tick(save, T0 + 30 * HOUR, defs);
  assert.equal(day.game.satiety, 0);
  assert.equal(day.game.stamina, 50); // 過了早上補滿，但餓著 → 上限減半
});

test('舊存檔沒有 lastDrinkAt 也讀得進來；stats.json 寫錯會被擋', () => {
  const old = { ...newGame(T0, defs, 8) } as Record<string, unknown>;
  delete old.lastDrinkAt;
  assert.equal(normalizeGame(old, T0, defs).lastDrinkAt, 0);
  const bad = structuredClone(file);
  bad.stats!.satiety.whenEmpty.staminaMaxMult = 0;
  bad.stats!.satiety.drink.tables = ['lava'];
  bad.stats!.lines.tired = [];
  const errs = validateGameplay(bad);
  assert.ok(errs.some((e) => e.includes('staminaMaxMult')));
  assert.ok(errs.some((e) => e.includes('lava')));
  assert.ok(errs.some((e) => e.includes('lines.tired')));
});
