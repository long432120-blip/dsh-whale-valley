// V0.16：坐下來吃飯、零食桌（免費、每天有幾份）、冰箱（每天找到一樣東西）、酒館與廚房的座位
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { packGameplay, PACK_DIR } from './pack-gameplay.ts';
import { applyAction, buildDefs, gameView, newGame, normalizeGame, validateGameplay } from '../src/shared/gameplay.ts';
import type { GameAction, GameplayFile, GameState } from '../src/shared/gameplay-types.ts';
import { buildBackgroundMap, imgToMap, validateInteractables, type InteractablesFile } from '../src/shared/hotspots.ts';
import { distances } from '../src/shared/path.ts';

const T0 = new Date(2026, 10, 10, 14, 0).getTime();
const NEXT_DAY = new Date(2026, 10, 11, 9, 0).getTime();
const NIGHT = new Date(2026, 10, 10, 21, 0).getTime();
const file: GameplayFile = await packGameplay();
const defs = buildDefs(file);
const L = file.leisure!;
const ia = JSON.parse(await readFile(join(PACK_DIR, 'interactables.json'), 'utf8')) as InteractablesFile;

const run = (g: GameState, a: GameAction, at = T0) => applyAction(g, a, defs, at);
const must = (g: GameState, a: GameAction, at = T0) => {
  const r = run(g, a, at);
  assert.ok(r.ok, `${a.type} 失敗：${!r.ok ? r.error : ''}`);
  return r;
};
const hungry = (over: Partial<GameState> = {}): GameState => ({ ...newGame(T0, defs, 7), satiety: 20, stamina: 30, ...over });

test('leisure.json 的零食桌、冰箱通過檢查', () => {
  assert.deepEqual(validateGameplay(file), []);
  assert.ok(L.snacks?.snack && L.snacks.snack.perDay > 0);
  assert.ok(L.fridge && L.fridge.finds.length);
  const bad = structuredClone(file);
  bad.leisure!.fridge!.finds = [{ item: 'no_such_food', weight: 1 }];
  bad.leisure!.snacks!.snack!.perDay = 0;
  const errs = validateGameplay(bad).join('\n');
  assert.match(errs, /no_such_food/);
  assert.match(errs, /perDay/);
});

test('零食桌：免費，恢復飽食、體力、好感；每天 perDay 份，吃完要等明天', () => {
  const sn = L.snacks!.snack!;
  let g = hungry();
  for (let i = 0; i < sn.perDay; i++) {
    const r = must(g, { type: 'snack', table: 'snack' });
    if (r.event.type !== 'snacked') assert.fail();
    assert.equal(r.event.left, sn.perDay - i - 1);
    assert.equal(r.game.satiety, g.satiety + sn.satiety);
    assert.ok(r.game.stamina > g.stamina);
    assert.deepEqual(r.game.inventory, g.inventory, '不用花錢、不用東西');
    g = r.game;
  }
  const out = run(g, { type: 'snack', table: 'snack' });
  assert.ok(!out.ok && out.error === 'sold_out');
  assert.equal(gameView(g, defs, T0).stats.pantry.snacks.snack, 0);
  // 隔天補滿
  assert.equal(gameView(g, defs, NEXT_DAY).stats.pantry.snacks.snack, sn.perDay);
  must({ ...g, satiety: 20 }, { type: 'snack', table: 'snack' }, NEXT_DAY);
  // 吃飽了、沒有這張桌子、她不在（去礦洞）都不行
  const full = run(hungry({ satiety: file.satiety.max, stamina: file.stamina.max }), { type: 'snack', table: 'snack' });
  assert.ok(!full.ok && full.error === 'full');
  const none = run(hungry(), { type: 'snack', table: 'buffet' });
  assert.ok(!none.ok && none.error === 'unknown');
});

test('冰箱：每天第一次打開找到一樣東西放進揹包；再打開是空的；隔天又有', () => {
  const g = hungry();
  const r = must(g, { type: 'fridge' });
  if (r.event.type !== 'fridge_opened') assert.fail();
  const item = r.event.item!;
  assert.ok(L.fridge!.finds.some((x) => x.item === item));
  assert.equal(r.game.inventory[item] ?? 0, (g.inventory[item] ?? 0) + r.event.count);
  assert.equal(gameView(r.game, defs, T0).stats.pantry.fridge, 0);
  const again = must(r.game, { type: 'fridge' });
  assert.deepEqual(again.event, { type: 'fridge_opened', item: null, count: 0, left: 0 });
  assert.deepEqual(again.game.inventory, r.game.inventory);
  const tomorrow = must(r.game, { type: 'fridge' }, NEXT_DAY);
  if (tomorrow.event.type !== 'fridge_opened') assert.fail();
  assert.ok(tomorrow.event.item);
});

test('今天的點心、冰箱紀錄會存檔（壞掉的資料也讀得起來）', () => {
  const g = must(must(hungry(), { type: 'snack', table: 'snack' }).game, { type: 'fridge' }).game;
  const back = normalizeGame(JSON.parse(JSON.stringify(g)), T0, defs);
  assert.deepEqual(back.pantryToday, g.pantryToday);
  const broken = normalizeGame({ ...JSON.parse(JSON.stringify(g)), pantryToday: { day: 3, snacks: { snack: 'x' }, fridge: null } }, T0, defs);
  assert.deepEqual(broken.pantryToday, { day: '', snacks: {}, fridge: 0 });
});

test('熱區：廚房餐桌、遊戲室零食桌會坐下來吃；冰箱是冰箱；座位不在擋路的格子上', () => {
  assert.deepEqual(validateInteractables(ia, {
    scenes: ['room', 'garden', 'attic', 'kitchen', 'bath', 'gameroom', 'tavern', 'town'],
    clips: ['sit', 'sleepy', 'happy', 'tavern_sit', 'swim'],
    snacks: Object.keys(L.snacks!),
  }), []);
  const hs = (scene: string, id: string) => ia.scenes[scene]!.hotspots.find((h) => h.id === id)!;
  assert.deepEqual(hs('kitchen', 'table').action, { type: 'eat' });
  assert.equal(hs('kitchen', 'table').pose, 'sit');
  assert.ok(hs('kitchen', 'table').seat);
  assert.deepEqual(hs('gameroom', 'snack').action, { type: 'eat', snack: 'snack' });
  assert.ok(hs('gameroom', 'snack').seat && hs('gameroom', 'snack').pose);
  assert.deepEqual(hs('kitchen', 'fridge').action, { type: 'fridge' });
  // 酒館四張餐桌：各有一張椅子（seat），站位走得到
  const bg = ia.scenes.tavern!;
  const m = buildBackgroundMap(bg, 16);
  const from = m.spawns.default!.tile;
  const dist = distances(m, from);
  for (const id of ['table-a', 'table-b', 'table-c', 'table-d']) {
    const it = m.interactables.find((x) => x.id === id)!;
    assert.ok(it.petSeat, `${id} 要有 seat`);
    const st = it.stands[0]!;
    assert.ok(Number.isFinite(dist[st.y * m.width + st.x]!), `${id} 走不到`);
    // 椅子離站位不遠（不會從房間另一頭瞬移過去）
    const c = imgToMap(bg, 16);
    const seat = it.hotspot!.seat!;
    const t = c.tile(seat);
    assert.ok(Math.abs(t.x - st.x) <= 1 && Math.abs(t.y - st.y) <= 1, `${id} 的椅子離站位太遠`);
  }
});

test('廚房：餐桌整張擋路（她不會走到桌面上）；爐子、水槽、冰箱前面站得到', () => {
  const bg = ia.scenes.kitchen!;
  const m = buildBackgroundMap(bg, 16);
  const c = imgToMap(bg, 16);
  // 桌面（含後緣）每一格都不能走
  for (const p of [{ x: 560, y: 650 }, { x: 760, y: 650 }, { x: 980, y: 650 }, { x: 760, y: 740 }, { x: 760, y: 830 }]) {
    const t = c.tile(p);
    assert.ok(m.blocked[t.y * m.width + t.x], `(${p.x},${p.y}) 應該擋路`);
  }
  const dist = distances(m, m.spawns.fromHall!.tile);
  for (const id of ['stove', 'sink', 'fridge', 'table', 'pans']) {
    const it = m.interactables.find((x) => x.id === id)!;
    const st = it.stands[0]!;
    assert.ok(Number.isFinite(dist[st.y * m.width + st.x]!), `${id} 走不到`);
  }
});

test('酒館：晚上阿綱站在飛鏢靶下，不在撞球桌上', () => {
  const T = file.tavern!;
  const smith = T.social.seats.find((s) => s.npc === 'smith')!;
  const pool = ia.scenes.tavern!.hotspots.find((h) => h.id === 'pool')!.rect;
  const inPool = smith.at.x >= pool.x - 40 && smith.at.x <= pool.x + pool.w + 40 && smith.at.y >= pool.y && smith.at.y <= pool.y + pool.h + 40;
  assert.ok(!inPool, '阿綱的腳不能在撞球桌範圍裡');
  // 她坐的椅子、站位不會跟晚上的 NPC 擠在同一格
  const bg = ia.scenes.tavern!;
  const c = imgToMap(bg, 16);
  const npcTiles = new Set(T.social.seats.map((s) => { const t = c.tile(s.at); return `${t.x},${t.y}`; }));
  const m = buildBackgroundMap(bg, 16);
  for (const it of m.interactables) for (const st of it.stands) assert.ok(!npcTiles.has(`${st.x},${st.y}`), `${it.id} 的站位被 NPC 佔了`);
  assert.ok(NIGHT > T0);
});
