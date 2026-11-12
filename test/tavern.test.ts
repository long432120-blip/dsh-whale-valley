// V0.13：酒館（tavern.json）：街機猜硬幣、牌桌比大小、社交時間（晚上 NPC 去酒館）
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { packGameplay, PACK_DIR } from './pack-gameplay.ts';
import { applyAction, buildDefs, gameView, isSocialHour, newGame, normalizeGame, tavernNpcs, validateGameplay } from '../src/shared/gameplay.ts';
import { COIN, type GameAction, type GameplayFile, type GameState } from '../src/shared/gameplay-types.ts';
import { buildBackgroundMap, type InteractablesFile } from '../src/shared/hotspots.ts';
import { distances } from '../src/shared/path.ts';

const AFTERNOON = new Date(2026, 10, 10, 14, 0).getTime();
const NIGHT = new Date(2026, 10, 10, 21, 0).getTime();
const file: GameplayFile = await packGameplay();
const defs = buildDefs(file);
const T = file.tavern!;

const run = (g: GameState, a: GameAction, at = AFTERNOON) => applyAction(g, a, defs, at);
const fresh = (coins = 100, at = AFTERNOON): GameState => {
  const g = newGame(at, defs, 7);
  return { ...g, inventory: { ...g.inventory, [COIN]: coins } };
};
const coins = (g: GameState) => g.inventory[COIN] ?? 0;

test('tavern.json 載入且通過檢查；老闆、酒館菜單都在', () => {
  assert.deepEqual(validateGameplay(file), []);
  assert.ok(file.npcs?.barkeep?.shop === 'tavern');
  assert.ok(file.shops.tavern?.trades.length);
  assert.equal(T.coinFlip.cost, 10);
  assert.equal(T.coinFlip.reward, 20);
});

test('社交時間：晚上 8 點到午夜，老陳、小葵、阿綱都在酒館；白天只有老闆', () => {
  assert.equal(isSocialHour(T, AFTERNOON), false);
  assert.equal(isSocialHour(T, NIGHT), true);
  assert.equal(isSocialHour(T, new Date(2026, 10, 10, 20, 0).getTime()), true);
  assert.equal(isSocialHour(T, new Date(2026, 10, 10, 19, 59).getTime()), false);
  assert.deepEqual(tavernNpcs(T, AFTERNOON), ['barkeep']);
  assert.deepEqual(new Set(tavernNpcs(T, NIGHT)), new Set(['barkeep', 'fisher', 'smith', 'florist']));
  // 跨午夜的設定也可以（例如 22～2 點）
  const late = { ...T, social: { ...T.social, fromHour: 22, toHour: 2 } };
  assert.equal(isSocialHour(late, new Date(2026, 10, 11, 1, 0).getTime()), true);
  assert.equal(isSocialHour(late, new Date(2026, 10, 11, 3, 0).getTime()), false);
  // 畫面資料
  assert.equal(gameView(fresh(), defs, NIGHT).stats.tavern?.social, true);
});

test('猜硬幣：付 10 金幣；猜中拿 20 金幣和她的好感，猜錯只扣錢；正反兩種都會出現', () => {
  let wins = 0;
  let losses = 0;
  let g = fresh(1000);
  for (let i = 0; i < 60; i++) {
    const before = coins(g);
    const r = run(g, { type: 'coin_flip', guess: 'heads' });
    assert.ok(r.ok && r.event.type === 'coin_flipped');
    const e = r.event;
    assert.equal(e.win, e.result === 'heads');
    assert.equal(coins(r.game) - before, e.win ? T.coinFlip.reward - T.coinFlip.cost : -T.coinFlip.cost);
    assert.equal(e.coins, coins(r.game) - before);
    if (e.win) wins++;
    else {
      losses++;
      assert.equal(e.gain, 0);
    }
    g = r.game;
  }
  assert.ok(wins > 10 && losses > 10, `正反面應該差不多一半一半（贏 ${wins}、輸 ${losses}）`);
});

test('猜硬幣：好感每天最多 maxAffectionPerDay；金幣不夠就不能玩', () => {
  let g = fresh(1000);
  let total = 0;
  for (let i = 0; i < 80; i++) {
    const r = run(g, { type: 'coin_flip', guess: 'tails' });
    assert.ok(r.ok && r.event.type === 'coin_flipped');
    total += r.event.gain;
    g = r.game;
  }
  assert.equal(total, T.coinFlip.maxAffectionPerDay);
  assert.equal(gameView(g, defs, AFTERNOON).stats.tavern?.flipAffectionLeft, 0);
  // 隔天又可以拿
  assert.equal(gameView(g, defs, AFTERNOON + 24 * 3_600_000).stats.tavern?.flipAffectionLeft, T.coinFlip.maxAffectionPerDay);
  const broke = run(fresh(9), { type: 'coin_flip', guess: 'heads' });
  assert.ok(!broke.ok && broke.error === 'no_item');
  const bad = run(fresh(), { type: 'coin_flip', guess: 'edge' as 'heads' });
  assert.ok(!bad.ok && bad.error === 'unknown');
});

test('比大小：只能跟在酒館的人打；贏了加 NPC 好感（每天算 maxWinsPerDay 次）；牌是 1～13', () => {
  // 白天小葵在花店，不在酒館
  const away = run(fresh(), { type: 'cards', npc: 'florist' });
  assert.ok(!away.ok && away.error === 'not_here');
  // 老闆一直在
  assert.ok(run(fresh(), { type: 'cards', npc: 'barkeep' }).ok);
  let g = fresh(100, NIGHT);
  let counted = 0;
  const outcomes = new Set<string>();
  for (let i = 0; i < 80; i++) {
    const r = run(g, { type: 'cards', npc: 'florist' }, NIGHT);
    assert.ok(r.ok && r.event.type === 'cards_played');
    const e = r.event;
    assert.ok(e.mine >= 1 && e.mine <= 13 && e.theirs >= 1 && e.theirs <= 13);
    assert.equal(e.outcome, e.mine > e.theirs ? 'win' : e.mine < e.theirs ? 'lose' : 'tie');
    if (e.gain > 0) counted++;
    if (e.outcome !== 'win') assert.equal(e.gain, 0);
    outcomes.add(e.outcome);
    g = r.game;
  }
  assert.ok(outcomes.has('win') && outcomes.has('lose'));
  assert.equal(counted, T.cards.maxWinsPerDay);
  assert.equal(g.npcs.florist!.friendship, T.cards.maxWinsPerDay * T.cards.friendship);
  assert.ok((gameView(g, defs, NIGHT).stats.tavern?.cardWins.florist ?? 0) >= T.cards.maxWinsPerDay);
});

test('存檔：tavernToday 壞掉或沒有時補上預設值', () => {
  const g = normalizeGame({ ...fresh(), tavernToday: 'oops' }, AFTERNOON, defs);
  assert.deepEqual(g.tavernToday, { day: '', flipGain: 0, cardWins: {} });
  const old = { ...fresh() } as Partial<GameState>;
  delete old.tavernToday;
  assert.deepEqual(normalizeGame(old, AFTERNOON, defs).tavernToday, { day: '', flipGain: 0, cardWins: {} });
});

test('酒館地圖：每個熱區的站位、老闆和晚上客人的位置旁邊都走得到；小鎮有門通到酒館', async () => {
  const ia = JSON.parse(await readFile(join(PACK_DIR, 'interactables.json'), 'utf8')) as InteractablesFile;
  const bg = ia.scenes[T.scene]!;
  const m = buildBackgroundMap(bg, 16);
  const start = m.spawns.default!.tile;
  const dist = distances(m, start);
  const ok = (t: { x: number; y: number }) => dist[t.y * m.width + t.x]! < Infinity;
  for (const it of m.interactables) if (it.hotspot?.approach !== 'none') assert.ok(it.stands.some(ok), `熱區 ${it.id} 走不到`);
  assert.ok(m.doors.some((d) => d.to === 'town' && d.stand && ok(d.stand)));
  for (const id of ['bar', 'arcade', 'cards']) assert.ok(m.interactables.some((x) => x.id === id), id);
  const town = await readFile(join(PACK_DIR, 'maps', 'town.tmj'), 'utf8');
  assert.match(town, /"to-tavern"/);
});
