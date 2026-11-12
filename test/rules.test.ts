import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { pickLine } from '../src/shared/lines.ts';
import * as rules from '../src/shared/state.ts';
import type { CharacterFile, ScenesFile } from '../src/shared/types.ts';
import { validatePack } from '../src/shared/validate.ts';

const T0 = new Date(2026, 10, 9, 9, 0).getTime(); // 本機時間早上 9 點
const MIN = 60_000;

test('visit：算出離開幾分鐘，並更新 lastSeenAt', () => {
  const s = rules.createSave(T0, 'room');
  const { next, view } = rules.visit(s, T0 + 185 * MIN);
  assert.equal(view.awayMinutes, 185);
  assert.equal(next.lastSeenAt, T0 + 185 * MIN);
  assert.equal(rules.visit(next, T0 + 186 * MIN).view.awayMinutes, 1);
});

test('dayPhase：時段邊界', () => {
  const at = (h: number) => rules.dayPhase(new Date(2026, 10, 9, h, 0).getTime());
  assert.deepEqual([at(4), at(5), at(11), at(17), at(20)], ['night', 'morning', 'afternoon', 'evening', 'night']);
});

test('setScene：格式不對就拒絕；host 不需要認識角色包', () => {
  const s = rules.createSave(T0, 'room');
  assert.equal(rules.setScene(s, 'garden', T0).sceneId, 'garden');
  assert.throws(() => rules.setScene(s, '../etc', T0));
});

test('migrate：壞資料重建、缺欄位補預設', () => {
  assert.equal(rules.migrate(null, T0, 'room').sceneId, 'room');
  assert.equal(rules.migrate({ version: 1, sceneId: 'garden', pokes: 'x' }, T0, 'room').pokes, 0);
});

test('pickLine：依觸發、場景、時段過濾，並避開上一句', () => {
  const lines = [
    { text: 'A' },
    { text: 'B', scenes: ['garden'] },
    { text: 'C', phases: ['night' as const] },
    { text: 'D', on: ['enter' as const], scenes: ['garden'] },
  ];
  const ctx = { trigger: 'click' as const, sceneId: 'room', phase: 'morning' as const };
  assert.equal(pickLine(lines, ctx, () => 0), 'A');
  assert.equal(pickLine(lines, { ...ctx, sceneId: 'garden' }, () => 0.99, undefined), 'B');
  assert.equal(pickLine(lines, { ...ctx, sceneId: 'garden' }, () => 0, 'A'), 'B');
  assert.equal(pickLine(lines, { ...ctx, trigger: 'enter', sceneId: 'garden' }, () => 0), 'D');
  assert.equal(pickLine(lines, { ...ctx, trigger: 'welcome' }, () => 0), null);
});

test('內附角色包通過檢查', async () => {
  const dir = join(import.meta.dirname, '..', 'packs', 'whale-girl');
  const scenes = JSON.parse(await readFile(join(dir, 'scenes.json'), 'utf8')) as ScenesFile;
  const ch = JSON.parse(await readFile(join(dir, 'character.json'), 'utf8')) as CharacterFile;
  assert.deepEqual(validatePack(scenes, ch), []);
});

test('validatePack：抓得到斷掉的門', async () => {
  const dir = join(import.meta.dirname, '..', 'packs', 'whale-girl');
  const scenes = JSON.parse(await readFile(join(dir, 'scenes.json'), 'utf8')) as ScenesFile;
  const ch = JSON.parse(await readFile(join(dir, 'character.json'), 'utf8')) as CharacterFile;
  scenes.scenes[0]!.hotspots[0]!.action.scene = 'kitchen';
  assert.match(validatePack(scenes, ch).join('\n'), /kitchen/);
});

test('cssUrl：data URL 裡的引號要跳脫，不然背景會整個消失', async () => {
  const { cssUrl } = await import('../src/client/stage.ts');
  assert.equal(cssUrl('data:image/svg+xml,<svg a="1">'), 'url("data:image/svg+xml,<svg a=\\22 1\\22 >")');
  assert.equal(cssUrl('assets/room.svg'), 'url("assets/room.svg")');
});
