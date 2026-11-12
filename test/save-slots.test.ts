// V0.23：存檔格（3 格）與開新遊戲
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalBridge } from '../src/client/bridge-local.ts';
import { handleBridgeCall, BadRequest, type PetApi } from '../src/host/routes.ts';
import { parseSlotFile, SLOT_COUNT, validSlot } from '../src/shared/save-slots.ts';
import { packGameplay } from './pack-gameplay.ts';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _map: m,
  };
}

test('存檔格：存、讀、刪、開新遊戲；讀檔和開新遊戲前會備份目前進度', async () => {
  const store = memoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = store;
  try {
    const b = new LocalBridge('t', 'room', await packGameplay());
    await b.visit();
    let list = await b.slots.list();
    assert.equal(list.length, SLOT_COUNT);
    assert.ok(list.every((s) => s.empty));

    // 動一下存檔（戳她一下），存到第 1 格
    await b.poke();
    await b.poke();
    list = await b.slots.save(1);
    assert.equal(list[0]!.empty, false);
    assert.ok(list[0]!.summary && list[0]!.savedAt);
    const pokesAtSave = (await b.getView()).pokes;

    // 再戳幾下，讀回第 1 格 → 回到存檔時的樣子
    await b.poke();
    await b.poke();
    assert.equal((await b.getView()).pokes, pokesAtSave + 2);
    const v = await b.slots.load(1);
    assert.equal(v.pokes, pokesAtSave);
    assert.ok(store.getItem('t:backup'), '讀檔前備份了目前進度');

    // 開新遊戲：進度歸零、存檔格還在
    const fresh = await b.slots.newGame();
    assert.equal(fresh.pokes, 0);
    assert.equal((await b.slots.list())[0]!.empty, false, '開新遊戲不會清掉存檔格');

    // 刪除
    list = await b.slots.remove(1);
    assert.ok(list[0]!.empty);

    // 壞掉的格子：當作壞掉，不能讀，但不會讓遊戲當掉
    store.setItem('t:slot:2', '{"version":1,"savedAt":1,"save":{"version":99}}');
    list = await b.slots.list();
    assert.equal(list[1]!.broken, true);
    await assert.rejects(() => b.slots.load(2));
    await assert.rejects(() => b.slots.load(3), '空的格子不能讀');
    await assert.rejects(() => b.slots.save(4), '只有 1～3 格');
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('存檔格檔案格式檢查', () => {
  assert.equal(parseSlotFile('not json'), null);
  assert.equal(parseSlotFile({ version: 2, savedAt: 1, save: { version: 2 } }), null);
  assert.equal(parseSlotFile({ version: 1, savedAt: 'x', save: { version: 2 } }), null);
  assert.ok(parseSlotFile({ version: 1, savedAt: 1, save: { version: 2 } }));
  assert.equal(validSlot(0), false);
  assert.equal(validSlot(1.5), false);
  assert.equal(validSlot('1'), false);
  assert.equal(validSlot(3), true);
});

test('host 通道：slot 參數要是 1～3；沒有存檔格功能的 host 回 400；空格子回 400 不是 500', async () => {
  const calls: string[] = [];
  const api = {
    visit: async () => ({}), getView: async () => ({}), setScene: async () => ({}), poke: async () => ({}),
    act: async () => ({}), gameplay: async () => null,
    slotList: async () => (calls.push('list'), []),
    slotSave: async (n: number) => (calls.push(`save${n}`), []),
    slotLoad: async (n: number) => { calls.push(`load${n}`); throw new Error('empty slot'); },
    slotRemove: async (n: number) => (calls.push(`remove${n}`), []),
    newGame: async () => (calls.push('new'), {}),
  } as unknown as PetApi;
  await handleBridgeCall(api, 'slotList', {});
  await handleBridgeCall(api, 'slotSave', { slot: 2 });
  await handleBridgeCall(api, 'slotRemove', { slot: 3 });
  await handleBridgeCall(api, 'newGame', {});
  await assert.rejects(() => handleBridgeCall(api, 'slotSave', { slot: 9 }), BadRequest);
  await assert.rejects(() => handleBridgeCall(api, 'slotSave', { slot: '1' }), BadRequest);
  await assert.rejects(() => handleBridgeCall(api, 'slotLoad', { slot: 1 }), BadRequest);
  assert.deepEqual(calls, ['list', 'save2', 'remove3', 'new', 'load1']);
  const old = { visit: async () => ({}) } as unknown as PetApi;
  await assert.rejects(() => handleBridgeCall(old, 'slotList', {}), BadRequest);
});
