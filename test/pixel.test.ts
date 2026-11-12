import assert from 'node:assert/strict';
import { buildBackgroundMap, type InteractablesFile } from '../src/shared/hotspots.ts';
import { packGameplay } from './pack-gameplay.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { distances, findPath, reachable } from '../src/shared/path.ts';
import { pickLineDef } from '../src/shared/lines.ts';
import type { GameplayFile } from '../src/shared/gameplay-types.ts';
import type { MapModel, PixelCharacterFile, PixelWorldFile } from '../src/shared/pixel-types.ts';
import { validatePixelPack } from '../src/shared/pixel-validate.ts';
import { pickDestination, scheduledScene } from '../src/shared/schedule.ts';
import { faceToward, isNear, joinPath, parseTiledMap, standTiles, tilesetSource, type TiledMapJson, type TiledTilesetJson } from '../src/shared/tiled.ts';

const PACK = join(import.meta.dirname, '..', 'packs', 'whale-girl-pixel');
const readJson = async <T>(p: string) => JSON.parse(await readFile(join(PACK, p), 'utf8')) as T;

async function loadPack() {
  const world = await readJson<PixelWorldFile>('scenes.json');
  const ch = await readJson<PixelCharacterFile>('character.json');
  const maps: Record<string, MapModel> = {};
  for (const s of world.scenes) {
    if (!s.map) continue; // V0.11：只有背景圖的場景
    const tmj = await readJson<TiledMapJson>(s.map);
    const tsPath = tilesetSource(tmj, s.map)!;
    maps[s.id] = parseTiledMap(tmj, await readJson<TiledTilesetJson>(tsPath), s.map, tsPath);
  }
  // 背景圖場景（interactables.json）：跟載入器一樣換成背景圖地圖
  const hs = await readJson<InteractablesFile>('interactables.json');
  const anyMap = Object.values(maps)[0];
  for (const [id, bg] of Object.entries(hs.scenes)) maps[id] = buildBackgroundMap(bg, world.tileSize, maps[id] ?? anyMap);
  return { world, ch, maps };
}

test('joinPath：相對路徑換算，不能跑出角色包', () => {
  assert.equal(joinPath('maps/', 'tiles.tsj'), 'maps/tiles.tsj');
  assert.equal(joinPath('maps/', '../assets/tiles.png'), 'assets/tiles.png');
  assert.throws(() => joinPath('', '../x.png'));
});

test('findPath：繞過障礙、走不到回 null', () => {
  // . . .
  // # # .
  // . . .
  const g = { width: 3, height: 3, blocked: [false, false, false, true, true, false, false, false, false] };
  const p = findPath(g, { x: 0, y: 0 }, { x: 0, y: 2 })!;
  assert.equal(p.length, 6);
  assert.deepEqual(p.at(-1), { x: 0, y: 2 });
  assert.deepEqual(findPath(g, { x: 0, y: 0 }, { x: 0, y: 0 }), []);
  assert.equal(findPath(g, { x: 0, y: 0 }, { x: 0, y: 1 }), null);
  const walled = { width: 3, height: 1, blocked: [false, true, false] };
  assert.equal(findPath(walled, { x: 0, y: 0 }, { x: 2, y: 0 }), null);
  assert.deepEqual(reachable(walled, { x: 0, y: 0 }), [true, false, false]);
});

test('內附像素角色包：地圖解析成功、檢查全部通過', async () => {
  const { world, ch, maps } = await loadPack();
  assert.deepEqual(validatePixelPack(world, ch, maps), []);
  const room = maps.room!;
  assert.equal(room.tileset.image, 'assets/tiles.png');
  assert.deepEqual(room.doors[0]!.stand, { x: 7, y: 11 }); // V0.9 起房間是背景圖，門在下面
  assert.ok(maps.garden!.layers.some((l) => l.above), '花園要有畫在角色上面的樹冠圖層');
});

test('validatePixelPack：抓得到通往不存在場景的門、寫錯的作息地點', async () => {
  const { world, ch, maps } = await loadPack();
  maps.room!.doors[0]!.to = 'moon';
  ch.schedule!.morning!.spots.push('sofa');
  const errs = validatePixelPack(world, ch, maps).join('\n');
  assert.match(errs, /moon/);
  assert.match(errs, /sofa/);
});

test('作息：早上在房間會挑作息裡的地點；閒晃不會選到門口', async () => {
  const { ch, maps } = await loadPack();
  assert.equal(scheduledScene(ch, 'night'), 'room');
  const d = pickDestination(ch, 'morning', 'room', maps.room!, { x: 9, y: 9 }, () => 0.1);
  assert.equal(d?.kind, 'spot');
  for (let i = 0; i < 50; i++) {
    const w = pickDestination(ch, 'morning', 'room', maps.room!, { x: 14, y: 4 }, () => (i * 0.37 + 0.71) % 1);
    if (w?.kind === 'wander') assert.notDeepEqual(w.tile, { x: 15, y: 3 });
  }
});

test('動作：地點與台詞都能指定動作，寫錯名字會被抓到', async () => {
  const { world, ch, maps } = await loadPack();
  assert.equal(maps.room!.spots.rug!.action, 'sit');
  assert.equal(maps.room!.spots.bed!.action, 'sleepy');
  assert.equal(ch.actions?.onClick, 'wave');
  const { pickLineDef } = await import('../src/shared/lines.ts');
  const fl = pickLineDef(ch.lines, { trigger: 'welcome', sceneId: 'room', phase: 'night' }, () => 0);
  assert.equal(fl?.action, 'happy');
  ch.lines.push({ text: '測試', action: 'dance' });
  maps.garden!.spots.pond!.action = 'moonwalk'; // V0.15 起 swim 是真的動作了
  ch.actions!.clips.sit!.loop = 99;
  const errs = validatePixelPack(world, ch, maps).join('\n');
  assert.match(errs, /dance/);
  assert.match(errs, /moonwalk/);
  assert.match(errs, /loop/);
});

test('互動物件：standTiles 只留走得到的格子；isNear 要緊貼、不能站在上面；faceToward 面向物件', () => {
  const r = { x: 2, y: 2, w: 2, h: 1 };
  const all = standTiles(r, () => true);
  assert.equal(all.length, 6); // 上 2、下 2、左 1、右 1
  assert.deepEqual(standTiles(r, (x) => x !== 2).map((t) => `${t.x},${t.y}`).sort(), ['1,2', '3,1', '3,3', '4,2']);
  assert.equal(isNear({ x: 2, y: 1 }, r), true);
  assert.equal(isNear({ x: 4, y: 2 }, r), true);
  assert.equal(isNear({ x: 2, y: 2 }, r), false); // 站在上面
  assert.equal(isNear({ x: 1, y: 1 }, r), false); // 斜角
  assert.equal(faceToward({ x: 3, y: 1 }, r), 'down');
  assert.equal(faceToward({ x: 3, y: 3 }, r), 'up');
  assert.equal(faceToward({ x: 1, y: 2 }, r), 'right');
  assert.equal(faceToward({ x: 4, y: 2 }, r), 'left');
});

test('花園：池塘、5 塊田、商人都解析出來，而且從門口走得到', async () => {
  const { maps } = await loadPack();
  const g = maps.garden!;
  const kinds = g.interactables.map((it) => it.kind).sort();
  assert.deepEqual(kinds, ['fishing', 'plot', 'plot', 'plot', 'plot', 'plot', 'shop']);
  const dist = distances(g, g.spawns.default!.tile);
  for (const it of g.interactables) {
    assert.ok(it.stands.some((t) => Number.isFinite(dist[t.y * g.width + t.x]!)), `${it.id} 走不到`);
  }
});

test('validatePixelPack：玩法物件指到不存在的掉落表／商人、台詞寫錯物品都會被抓到', async () => {
  const { world, ch, maps } = await loadPack();
  const gameplay: GameplayFile = await packGameplay();
  assert.deepEqual(validatePixelPack(world, ch, maps, gameplay), []);
  const broken = structuredClone(gameplay);
  delete broken.fishing.tables.pond;
  delete broken.shops.merchant;
  const ch2 = structuredClone(ch);
  ch2.lines.push({ text: '測試', on: ['feed'], items: ['fish_whale'] });
  const errs = validatePixelPack(world, ch2, maps, broken).join('\n');
  assert.match(errs, /掉落表「pond」/);
  assert.match(errs, /商人「merchant」/);
  assert.match(errs, /fish_whale/);
});

test('好感解鎖台詞：好感不夠不會說；餵河豚時專屬台詞優先', async () => {
  const { ch } = await loadPack();
  const ctx = { trigger: 'click' as const, sceneId: 'room', phase: 'afternoon' as const };
  const texts = (affection: number) => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(pickLineDef(ch.lines, { ...ctx, affection }, () => i / 400)!.text);
    return seen;
  };
  const locked = ch.lines.filter((l) => (l.minAffection ?? 0) >= 330).map((l) => l.text);
  assert.ok(locked.length > 0);
  for (const t of locked) assert.equal(texts(0).has(t), false);
  assert.ok(locked.some((t) => texts(330).has(t)));
  const fed = pickLineDef(ch.lines, { trigger: 'feed', sceneId: 'room', phase: 'night', item: 'fish_puffer', category: 'fish', tags: ['liked'] }, Math.random);
  assert.equal(fed?.items?.[0], 'fish_puffer');
  const capped = pickLineDef(ch.lines, { trigger: 'feed', sceneId: 'room', phase: 'night', tags: ['capped'] }, Math.random);
  assert.deepEqual(capped?.tags, ['capped']);
});
