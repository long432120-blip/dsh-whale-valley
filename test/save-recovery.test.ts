// V0.21：存檔防崩潰、防手改
//  - 壞掉的 JSON、看不懂的版本 → 備份原始內容、開新遊戲、提醒玩家一次
//  - 欄位亂掉 → 逐欄位補預設值，規則層不丟例外（模糊測試）
//  - 手改數值 → 揹包只留認得的物品、取整數、設上限；好感設上限
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalBridge } from '../src/client/bridge-local.ts';
import { buildDefs, MAX_AFFECTION, MAX_COINS, MAX_STACK, normalizeGame } from '../src/shared/gameplay.ts';
import * as rules from '../src/shared/state.ts';
import { packGameplay } from './pack-gameplay.ts';

const file = await packGameplay();
const defs = buildDefs(file);
const KEY = 'test:save';
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};
const bridge = () => new LocalBridge(KEY, 'room', file);

test('沒有存檔：開新遊戲，不提醒', async () => {
  mem.clear();
  const b = bridge();
  const v = await b.visit();
  assert.ok(v.game);
  assert.equal(b.takeNotice(), null);
  assert.equal(JSON.parse(mem.get(KEY)!).version, 2, '存檔帶版本號');
});

for (const [name, text] of [
  ['JSON 壞掉', '{"version":2,"game":{'],
  ['不是物件', '"hello"'],
  ['陣列', '[1,2,3]'],
  ['看不懂的版本（例如更新版本的存檔）', '{"version":99,"game":{}}'],
  ['沒有版本號', '{"sceneId":"room"}'],
] as const) {
  test(`存檔${name}：備份原始內容、開新遊戲、只提醒一次`, async () => {
    mem.clear();
    mem.set(KEY, text);
    const b = bridge();
    const v = await b.visit();
    assert.ok(v.game, '照樣能玩');
    assert.equal(mem.get(`${KEY}:backup`), text, '原始內容備份起來');
    assert.match(b.takeNotice() ?? '', /備份/);
    assert.equal(b.takeNotice(), null, '提醒只出現一次');
    await b.act({ type: 'sleep' } as never).catch(() => undefined);
    assert.equal(b.takeNotice(), null, '新存檔寫好後不會再提醒');
    assert.equal(JSON.parse(mem.get(KEY)!).version, 2);
  });
}

test('正常存檔：照常讀取，不備份', async () => {
  mem.clear();
  const b1 = bridge();
  await b1.visit();
  await b1.setScene('garden');
  const b2 = bridge();
  const v = await b2.getView();
  assert.equal(v.sceneId, 'garden');
  assert.equal(mem.has(`${KEY}:backup`), false);
  assert.equal(b2.takeNotice(), null);
});

test('每個動作當下就存檔（換場景、玩法動作）', async () => {
  mem.clear();
  const b = bridge();
  await b.visit();
  const before = mem.get(KEY);
  await b.setScene('garden');
  assert.notEqual(mem.get(KEY), before, '換場景後存檔已經更新');
  assert.equal(JSON.parse(mem.get(KEY)!).sceneId, 'garden');
});

test('重新開始：先備份目前的存檔', async () => {
  mem.clear();
  const b = bridge();
  await b.visit();
  const text = mem.get(KEY);
  b.debugReset();
  assert.equal(mem.has(KEY), false);
  assert.equal(mem.get(`${KEY}:backup`), text);
});

test('手改數值：揹包只留認得的物品、取整數、設上限；好感設上限', () => {
  const now = Date.UTC(2026, 10, 12, 6);
  const g = rules.migrate(null, now, 'room', defs).game as unknown as Record<string, unknown>;
  const n = normalizeGame({
    ...g,
    inventory: { coin: 1e15, fish_carp: -5, not_an_item: 99, seed_carrot: 2.7, food_pancake: '9', seed_strawberry: 1e9 },
    affection: 1e9, stamina: 5000, satiety: -40,
  }, now, defs);
  assert.equal(n.inventory.coin, MAX_COINS);
  assert.equal(n.inventory.seed_carrot, 2);
  assert.equal(n.inventory.seed_strawberry, MAX_STACK);
  assert.equal('not_an_item' in n.inventory, false);
  assert.equal('fish_carp' in n.inventory, false);
  assert.equal('food_pancake' in n.inventory, false, '字串數量不算');
  assert.equal(n.affection, MAX_AFFECTION);
  assert.ok(n.stamina <= 100 && n.satiety >= 0);
});

test('模糊測試：隨機弄壞存檔 1500 次，讀檔、結算、動作都不丟例外', () => {
  const now = Date.UTC(2026, 10, 12, 6);
  const base = rules.migrate(null, now, 'room', defs);
  const junk: unknown[] = [null, 0, -1, 1e308, '', 'abc', [], [1, 'x', null], {}, { a: 1 }, true];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const mutate = (o: unknown, depth = 0): unknown => {
    if (o === null || typeof o !== 'object') return rnd() < 0.3 ? junk[Math.floor(rnd() * junk.length)] : o;
    const c: Record<string, unknown> = Array.isArray(o) ? ([...o] as never) : { ...(o as Record<string, unknown>) };
    for (const k of Object.keys(c)) {
      const r = rnd();
      if (r < 0.15) c[k] = junk[Math.floor(rnd() * junk.length)];
      else if (r < 0.2) delete c[k];
      else if (depth < 4) c[k] = mutate(c[k], depth + 1);
    }
    return c;
  };
  for (let i = 0; i < 1500; i++) {
    const raw = JSON.parse(JSON.stringify(mutate(JSON.parse(JSON.stringify(base)))) ?? 'null');
    const s = rules.migrate(raw, now, 'room', defs);
    const t = rules.tick(s, now + 3_600_000, defs);
    rules.toView(t, now + 3_600_000, 0, defs);
    rules.visit(t, now + 7_200_000, defs);
    for (const a of [{ type: 'feed', item: 'food_pancake' }, { type: 'sleep' }, { type: 'sell', item: 'fish_carp', qty: 1 }]) {
      rules.act(t, a as never, now + 7_200_000, defs);
    }
  }
});
