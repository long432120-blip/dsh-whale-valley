// V0.9：背景圖場景＋互動熱區（interactables.json）
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildBackgroundMap, hotspotAt, imgToMap, reachedTarget, validateInteractables, type BackgroundScene, type InteractablesFile } from '../src/shared/hotspots.ts';
import { distances } from '../src/shared/path.ts';

const root = join(import.meta.dirname, '..');
const file = JSON.parse(await readFile(join(root, 'packs/whale-girl-pixel/interactables.json'), 'utf8')) as InteractablesFile;
const room = file.scenes.room!;

/** 一個 100×80 的小房間：地板在下半部，床擋路、地毯不擋 */
const tiny: BackgroundScene = {
  image: 'x.webp',
  imageSize: { w: 100, h: 80 },
  tiles: { w: 5, h: 4 },
  floor: [{ x: 0, y: 20, w: 100, h: 60 }],
  spawns: { default: { x: 50, y: 70 } },
  hotspots: [
    { id: 'bed', name: '床', rect: { x: 0, y: 20, w: 40, h: 20 }, stand: { x: 50, y: 30 }, action: { type: 'sleep' } },
    { id: 'rug', name: '地毯', rect: { x: 40, y: 60, w: 60, h: 20 }, blocks: false, action: { type: 'show_dialogue', lines: ['軟軟的'] } },
    { id: 'pillow', name: '枕頭', rect: { x: 5, y: 22, w: 10, h: 8 }, action: { type: 'show_dialogue', lines: ['好香'] } },
    { id: 'door', name: '門', rect: { x: 80, y: 20, w: 20, h: 20 }, stand: { x: 90, y: 30 }, action: { type: 'door', to: 'garden', spawn: 'fromRoom' } },
  ],
};

test('座標換算：原圖像素 ↔ 地圖像素 ↔ 格子', () => {
  const c = imgToMap(tiny, 16);
  assert.equal(c.sx, 0.8); // 5 格 × 16 / 100
  assert.deepEqual(c.point({ x: 50, y: 40 }), { x: 40, y: 32 });
  assert.deepEqual(c.tile({ x: 50, y: 70 }), { x: 2, y: 3 });
  assert.deepEqual(c.tileRect({ x: 0, y: 20, w: 40, h: 20 }), { x: 0, y: 1, w: 2, h: 1 });
  assert.deepEqual(c.tile({ x: 999, y: -5 }), { x: 4, y: 0 }); // 超出範圍夾回地圖裡
});

test('點擊判定：範圍內才算；重疊時取面積小的（點得到床上的枕頭）', () => {
  assert.equal(hotspotAt(tiny, { x: 30, y: 30 })?.id, 'bed');
  assert.equal(hotspotAt(tiny, { x: 8, y: 25 })?.id, 'pillow');
  assert.equal(hotspotAt(tiny, { x: 50, y: 70 })?.id, 'rug');
  assert.equal(hotspotAt(tiny, { x: 50, y: 5 }), null);
  assert.equal(hotspotAt(tiny, { x: 40, y: 30 }), null); // 右緣不含
});

test('換算成格子地圖：地板能走、床擋路、地毯不擋；床 → kind bed、門 → doors', () => {
  const m = buildBackgroundMap(tiny, 16);
  assert.equal(m.width, 5);
  const walk = (x: number, y: number) => !m.blocked[y * 5 + x];
  assert.ok(!walk(2, 0)); // 牆（不是地板）
  assert.ok(!walk(0, 1)); // 床
  assert.ok(walk(2, 3)); // 地毯可以走
  assert.equal(m.interactables.find((i) => i.id === 'bed')?.kind, 'bed');
  assert.equal(m.interactables.find((i) => i.id === 'rug')?.kind, 'hotspot');
  const door = m.doors[0]!;
  assert.equal(door.to, 'garden');
  assert.deepEqual(door.rect, { x: door.stand!.x, y: door.stand!.y, w: 1, h: 1 }); // 只有站位那一格算「踩到出門」
  assert.deepEqual(m.spawns.default!.tile, { x: 2, y: 3 });
  assert.equal(m.background?.image, 'x.webp');
});

test('站位：指定了就要站在那一格；沒指定就是緊貼範圍', () => {
  const m = buildBackgroundMap(tiny, 16);
  const bed = m.interactables.find((i) => i.id === 'bed')!;
  assert.ok(bed.standFixed);
  assert.deepEqual(bed.stands, [{ x: 2, y: 1 }]);
  assert.ok(reachedTarget({ x: 2, y: 1 }, bed));
  assert.ok(!reachedTarget({ x: 2, y: 2 }, bed)); // 也緊貼床，但不是指定的站位
  const rug = m.interactables.find((i) => i.id === 'rug')!;
  assert.ok(!rug.standFixed);
  assert.ok(reachedTarget({ x: 2, y: 2 }, rug)); // 緊貼地毯上緣
});

test('站位量歪了（落在家具上）：自動改到最近能走的格子', () => {
  const bg: BackgroundScene = { ...tiny, hotspots: [{ ...tiny.hotspots[0]!, stand: { x: 10, y: 30 } }] };
  const m = buildBackgroundMap(bg, 16);
  const s = m.interactables[0]!.stands[0]!;
  assert.ok(!m.blocked[s.y * 5 + s.x]);
});

test('鯨魚娘的房間：每個熱區、門都從出生點走得到', () => {
  const m = buildBackgroundMap(room, 16);
  const dist = distances(m, m.spawns.default!.tile);
  const reach = (t: { x: number; y: number }) => Number.isFinite(dist[t.y * m.width + t.x]!);
  for (const it of m.interactables) {
    if (it.hotspot?.approach === 'none') continue;
    assert.ok(it.stands.length && it.stands.every(reach), `${it.id} 走不到`);
  }
  for (const d of m.doors) assert.ok(d.stand && reach(d.stand), `門 ${d.id} 走不到`);
  for (const [k, s] of Object.entries(m.spots)) assert.ok(reach(s.tile), `地點 ${k} 走不到`);
  // 需求：床 → 睡覺、沙發几 → 吃東西＋坐下、水族箱與書架 → 圖鑑
  const by = (id: string) => room.hotspots.find((h) => h.id === id)!;
  assert.equal(by('bed').action.type, 'sleep');
  assert.equal(by('sofa').action.type, 'eat');
  assert.equal(by('sofa').pose, 'sit');
  assert.deepEqual(by('aquarium').action, { type: 'open_ui', ui: 'codex' });
  assert.deepEqual(by('bookshelf').action, { type: 'open_ui', ui: 'codex' });
  // 原作息會去的地點都還在
  for (const k of ['window', 'bed', 'rug', 'table', 'plant']) assert.ok(m.spots[k], `少了地點 ${k}`);
  for (const k of ['default', 'fromGarden', 'fromAttic']) assert.ok(m.spawns[k], `少了出生點 ${k}`);
});

test('檢查 interactables.json：角色包的版本沒問題；常見錯誤會被抓出來', () => {
  const ctx = { scenes: ['room', 'garden', 'attic', 'kitchen', 'bath', 'gameroom', 'tavern', 'town'], clips: ['sit', 'sleepy', 'happy', 'tavern_sit', 'swim'], shops: ['kitchen', 'tavern'], unlocks: ['house_upgrade'], games: ['console', 'arcade'], taps: ['tap'] };
  assert.deepEqual(validateInteractables(file, ctx), []);
  const bad: InteractablesFile = {
    version: 1,
    scenes: {
      room: {
        ...tiny,
        tiles: { w: 20, h: 4 },
        hotspots: [
          { id: 'a', name: 'A', rect: { x: 90, y: 70, w: 50, h: 50 }, action: { type: 'open_ui', ui: 'nope' as 'bag' } },
          { id: 'a', name: 'B', rect: { x: 0, y: 20, w: 10, h: 10 }, pose: 'dance', action: { type: 'show_dialogue', lines: [] } },
          { id: 'c', name: 'C', rect: { x: 0, y: 20, w: 10, h: 10 }, action: { type: 'door', to: 'moon' } },
        ],
      },
    },
  };
  const errs = validateInteractables(bad, ctx).join('\n');
  for (const s of ['寬高比', '超出原圖', 'open_ui 的 ui', '重複', 'show_dialogue 要有 lines', '沒有動作 dance', '不存在的場景 moon']) {
    assert.ok(errs.includes(s), `應該抓到「${s}」`);
  }
  assert.deepEqual(validateInteractables({ version: 2 }), ['interactables.json：要有 version: 1 和 scenes']);
});
