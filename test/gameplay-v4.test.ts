// 核心第 2～6 輪＋擴展（禮物碼、節慶、mod）的規則測試
import assert from 'node:assert/strict';
import { packGameplay } from './pack-gameplay.ts';
import { test } from 'node:test';
import {
  applyAction, buildDefs, decodeGift, festivalAt, gameView, lootAvailable, mergeGameplay, newGame, normalizeGame, seasonAt,
  validateGameplay, weatherAt,
} from '../src/shared/gameplay.ts';
import type { GameAction, GameEvent, GameplayFile, GameState } from '../src/shared/gameplay-types.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = new Date(2026, 10, 10, 13, 0).getTime();
const file: GameplayFile = await packGameplay();
const defs = buildDefs(file);

/** 成功就回傳新狀態與事件，失敗直接讓測試掛掉 */
function must(g: GameState, a: GameAction, at = T0): { g: GameState; e: GameEvent } {
  const r = applyAction(g, a, defs, at);
  assert.ok(r.ok, `${a.type} 失敗：${!r.ok ? r.error : ''}`);
  return { g: r.game, e: r.event };
}
function err(g: GameState, a: GameAction, at = T0) {
  const r = applyAction(g, a, defs, at);
  assert.ok(!r.ok, `${a.type} 應該失敗`);
  return r.error;
}
const rich = (inv: Record<string, number> = {}): GameState => ({ ...newGame(T0, defs), inventory: { coin: 100000, ...inv } });

test('內附玩法資料（五個 JSON 組起來）檢查通過', () => {
  assert.deepEqual(validateGameplay(file), []);
});

test('出貨與金幣：賣魚拿到錢、用錢買種子；金幣和沒定價的不能賣', () => {
  let g: GameState = { ...newGame(T0, defs), inventory: { fish_bass: 3 } };
  const s = must(g, { type: 'sell', item: 'fish_bass', count: 2 });
  assert.deepEqual(s.e, { type: 'sold', item: 'fish_bass', count: 2, coins: 80 });
  g = s.g;
  assert.equal(gameView(g, defs, T0).coins, 80);
  g = must(g, { type: 'trade', shop: 'merchant', trade: 'buy-carrot' }).g;
  assert.equal(g.inventory.seed_carrot, 2);
  assert.equal(g.inventory.coin, 40);
  assert.equal(err(g, { type: 'sell', item: 'coin', count: 1 }), 'not_for_sale');
  assert.equal(err(g, { type: 'sell', item: 'fish_bass', count: 5 }), 'no_item');
});

test('解鎖：要先解前一個、扣錢、不能重複；建築解鎖後有等級', () => {
  let g = rich();
  assert.equal(err(g, { type: 'unlock', id: 'ranch_field_b' }), 'locked');
  g = must(g, { type: 'unlock', id: 'ranch_field_a' }).g;
  g = must(g, { type: 'unlock', id: 'ranch_field_b' }).g;
  assert.equal(g.inventory.coin, 100000 - 1100);
  assert.equal(err(g, { type: 'unlock', id: 'ranch_field_a' }), 'already');
  g = must(g, { type: 'unlock', id: 'coop' }).g;
  assert.deepEqual(gameView(g, defs, T0).buildings.coop, { level: 0, capacity: 2, count: 0, maxLevel: 2 });
});

test('加工機器：放材料 → 時間沒到拿不到 → 時間到拿到成品；使用中不能再放', () => {
  let g = rich({ crop_strawberry: 2 });
  const st = must(g, { type: 'machine_start', key: 'ranch/jam-1', machine: 'preserves', recipe: 'jam' });
  g = st.g;
  assert.equal(g.inventory.crop_strawberry, 1);
  assert.equal(err(g, { type: 'machine_start', key: 'ranch/jam-1', machine: 'preserves', recipe: 'jam' }), 'busy');
  assert.equal(err(g, { type: 'machine_collect', key: 'ranch/jam-1' }, T0 + 89 * MIN), 'not_ready');
  const c = must(g, { type: 'machine_collect', key: 'ranch/jam-1' }, T0 + 90 * MIN);
  assert.equal(c.g.inventory.food_jam, 1);
  assert.equal(c.g.machines['ranch/jam-1'], null);
});

test('圖鑑收集：集滿一組就自動發獎勵，只發一次', () => {
  let g: GameState = { ...newGame(T0, defs), stats: { ...newGame(T0, defs).stats, caught: { fish_shrimp: 1, fish_bass: 1, fish_carp: 1, fish_puffer: 1 } } };
  const r = must(g, { type: 'fish', table: 'pond' });
  assert.ok(r.e.type === 'caught');
  assert.deepEqual(r.e.rewards.map((x) => x.id), ['pond']);
  assert.equal(r.g.inventory.coin, 300);
  assert.equal(r.g.inventory.tool_sprinkler, 1);
  g = r.g;
  const again = must(g, { type: 'fish', table: 'pond' }, T0 + 5000);
  assert.ok(again.e.type === 'caught' && again.e.rewards.length === 0);
});

test('釣魚小遊戲：miss 跑掉但扣體力；perfect 有時候釣到兩條', () => {
  let g = newGame(T0, defs);
  const miss = must(g, { type: 'fish', table: 'pond', quality: 'miss' });
  assert.equal(miss.e.type, 'escaped');
  assert.equal(miss.g.stamina, g.stamina - file.fishing.staminaCost);
  let doubled = false;
  for (let i = 0; i < 40 && !doubled; i++) {
    g = { ...g, stamina: 100 };
    const r = must(g, { type: 'fish', table: 'pond', quality: 'perfect' }, T0 + i * 5000);
    if (r.e.type === 'caught' && r.e.count === 2) doubled = true;
    g = r.g;
  }
  assert.ok(doubled);
});

test('動物：建雞舍 → 買小雞（容量上限）→ 長大一天 → 餵乾草 → 再一天後收蛋；沒吃飽不產、心情下降', () => {
  let g = rich({ hay: 10 });
  assert.equal(err(g, { type: 'buy_animal', kind: 'chicken' }), 'locked');
  g = must(g, { type: 'unlock', id: 'coop' }).g;
  g = must(g, { type: 'buy_animal', kind: 'chicken', name: '小白' }).g;
  g = must(g, { type: 'buy_animal', kind: 'chicken' }).g;
  assert.equal(err(g, { type: 'buy_animal', kind: 'chicken' }), 'no_room');
  const [a, b] = g.animals;
  assert.equal(a!.name, '小白');
  // 小雞要 24 小時長大；長大之前收不到東西
  assert.equal(gameView(g, defs, T0).animals[0]!.adult, false);
  const G = T0 + DAY; // 長大的那一刻
  assert.equal(gameView(g, defs, G).animals[0]!.adult, true);
  // 只餵得到第一隻：先把乾草減到 1
  g = { ...g, inventory: { ...g.inventory, hay: 1 } };
  const fed = must(g, { type: 'feed_animals', building: 'coop' }, G);
  assert.ok(fed.e.type === 'animals_fed' && fed.e.count === 1);
  g = fed.g;
  const v = gameView(applyAction(g, { type: 'collect_animals', building: 'coop' }, defs, G + DAY + MIN).game, defs, G + DAY + MIN);
  const col = must(g, { type: 'collect_animals', building: 'coop' }, G + DAY + MIN);
  assert.ok(col.e.type === 'animals_collected');
  assert.equal(Object.values(col.e.items).reduce((x, y) => x + y, 0), 1); // 只有吃飽的那隻
  assert.ok(v.animals.find((x) => x.id === b!.id)!.mood < 60); // 沒吃飽的心情掉了
  // 摸摸：一天一次
  const p = must(col.g, { type: 'pet_animal', animal: a!.id }, G + DAY + MIN);
  assert.equal(err(p.g, { type: 'pet_animal', animal: a!.id }, G + DAY + 2 * MIN), 'already');
  // 升級雞舍：容量 4
  const up = must(p.g, { type: 'upgrade_building', building: 'coop' }, G + DAY + MIN);
  assert.ok(up.e.type === 'building_upgraded' && up.e.capacity === 4);
});

test('動物：心情好時會出高級品；豬心情不夠找不到松露', () => {
  let g = rich({ hay: 100 });
  g = must(g, { type: 'unlock', id: 'coop' }).g;
  g = must(g, { type: 'unlock', id: 'barn' }).g;
  g = must(g, { type: 'buy_animal', kind: 'chicken' }).g;
  g = must(g, { type: 'buy_animal', kind: 'pig' }).g;
  g = { ...g, animals: g.animals.map((x) => (x.kind === 'pig' ? { ...x, bornAt: 0, readyAt: T0, mood: 0 } : { ...x, bornAt: 0, readyAt: T0, mood: 100, friendship: 1000 })) };
  let large = 0;
  let truffles = 0;
  let t = T0;
  for (let day = 0; day < 20; day++) {
    g = must(g, { type: 'feed_animals', building: 'coop' }, t).g;
    g = must(g, { type: 'feed_animals', building: 'barn' }, t).g;
    t += DAY + MIN;
    const r = applyAction(g, { type: 'collect_animals', building: 'coop' }, defs, t);
    if (r.ok && r.event.type === 'animals_collected') large += r.event.items.egg_large ?? 0;
    g = r.game;
    const pr = applyAction(g, { type: 'collect_animals', building: 'barn' }, defs, t);
    if (pr.ok && pr.event.type === 'animals_collected') truffles += pr.event.items.truffle ?? 0;
    g = { ...pr.game, animals: pr.game.animals.map((x) => (x.kind === 'pig' ? { ...x, mood: 0 } : x)) };
  }
  assert.ok(large > 0);
  assert.equal(truffles, 0);
});

test('擺放與裝修：家具擺下去、收回來；擺的田可以種，種了不能收；換地板退回舊的', () => {
  let g = rich({ furn_chair: 1, plot_kit: 1, seed_carrot: 1, floor_blue: 1, floor_check: 1 });
  g = must(g, { type: 'place', scene: 'room', item: 'furn_chair', x: 8, y: 6 }).g;
  assert.equal(g.inventory.furn_chair, undefined);
  assert.equal(err(g, { type: 'place', scene: 'room', item: 'plot_kit', x: 8, y: 6 }), 'plot_busy');
  g = must(g, { type: 'pickup', scene: 'room', x: 8, y: 6 }).g;
  assert.equal(g.inventory.furn_chair, 1);
  g = must(g, { type: 'place', scene: 'ranch', item: 'plot_kit', x: 3, y: 4 }).g;
  const autumn = (() => {
    for (let i = 0; i < 60; i++) if (seasonAt(T0 + i * DAY, defs)!.id === 'autumn') return T0 + i * DAY;
    throw new Error('no autumn');
  })();
  g = must(g, { type: 'plant', plot: 'ranch/placed-3-4', seed: 'seed_carrot' }, autumn).g;
  assert.equal(err(g, { type: 'pickup', scene: 'ranch', x: 3, y: 4 }, autumn), 'plot_busy');
  g = must(g, { type: 'decorate', scene: 'room', item: 'floor_blue' }, autumn).g;
  const d2 = must(g, { type: 'decorate', scene: 'room', item: 'floor_check' }, autumn);
  assert.ok(d2.e.type === 'decorated' && d2.e.returned === 'floor_blue');
  assert.equal(d2.g.inventory.floor_blue, 1);
  assert.deepEqual(d2.g.decor.room, { floor: 'floor_check' });
});

test('溫室：不分季節、不用澆水', () => {
  const winter = (() => {
    for (let i = 0; i < 60; i++) if (seasonAt(T0 + i * DAY, defs)!.id === 'winter') return T0 + i * DAY;
    throw new Error('no winter');
  })();
  let g = rich({ seed_strawberry: 2 });
  assert.equal(err(g, { type: 'plant', plot: 'ranch/plot-1', seed: 'seed_strawberry' }, winter), 'wrong_season');
  g = must(g, { type: 'plant', plot: 'greenhouse/bed-1', seed: 'seed_strawberry' }, winter).g;
  const v = gameView(g, defs, winter + 360 * MIN);
  assert.equal(v.plots['greenhouse/bed-1']!.watered, true);
  assert.equal(v.plots['greenhouse/bed-1']!.ready, true);
});

test('居民：每天第一次聊天加好感；到門檻觸發劇情一次；送禮一天一次、看喜好', () => {
  let g = newGame(T0, defs);
  const t1 = must(g, { type: 'talk', npc: 'fisher' });
  assert.ok(t1.e.type === 'talked' && t1.e.gain === 20);
  const t2 = must(t1.g, { type: 'talk', npc: 'fisher' }, T0 + MIN);
  assert.ok(t2.e.type === 'talked' && t2.e.gain === 0);
  g = { ...t2.g, inventory: { fish_lobster: 2, junk_can: 1 } };
  const gift = must(g, { type: 'gift', npc: 'fisher', item: 'fish_lobster' }, T0 + MIN);
  assert.ok(gift.e.type === 'gifted' && gift.e.reaction === 'love' && gift.e.gain === 80);
  assert.equal(err(gift.g, { type: 'gift', npc: 'fisher', item: 'junk_can' }, T0 + 2 * MIN), 'too_soon');
  // 好感到 200：下一次聊天觸發劇情，之後不再觸發
  g = { ...gift.g, npcs: { ...gift.g.npcs, fisher: { ...gift.g.npcs.fisher!, friendship: 190 } } };
  const ev = must(g, { type: 'talk', npc: 'fisher' }, T0 + DAY);
  assert.ok(ev.e.type === 'talked' && ev.e.event?.id === 'fisher-1');
  const ev2 = must(ev.g, { type: 'talk', npc: 'fisher' }, T0 + 2 * DAY);
  assert.ok(ev2.e.type === 'talked' && ev2.e.event === undefined);
  assert.equal(gameView(ev2.g, defs, T0 + 2 * DAY).npcs.fisher!.hearts, 2);
});

test('結婚：好感不夠不行；送藍色貝殼成功；隔天她會幫忙澆水', () => {
  let g: GameState = { ...newGame(T0, defs), inventory: { item_blue_shell: 1, seed_carrot: 1 }, affection: 499 };
  assert.equal(err(g, { type: 'propose' }), 'locked');
  g = { ...g, affection: 500 }; // V0.19：求婚門檻 300 → 500
  assert.equal(gameView(g, defs, T0).canPropose, true);
  g = must(g, { type: 'propose' }).g;
  const v = gameView(g, defs, T0);
  assert.equal(v.married, true);
  assert.equal(v.level, '伴侶');
  const sunny = (() => {
    for (let i = 1; i < 60; i++) {
      const t = T0 + i * DAY;
      if (weatherAt(t, defs) === 'sunny' && seasonAt(t, defs)!.id === 'autumn') return t;
    }
    throw new Error('no sunny autumn');
  })();
  g = { ...g, affectionToday: { day: 'old', gained: 0 }, lastTickAt: sunny - MIN };
  g = must(g, { type: 'plant', plot: 'garden/plot-1', seed: 'seed_carrot' }, sunny - MIN).g;
  // 「跨日」：把 affectionToday 設成昨天
  g = { ...g, affectionToday: { day: 'yesterday', gained: 0 } };
  const next = applyAction(g, { type: 'talk', npc: 'fisher' }, defs, sunny).game;
  const nv = gameView(next, defs, sunny);
  assert.ok(nv.help && nv.help.watered >= 1);
  assert.equal(nv.plots['garden/plot-1']!.watered, true);
});

test('礦洞派遣：要鎬子、去的時候不能釣魚、時間到帶回報告、最深紀錄更新', () => {
  let g = newGame(T0, defs);
  assert.equal(err(g, { type: 'mine_start', floor: 1 }), 'weak_pickaxe');
  assert.equal(err(g, { type: 'mine_start', floor: 2 }), 'too_deep');
  g = { ...g, inventory: { pickaxe_basic: 1, sword_iron: 1, armor_iron: 1 } };
  const s = must(g, { type: 'mine_start', floor: 1 });
  assert.equal(err(s.g, { type: 'fish', table: 'pond' }), 'away');
  assert.equal(err(s.g, { type: 'mine_collect' }, T0 + 29 * MIN), 'not_ready');
  const c = must(s.g, { type: 'mine_collect' }, T0 + 30 * MIN);
  assert.ok(c.e.type === 'mine_returned');
  assert.equal(c.e.report.injured, false);
  assert.ok(c.e.report.kills.length > 0);
  assert.ok(Object.keys(c.e.report.items).length > 0);
  assert.equal(c.g.mine.deepest, 1);
  assert.equal(c.g.mine.trip, null);
  // 中層要銅鎬子
  g = { ...c.g, mine: { deepest: 5, trip: null }, stamina: 100 };
  assert.equal(err(g, { type: 'mine_start', floor: 6 }, T0 + 31 * MIN), 'weak_pickaxe');
});

test('礦洞派遣：沒裝備去深層會受傷，體力歸零、戰利品減半、紀錄不更新', () => {
  let g: GameState = { ...newGame(T0, defs), inventory: { pickaxe_gold: 1 }, mine: { deepest: 15, trip: null } };
  g = must(g, { type: 'mine_start', floor: 16 }).g;
  const c = must(g, { type: 'mine_collect' }, T0 + 200 * MIN);
  assert.ok(c.e.type === 'mine_returned' && c.e.report.injured);
  assert.equal(c.g.stamina, 0);
  assert.equal(c.g.mine.deepest, 15);
});

test('即時戰鬥的戰利品：只收這層可能掉的東西、有上限、死掉減半', () => {
  const g = newGame(T0, defs);
  const r = must(g, { type: 'mine_loot', floor: 2, items: { ore_copper: 50, gem_diamond: 3, drop_slime: 4 }, kills: 3, died: false });
  assert.ok(r.e.type === 'mine_returned');
  assert.deepEqual(r.e.report.items, { ore_copper: 20, drop_slime: 4 });
  assert.equal(r.g.mine.deepest, 2);
  const d = must(g, { type: 'mine_loot', floor: 1, items: { ore_copper: 9 }, kills: 1, died: true });
  assert.ok(d.e.type === 'mine_returned');
  assert.deepEqual(d.e.report.items, { ore_copper: 4 });
  assert.equal(err(g, { type: 'mine_loot', floor: 9, items: {}, kills: 0, died: false }), 'too_deep');
});

test('禮物碼：寄出扣東西；別的存檔收得到、只能收一次；改過的碼無效', () => {
  const a: GameState = { ...newGame(T0, defs), inventory: { fish_bass: 5 } };
  const sent = must(a, { type: 'gift_send', item: 'fish_bass', count: 3 });
  assert.ok(sent.e.type === 'gift_code');
  const code = sent.e.code;
  assert.equal(sent.g.inventory.fish_bass, 2);
  assert.deepEqual(decodeGift(code, file.gifts!.salt)?.item, 'fish_bass');
  const b = newGame(T0 + 1, defs, 99);
  const got = must(b, { type: 'gift_redeem', code });
  assert.equal(got.g.inventory.fish_bass, 3);
  assert.equal(err(got.g, { type: 'gift_redeem', code }), 'already');
  assert.equal(err(sent.g, { type: 'gift_redeem', code }), 'already'); // 寄件人不能自己收回
  const tampered = code.replace(/-[0-9a-z]+$/, '-abc');
  assert.equal(err(b, { type: 'gift_redeem', code: tampered }), 'bad_code');
});

test('節慶：當天才有限定商品和限定魚', () => {
  let fest = 0;
  for (let i = 0; i < 60 && !fest; i++) if (festivalAt(T0 + i * DAY, defs)?.id === 'flower') fest = T0 + i * DAY;
  assert.ok(fest);
  assert.equal(gameView(newGame(fest, defs), defs, fest).festival?.name, '花祭');
  const g = rich();
  assert.equal(err(g, { type: 'trade', shop: 'merchant', trade: 'fest-sakura' }, fest + DAY), 'not_today');
  assert.ok(must(g, { type: 'trade', shop: 'merchant', trade: 'fest-sakura' }, fest).g.inventory.furn_sakura);
  const ice = file.fishing.tables.pond!.find((e) => e.item === 'fish_icefish')!;
  assert.equal(lootAvailable(ice, { phase: 'afternoon', affection: 0, festival: 'icefish' }), true);
  assert.equal(lootAvailable(ice, { phase: 'afternoon', affection: 0 }), false);
});

test('舊存檔（V0.3）讀得進來，新欄位補預設值', () => {
  const old = { ...newGame(T0, defs) } as Record<string, unknown>;
  for (const k of ['unlocked', 'machines', 'animals', 'placed', 'npcs', 'mine', 'redeemed', 'buildingLevels']) delete old[k];
  const g = normalizeGame(old, T0, defs);
  assert.deepEqual(g.animals, []);
  assert.deepEqual(g.mine, { deepest: 0, trip: null });
  assert.equal(g.nextAnimalId, 1);
  assert.equal(gameView(g, defs, T0).married, false);
});

test('mod：可以加居民、節慶、機器、動物', () => {
  const mod = {
    version: 1 as const,
    items: [{ id: 'goat_milk', name: '羊奶', emoji: '🥛', category: 'animal', price: 200 }],
    npcs: { baker: { name: '麵包師', emoji: '🧑‍🍳', lines: [{ text: '麵包出爐囉！' }] } },
    festivals: [{ id: 'moon', name: '月見祭', emoji: '🌕', season: 'autumn', day: 6 }],
    machines: { oven: { name: '烤箱', emoji: '🍞', recipes: [{ id: 'bread', give: { crop_pumpkin: 1 }, get: { food_pie: 1 }, minutes: 30 }] } },
    animals: { goat: { name: '山羊', emoji: '🐐', building: 'barn', price: { coin: 2000 }, product: 'goat_milk', hours: 24, feed: 'hay' } },
  };
  const { file: merged, warnings } = mergeGameplay(file, [{ name: 'farm-plus.json', data: mod }]);
  assert.deepEqual(warnings, []);
  assert.ok(merged.npcs?.baker && merged.machines?.oven && merged.animals?.goat);
  assert.ok(merged.calendar?.festivals?.some((f) => f.id === 'moon'));
  const bad = { version: 1 as const, animals: { ghost: { name: '幽靈牛', emoji: '👻', building: 'nowhere', price: {}, product: 'milk', hours: 1, feed: 'hay' } } };
  assert.match(mergeGameplay(file, [{ name: 'bad.json', data: bad }]).warnings[0]!, /bad\.json 已略過/);
});
