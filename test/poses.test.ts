// V0.15：自己一張圖的動作（酒館坐著喝、浴池游泳）
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACK_DIR } from './pack-gameplay.ts';
import { validatePixelPack } from '../src/shared/pixel-validate.ts';
import type { PixelCharacterFile, PixelWorldFile } from '../src/shared/pixel-types.ts';
import type { InteractablesFile } from '../src/shared/hotspots.ts';

const ch = JSON.parse(await readFile(join(PACK_DIR, 'character.json'), 'utf8')) as PixelCharacterFile;
const world = JSON.parse(await readFile(join(PACK_DIR, 'scenes.json'), 'utf8')) as PixelWorldFile;

test('酒館坐姿、游泳：動作有自己的圖，圖檔在、大小跟設定一樣', async () => {
  for (const name of ['tavern_sit', 'swim']) {
    const c = ch.actions!.clips[name]!;
    assert.ok(c.sheet, name);
    assert.ok((await stat(join(PACK_DIR, c.sheet!.src))).size > 0);
    assert.equal(c.loop, 0, `${name} 要一直維持`);
  }
  assert.deepEqual(ch.actions!.clips.swim!.frames, [0, 1]);
});

test('酒館的餐桌坐下用酒館坐姿；浴池旁的地點會下水游泳', async () => {
  const ia = JSON.parse(await readFile(join(PACK_DIR, 'interactables.json'), 'utf8')) as InteractablesFile;
  const tables = ia.scenes.tavern!.hotspots.filter((h) => h.id.startsWith('table-'));
  assert.equal(tables.length, 4);
  for (const h of tables) assert.equal(h.pose, 'tavern_sit');
  assert.equal(ia.scenes.bath!.spots!.tub!.action, 'swim');
  // V0.16：她平常坐的位置都是餐桌的椅子（seat），不再有多出來的吧台前、壁爐前的位置
  assert.equal(ia.scenes.tavern!.spots!.stool, undefined);
  assert.equal(ia.scenes.tavern!.spots!.fire, undefined);
  for (const sp of Object.values(ia.scenes.tavern!.spots!)) if (sp.action === 'tavern_sit') assert.ok(sp.seat, '坐下的地點要有 seat');
});

test('動作的 sheet 寫錯會被抓到', () => {
  const bad = structuredClone(ch);
  bad.actions!.clips.swim!.sheet = { src: '', frameWidth: 0, frameHeight: 10, footY: 20 };
  assert.ok(validatePixelPack(world, bad, {}).some((e) => e.includes('swim 的 sheet')));
});
