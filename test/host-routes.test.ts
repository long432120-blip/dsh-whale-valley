// 擴展 E1：host 對外入口（不需要 DSH 就能測）
import assert from 'node:assert/strict';
import { packGameplay } from './pack-gameplay.ts';
import { test } from 'node:test';
import { LocalBridge } from '../src/client/bridge-local.ts';
import type { GameplayFile } from '../src/shared/gameplay-types.ts';
import { BadRequest, handleBridgeCall, whalePetTools, type PetApi } from '../src/host/routes.ts';

const file: GameplayFile = await packGameplay();

/** 用 LocalBridge（同一套規則）當假的 service；Node 沒有 localStorage，補一個 */
function fakeApi(): PetApi {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  };
  return new LocalBridge('t', 'room', file);
}

test('handleBridgeCall：只認六個方法、檢查參數格式', async () => {
  const api = fakeApi();
  const v = (await handleBridgeCall(api, 'visit', {})) as { sceneId: string };
  assert.equal(v.sceneId, 'room');
  await assert.rejects(handleBridgeCall(api, 'deleteEverything', {}), BadRequest);
  await assert.rejects(handleBridgeCall(api, 'setScene', { sceneId: 3 }), BadRequest);
  await assert.rejects(handleBridgeCall(api, 'act', { action: { foo: 1 } }), BadRequest);
  const r = (await handleBridgeCall(api, 'act', { action: { type: 'feed', item: 'nothing' } })) as { ok: boolean };
  assert.equal(r.ok, false); // 規則層擋下，不會壞檔
  const moved = (await handleBridgeCall(api, 'setScene', { sceneId: 'garden' })) as { sceneId: string };
  assert.equal(moved.sceneId, 'garden');
});

test('tool：whale_pet_status 回傳摘要；whale_pet_act 只做餵食、澆水、收成', async () => {
  const api = fakeApi();
  const [status, act] = whalePetTools(api);
  const text = await status!.handler({});
  assert.match(text, /體力 \d+\/100/);
  assert.match(text, /好感 0/);
  assert.match(await act!.handler({ action: 'sell', item: 'coin' }), /參數不對/);
  assert.match(await act!.handler({ action: 'feed', item: 'fish_bass' }), /沒有成功（no_item）/);
});
