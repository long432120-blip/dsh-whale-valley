// V0.14：家具目錄（furniture_shop.json）：買、二手賣、佔好幾格的擺放、地毯、收回、存檔；背景音樂（music.json）選歌
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { packGameplay, PACK_DIR } from './pack-gameplay.ts';
import { applyAction, buildDefs, gameView, newGame, normalizeGame, resalePrice, validateGameplay } from '../src/shared/gameplay.ts';
import { COIN, type GameAction, type GameplayFile, type GameState } from '../src/shared/gameplay-types.ts';
import { pickTrack, validateMusic, type MusicFile } from '../src/shared/music.ts';

const T0 = new Date(2026, 10, 10, 14, 0).getTime();
const file: GameplayFile = await packGameplay();
const defs = buildDefs(file);
const F = file.furniture!;
const price = (id: string) => F.items.find((e) => e.id === id)!.price;

const run = (g: GameState, a: GameAction) => applyAction(g, a, defs, T0);
const must = (g: GameState, a: GameAction) => {
  const r = run(g, a);
  assert.ok(r.ok, `${a.type} 失敗：${!r.ok ? r.error : ''}`);
  return r;
};
const rich = (coins = 5000, inv: Record<string, number> = {}): GameState => {
  const g = newGame(T0, defs, 7);
  return { ...g, inventory: { ...g.inventory, [COIN]: coins, ...inv } };
};

test('furniture_shop.json 載入且通過檢查；目錄的每一件都是物品，出貨箱收購價 = 二手價', () => {
  assert.deepEqual(validateGameplay(file), []);
  assert.ok(F.items.length >= 40);
  for (const e of F.items) {
    const def = defs.items.get(e.id);
    assert.ok(def, e.id);
    assert.equal(def!.price, resalePrice(e.price, F.resaleRate), e.id);
    if (e.category === 'floor' || e.category === 'wall') assert.ok(def!.decor, e.id);
    else assert.ok(def!.place, e.id);
  }
  // 沿用 gameplay.json 原本的設定：田地套組還是田
  assert.equal(defs.items.get('plot_kit')!.place?.plot, true);
  assert.deepEqual(defs.items.get('furn_bed_double')!.place?.size, { w: 2, h: 2 });
  assert.equal(defs.items.get('furn_rug_red')!.place?.rug, true);
  assert.equal(defs.items.get('furn_rug_red')!.place?.blocking, false);
  // 小葵的花店不再一件一件賣家具（改看目錄）
  assert.ok(!file.shops.florist!.trades.some((t) => Object.keys(t.get).some((k) => k.startsWith('furn_'))));
});

test('買家具：扣金幣、放進揹包、記錄買過的；金幣不夠就不能買', () => {
  const g0 = rich(1000);
  const r = must(g0, { type: 'buy_furniture', item: 'furn_sofa_blue' });
  assert.ok(r.event.type === 'furniture_bought' && r.event.cost === price('furn_sofa_blue'));
  assert.equal(r.game.inventory[COIN], 1000 - price('furn_sofa_blue'));
  assert.equal(r.game.inventory.furn_sofa_blue, 1);
  assert.equal(r.game.furnitureBought.furn_sofa_blue, 1);
  assert.equal(gameView(r.game, defs, T0).furniture.bought.furn_sofa_blue, 1);
  const two = must(r.game, { type: 'buy_furniture', item: 'furn_stool', count: 2 });
  assert.equal(two.game.inventory.furn_stool, 2);
  const poor = run(rich(10), { type: 'buy_furniture', item: 'furn_fireplace' });
  assert.ok(!poor.ok && poor.error === 'no_item');
  assert.ok(!run(rich(), { type: 'buy_furniture', item: 'fish_bass' }).ok); // 不是目錄裡的東西
  assert.ok(!run(rich(), { type: 'buy_furniture', item: 'furn_stool', count: 0 }).ok);
});

test('二手賣出：揹包裡的才能賣，拿回買價 × resaleRate', () => {
  const g = must(rich(1000), { type: 'buy_furniture', item: 'furn_clock' }).game;
  const r = must(g, { type: 'sell_furniture', item: 'furn_clock' });
  assert.ok(r.event.type === 'furniture_sold' && r.event.coins === resalePrice(price('furn_clock'), F.resaleRate));
  assert.equal(r.game.inventory.furn_clock, undefined);
  assert.equal(r.game.inventory[COIN], 1000 - price('furn_clock') + resalePrice(price('furn_clock'), F.resaleRate));
  assert.equal(r.game.furnitureBought.furn_clock, 1); // 買過的紀錄不會因為賣掉而減少
  const none = run(r.game, { type: 'sell_furniture', item: 'furn_clock' });
  assert.ok(!none.ok && none.error === 'no_item');
});

test('擺放：2×2 的床佔四格、不能跟別的家具重疊；地毯可以墊在家具底下；點任何一格都能收回', () => {
  let g = rich(0, { furn_bed_double: 1, furn_chair: 1, furn_rug_red: 1 });
  g = must(g, { type: 'place', scene: 'attic', item: 'furn_bed_double', x: 7, y: 5 }).game;
  // 床的右下角那格不能再擺椅子
  const clash = run({ ...g, inventory: { ...g.inventory } }, { type: 'place', scene: 'attic', item: 'furn_chair', x: 8, y: 6 });
  assert.ok(!clash.ok && clash.error === 'plot_busy');
  // 地毯鋪在床底下可以（地毯跟非地毯可以疊）
  g = must(g, { type: 'place', scene: 'attic', item: 'furn_rug_red', x: 8, y: 5 }).game;
  assert.equal(g.placed.attic!.length, 2);
  // 點床佔的右下角：先收上面的床，地毯還在
  const up = must(g, { type: 'pickup', scene: 'attic', x: 8, y: 6 });
  assert.ok(up.event.type === 'picked_up' && up.event.item === 'furn_bed_double');
  assert.equal(up.game.inventory.furn_bed_double, 1);
  assert.deepEqual(up.game.placed.attic!.map((p) => p.item), ['furn_rug_red']);
  assert.equal(gameView(g, defs, T0).furniture.placed.furn_bed_double, 1);
});

test('存檔：furnitureBought 壞掉或沒有時補上空的；擺的位置照舊存在 placed', () => {
  assert.deepEqual(normalizeGame({ ...rich(), furnitureBought: 'x' }, T0, defs).furnitureBought, {});
  const old = { ...rich() } as Partial<GameState>;
  delete old.furnitureBought;
  assert.deepEqual(normalizeGame(old, T0, defs).furnitureBought, {});
  const g = must(rich(0, { furn_palm: 1 }), { type: 'place', scene: 'room', item: 'furn_palm', x: 3, y: 4 }).game;
  const back = normalizeGame(JSON.parse(JSON.stringify(g)), T0, defs);
  assert.deepEqual(back.placed.room, [{ item: 'furn_palm', x: 3, y: 4 }]);
});

test('背景音樂：酒館、礦洞優先；戶外下雨放雨聲；晚上（室內傍晚起）放夜晚房間；其他放農場白天', async () => {
  const M = JSON.parse(await readFile(join(PACK_DIR, 'music.json'), 'utf8')) as MusicFile;
  assert.deepEqual(validateMusic(M, { scenes: ['tavern', 'mine', 'room', 'garden'], weather: ['sunny', 'rainy', 'storm'] }), []);
  const at = (scene: string, outdoor: boolean, weather: string, phase: string) => pickTrack(M, { scene, outdoor, weather, phase });
  assert.equal(at('tavern', false, 'rainy', 'night'), 'tavern');
  assert.equal(at('mine', false, 'sunny', 'morning'), 'mine');
  assert.equal(at('garden', true, 'rainy', 'afternoon'), 'rain');
  assert.equal(at('garden', true, 'storm', 'night'), 'rain');
  assert.equal(at('room', false, 'rainy', 'afternoon'), 'farm-day'); // 室內聽不到雨
  assert.equal(at('room', false, 'sunny', 'evening'), 'night-room');
  assert.equal(at('garden', true, 'sunny', 'evening'), 'farm-day');
  assert.equal(at('garden', true, 'sunny', 'night'), 'night-room');
  assert.equal(at('ranch', true, 'sunny', 'morning'), 'farm-day');
  assert.equal(pickTrack(undefined, { scene: 'room', outdoor: false }), null);
  // 檢查會抓錯
  const bad = validateMusic({ version: 1, volume: 2, fadeMs: 0, tracks: { a: { src: 'a.txt', name: '' } }, rules: [{ track: 'b', phases: ['noon'] }] });
  for (const s of ['volume', 'src 要是音樂檔', 'name', '沒有「b」', 'noon']) assert.ok(bad.join('\n').includes(s), s);
});
