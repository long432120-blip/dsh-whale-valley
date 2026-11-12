// V0.18：她的小願望、摸摸頭、深夜提醒、季節粒子
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { packGameplay, PACK_DIR } from './pack-gameplay.ts';
import { applyAction, buildDefs, gameView, newGame, normalizeGame, tickGame, validateGameplay } from '../src/shared/gameplay.ts';
import type { GameState } from '../src/shared/gameplay-types.ts';
import { rollWish, validateWishes, wishHit, type WishesFile } from '../src/shared/wishes.ts';
import { createSave, setScene } from '../src/shared/state.ts';
import { dayFacts } from '../src/shared/diary.ts';
import { lateNightDue, lateNightKey, parseLateNight, type LateNightDef } from '../src/shared/late-night.ts';
import { SeasonFx } from '../src/client/pixel/season-fx.ts';
import type { PixelWorldFile } from '../src/shared/pixel-types.ts';

const file = await packGameplay();
const defs = buildDefs(file);
const W = file.wishes!;
const T0 = new Date(2026, 10, 10, 10, 0).getTime();
const DAY = 86_400_000;
const world = JSON.parse(await readFile(join(PACK_DIR, 'scenes.json'), 'utf8')) as PixelWorldFile;

/** 新手教學做完的存檔 */
function veteran(over: Partial<GameState> = {}): GameState {
  const g = newGame(T0, defs, 11);
  return { ...g, quest: { ...g.quest, chain: null, done: { tutorial: true } }, ...over };
}
/** 指定今天的願望 */
function withWish(g: GameState, id: string, at = T0): GameState {
  const only: WishesFile = { ...W, wishes: W.wishes.filter((w) => w.id === id) };
  const day = new Date(at);
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const wish = rollWish(only, defs, { day: key, questDone: { tutorial: true } }, () => 0);
  assert.ok(wish, id);
  return { ...g, wish };
}

test('wishes.json 通過檢查；寫錯會被抓到', () => {
  assert.deepEqual(validateGameplay(file), []);
  const bad: WishesFile = { ...W, wishes: [{ ...W.wishes[0]!, items: ['no_such_food'] }, { ...W.wishes[0]! }, { id: 'x', event: 'enter', emoji: '🏖️', text: '去{npc}', hint: 'h', affection: -1 }] };
  const errs = validateWishes(bad, { items: defs.items, npcs: file.npcs ?? {} }).join('\n');
  assert.match(errs, /no_such_food/);
  assert.match(errs, /id 重複/);
  assert.match(errs, /scene/);
  assert.match(errs, /npcs/);
  assert.match(errs, /affection/);
});

test('每天早上許一個願望：新手教學時不許、不會連兩天一樣、同一天怎麼問都一樣', () => {
  const fresh = tickGame(newGame(T0, defs, 3), T0 + 1000, defs);
  assert.equal(fresh.wish, null, '新手教學時不許願');
  let g = tickGame(veteran(), T0 + 1000, defs);
  assert.ok(g.wish && !g.wish.done);
  assert.ok(W.wishes.some((w) => w.id === g.wish!.id));
  assert.equal(gameView(g, defs, T0 + 2000).wish?.text, g.wish.text);
  const same = tickGame(g, T0 + 3 * 3_600_000, defs);
  assert.deepEqual(same.wish, g.wish, '同一天不會換');
  const seen = new Set<string>();
  for (let i = 1; i <= 20; i++) {
    const prev = g.wish!.id;
    g = tickGame(g, T0 + i * DAY, defs);
    assert.ok(g.wish);
    assert.notEqual(g.wish.id, prev, '不會連兩天一樣');
    assert.doesNotMatch(g.wish.text, /\{|\}/, g.wish.text);
    seen.add(g.wish.id);
  }
  assert.ok(seen.size >= 6, `20 天裡至少有 6 種願望（${[...seen].join('、')}）`);
});

test('想吃某樣東西：餵別的不算、餵對了就實現（好感不算在每日上限裡），寫進日記', () => {
  let g = withWish(veteran({ satiety: 10 }), 'eat-cook');
  const want = g.wish!.item!;
  const other = 'crop_tomato';
  g = { ...g, inventory: { ...g.inventory, [want]: 1, [other]: 1 }, affectionToday: { day: '', gained: 0 } };
  const a = applyAction(g, { type: 'feed', item: other }, defs, T0);
  assert.ok(a.ok);
  assert.equal(a.game.wish!.done, false);
  // 今天的好感已經加滿了：願望的獎勵照樣給
  const capped = { ...a.game, affectionToday: { day: a.game.affectionToday.day, gained: file.affection.dailyCap } };
  const b = applyAction(capped, { type: 'feed', item: want }, defs, T0 + 1000);
  assert.ok(b.ok);
  assert.equal(b.game.wish!.done, true);
  assert.equal(b.game.affection - capped.affection, g.wish!.affection);
  assert.equal(gameView(b.game, defs, T0 + 2000).wish!.done, true);
  assert.equal(b.game.dayLog.counts.wish, 1);
  assert.equal(dayFacts(b.game.dayLog, defs, file.diary!)[0]!.key, 'wish', '日記第一件事就是願望');
  // 已經實現了：再餵也不會再加
  const c = applyAction({ ...b.game, inventory: { ...b.game.inventory, [want]: 1 }, satiety: 10 }, { type: 'feed', item: want }, defs, T0 + 2000);
  assert.ok(c.ok);
  assert.equal(c.game.affection - b.game.affection, c.event.type === 'fed' ? c.event.gain : -1);
});

test('要做好幾次的願望：進度一格一格加；走進地圖的願望（帶她去海邊）', () => {
  const g = withWish(veteran(), 'plant');
  assert.equal(g.wish!.need, 2);
  assert.equal(wishHit(g.wish!, { event: 'planted', items: ['seed_carrot'], count: 1 }), 1);
  assert.equal(wishHit(g.wish!, { event: 'caught', items: ['fish_bass'], count: 1 }), 0);
  // 走進海邊
  const save = { ...createSave(T0, 'garden', defs), lastTickAt: T0 };
  save.game = withWish(veteran(), 'beach');
  const there = setScene(save, 'beach', T0 + 1000, defs);
  assert.equal(there.game.wish!.done, true);
  const home = setScene({ ...save, game: withWish(veteran(), 'beach') }, 'town', T0 + 1000, defs);
  assert.equal(home.game.wish!.done, false);
  // 存檔讀回來一樣；壞掉的願望當作沒有（下次結算重抽）
  assert.deepEqual(normalizeGame(JSON.parse(JSON.stringify(there.game)), T0, defs).wish, there.game.wish);
  assert.equal(normalizeGame({ ...JSON.parse(JSON.stringify(there.game)), wish: { id: 3 } }, T0, defs).wish, null);
});

test('摸摸頭：每天前 perDay 次加好感；摸夠了還能摸（也算願望）', () => {
  const hp = file.leisure!.headpat!;
  assert.equal(hp.clicks, 3);
  assert.equal(hp.windowMs, 1500);
  let g = withWish(veteran({ affection: 0, affectionToday: { day: '', gained: 0 } }), 'headpat');
  let total = 0;
  for (let i = 0; i < hp.perDay + 2; i++) {
    const r = applyAction(g, { type: 'headpat' }, defs, T0 + i * 1000);
    assert.ok(r.ok && r.event.type === 'headpat');
    assert.equal(r.event.gain, i < hp.perDay ? hp.affection : 0);
    total += r.event.gain;
    if (i === 0) assert.equal(r.game.wish!.done, true, '第一次摸就實現「摸摸我的頭」');
    g = r.game;
  }
  assert.equal(g.affection, total + W.wishes.find((w) => w.id === 'headpat')!.affection);
  assert.equal(g.dayLog.counts.headpat, hp.perDay + 2);
  // 隔天又可以加
  const next = applyAction(g, { type: 'headpat' }, defs, T0 + DAY);
  assert.ok(next.ok && next.event.type === 'headpat' && next.event.gain === hp.affection);
  // 她在礦洞：摸不到
  const away = applyAction({ ...g, mine: { ...g.mine, trip: { floor: 1, startedAt: T0, endsAt: T0 + 9e9 } as never } }, { type: 'headpat' }, defs, T0);
  assert.ok(!away.ok && away.error === 'away');
});

test('深夜提醒：用電腦的時鐘，23 點後到 5 點前；同一晚最多 3 次、每次隔 60 分鐘', () => {
  const def = world.ambient!.lateNight! as LateNightDef;
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
  assert.equal(lateNightKey(at(12, 22, 59), def), null);
  assert.equal(lateNightKey(at(12, 23, 0), def), '2026-11-12');
  assert.equal(lateNightKey(at(13, 2, 0), def), '2026-11-12', '過了午夜還算前一天晚上');
  assert.equal(lateNightKey(at(13, 5, 0), def), null);
  let st = lateNightDue(at(12, 23, 5), def, null);
  assert.deepEqual(st && { n: st.night, c: st.count }, { n: '2026-11-12', c: 1 });
  assert.equal(lateNightDue(at(12, 23, 40), def, st), null, '60 分鐘內不再提醒');
  st = lateNightDue(at(13, 0, 6), def, st)!;
  assert.equal(st.count, 2);
  st = lateNightDue(at(13, 1, 10), def, st)!;
  assert.equal(st.count, 3);
  assert.equal(lateNightDue(at(13, 3, 0), def, st), null, '一晚最多 3 次');
  assert.equal(lateNightDue(at(13, 23, 1), def, st)!.count, 1, '隔天晚上重新算');
  assert.equal(parseLateNight('{bad'), null);
  assert.deepEqual(parseLateNight(JSON.stringify(st)), st);
});

test('季節粒子：春夏秋各有設定、雪是雪天的天氣粒子；只在戶外；下雨就不飄（一次一種）；螢火蟲晚上才在夜色上面發光', async () => {
  const S = world.ambient!.seasons!;
  const Wx = world.ambient!.weather!;
  assert.deepEqual(Object.keys(S).sort(), ['autumn', 'spring', 'summer']);
  assert.deepEqual([S.spring!.kind, S.summer!.kind, S.autumn!.kind, Wx.snowy!.kind], ['petal', 'firefly', 'leaf', 'snow']);
  // 冬天不下雨，只下雪；其他季節不下雪
  const wx = JSON.parse(await readFile(join(PACK_DIR, 'weather.json'), 'utf8')) as { seasons: Record<string, Record<string, number>>; types: { id: string; particles?: unknown }[] };
  assert.equal(wx.seasons.winter!.rainy ?? 0, 0);
  assert.equal(wx.seasons.winter!.storm ?? 0, 0);
  assert.ok(wx.seasons.winter!.snowy! > 0);
  for (const s of ['spring', 'summer', 'autumn']) assert.equal(wx.seasons[s]!.snowy ?? 0, 0);
  assert.equal(wx.types.find((t) => t.id === 'snowy')!.particles, undefined, '雪天不畫雨滴');
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fx = new SeasonFx({ ...S, 'weather:snowy': Wx.snowy! }, rnd);
  fx.set('weather:snowy', { outdoor: false, night: false, rain: false });
  fx.update(0.016, 288, 192);
  assert.equal(fx.size, 0, '室內沒有');
  fx.set('weather:snowy', { outdoor: true, night: false, rain: false });
  fx.update(0.016, 288, 192);
  assert.equal(fx.size, Wx.snowy!.count);
  for (let i = 0; i < 600; i++) fx.update(0.05, 288, 192); // 30 秒：一直有、不會越來越多
  assert.equal(fx.size, Wx.snowy!.count);
  fx.set('spring', { outdoor: true, night: false, rain: true });
  for (let i = 0; i < 10; i++) fx.update(0.05, 288, 192);
  assert.equal(fx.size, 0, '下雨就不飄花瓣');
  fx.set('spring', { outdoor: true, night: false, rain: false });
  for (let i = 0; i < 10; i++) fx.update(0.05, 288, 192);
  assert.equal(fx.kind, 'petal');
  assert.equal(fx.size, S.spring!.count);
  fx.set('summer', { outdoor: true, night: false, rain: false });
  fx.update(0.05, 288, 192);
  assert.equal(fx.size, Math.round(S.summer!.count * (S.summer!.dayRatio ?? 1)), '螢火蟲白天少');
  // 畫的層：晚上螢火蟲在 glow 層
  const calls: string[] = [];
  const ctx = { save() {}, restore() {}, fillRect() { calls.push('rect'); }, set globalAlpha(_v: number) {}, set fillStyle(_v: string) {} } as unknown as CanvasRenderingContext2D;
  fx.set('summer', { outdoor: true, night: true, rain: false });
  for (let i = 0; i < 40; i++) fx.update(0.05, 288, 192);
  fx.draw(ctx, 0, 0, 'normal');
  assert.equal(calls.length, 0);
  fx.draw(ctx, 0, 0, 'glow');
  assert.ok(calls.length > 0);
});

test('試玩發現：閣樓、溫室外面的黑色空白不能走（她不會走到房間外面）', async () => {
  const { parseTiledMap } = await import('../src/shared/tiled.ts');
  const ts = JSON.parse(await readFile(join(PACK_DIR, 'maps/tiles.tsj'), 'utf8'));
  for (const name of ['attic', 'greenhouse']) {
    const tmj = JSON.parse(await readFile(join(PACK_DIR, `maps/${name}.tmj`), 'utf8'));
    const m = parseTiledMap(tmj, ts, `maps/${name}.tmj`, 'maps/tiles.tsj');
    const layers = tmj.layers.filter((l: { type: string }) => l.type === 'tilelayer') as { data: number[] }[];
    let empty = 0;
    for (let i = 0; i < m.width * m.height; i++) {
      if (layers.every((l) => !l.data[i])) {
        empty++;
        assert.ok(m.blocked[i], `${name} 第 ${i} 格是空白，應該擋路`);
      }
    }
    assert.ok(empty > 0);
    // 出生點、門口還是走得到
    for (const sp of Object.values(m.spawns)) assert.ok(!m.blocked[sp.tile.y * m.width + sp.tile.x], `${name} 出生點被擋住`);
  }
});
