// 用法：npm run check:pixel -- whale-girl-pixel
// 檢查像素角色包：Tiled 地圖能不能解析、門和地點走不走得到、作息有沒有寫錯、圖片檔在不在。
import { loadGameplay } from '../src/shared/gameplay-pack.ts';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MapModel, PixelCharacterFile, PixelWorldFile } from '../src/shared/pixel-types.ts';
import { buildDefs, validateGameplay } from '../src/shared/gameplay.ts';
import type { GameplayFile } from '../src/shared/gameplay-types.ts';
import { validatePixelPack } from '../src/shared/pixel-validate.ts';
import { buildBackgroundMap, validateInteractables, type InteractablesFile } from '../src/shared/hotspots.ts';
import { validateSprites, type SpritesFile } from '../src/shared/sprites.ts';
import { validateMusic, type MusicFile } from '../src/shared/music.ts';
import { dirname, parseTiledMap, tilesetSource, type TiledMapJson, type TiledTilesetJson } from '../src/shared/tiled.ts';

const pack = process.argv[2] ?? 'whale-girl-pixel';
const dir = join(import.meta.dirname, '..', 'packs', pack);
const readJson = async <T>(f: string) => JSON.parse(await readFile(join(dir, f), 'utf8')) as T;

const errors: string[] = [];
const world = await readJson<PixelWorldFile>('scenes.json');
const ch = await readJson<PixelCharacterFile>('character.json');
const maps: Record<string, MapModel> = {};
for (const s of world.scenes) {
  if (!s.map) continue; // V0.11：只有背景圖的場景（interactables.json）
  try {
    const tmj = await readJson<TiledMapJson & { tilesets: (TiledTilesetJson & { firstgid: number })[] }>(s.map);
    const tsPath = tilesetSource(tmj, s.map);
    const ts = tsPath ? await readJson<TiledTilesetJson>(tsPath) : tmj.tilesets[0]!;
    maps[s.id] = parseTiledMap(tmj, ts, s.map, tsPath ?? `${dirname(s.map)}_`);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
}
let gameplay: GameplayFile | null = null;
try {
  // 五個 JSON（gameplay / fishing / weather / animals / quests）組起來再檢查
  gameplay = await loadGameplay(async (n) => {
    try {
      return await readJson(n);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && n !== 'gameplay.json') return null;
      throw e;
    }
  });
  if (gameplay) errors.push(...validateGameplay(gameplay).map((e) => `玩法資料：${e}`));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`gameplay.json 讀不了：${(err as Error).message}`);
}
// V0.9：背景圖＋互動熱區（interactables.json，可以沒有）
const bgImages: string[] = [];
const hs = await readJson<InteractablesFile>('interactables.json').catch((err: NodeJS.ErrnoException) => {
  if (err.code !== 'ENOENT') errors.push(`interactables.json 讀不了：${err.message}`);
  return null;
});
if (hs) {
  const probs = validateInteractables(hs, {
    scenes: world.scenes.map((x) => x.id),
    clips: Object.keys(ch.actions?.clips ?? {}),
    shops: gameplay ? Object.keys(gameplay.shops) : undefined,
    unlocks: gameplay ? Object.keys(gameplay.unlocks ?? {}) : undefined,
    games: gameplay?.leisure ? Object.keys(gameplay.leisure.play.games) : undefined,
    taps: gameplay?.stats ? [...gameplay.stats.satiety.drink.tables, ...(gameplay.stats.satiety.drink.taps ?? [])] : undefined,
    snacks: gameplay?.leisure ? Object.keys(gameplay.leisure.snacks ?? {}) : undefined,
  });
  errors.push(...probs);
  if (!probs.length) {
    const anyMap = Object.values(maps)[0];
    for (const [id, bg] of Object.entries(hs.scenes)) {
      if (world.scenes.some((s) => s.id === id)) maps[id] = buildBackgroundMap(bg, world.tileSize, maps[id] ?? anyMap);
      bgImages.push(bg.image);
    }
  }
}
errors.push(...validatePixelPack(world, ch, maps, gameplay));
// V0.10：素材表切出來的圖（sprites.json，可以沒有）
const sp = await readJson<SpritesFile>('sprites.json').catch(() => null);
if (sp) {
  const items = gameplay ? [...buildDefs(gameplay).items.keys()] : undefined;
  errors.push(...validateSprites(sp, {
    items,
    crops: gameplay ? Object.fromEntries(gameplay.crops.map((c) => [c.id, c.stages.length])) : undefined,
    animals: gameplay ? Object.keys(gameplay.animals ?? {}) : undefined,
    monsters: gameplay ? (gameplay.mine?.zones ?? []).flatMap((z) => z.monsters.map((m) => m.name)) : undefined,
  }));
  for (const p of [sp.tilesHd?.image, sp.atlas]) if (p) bgImages.push(p);
}

const files = new Set<string>([ch.world.src, ...Object.values(maps).map((m) => m.tileset.image), ...bgImages]);
if (ch.portrait) files.add(ch.portrait.src);
if (ch.emotes) files.add(ch.emotes.src);
if (ch.actions) files.add(ch.actions.src);
for (const c of Object.values(ch.actions?.clips ?? {})) if (c.sheet) files.add(c.sheet.src);
if (ch.player) files.add(ch.player.src);
if (world.hud?.clock) files.add(world.hud.clock.board).add(world.hud.clock.icons.src); // V0.16：時間與天氣木牌
// V0.5／V0.6：居民立繪、女神、寵物貼圖
for (const n of Object.values(gameplay?.npcs ?? {})) {
  if (n.sprite) files.add(n.sprite);
  if (n.portrait) files.add(n.portrait);
}
if (gameplay?.fishing.goddess?.image) files.add(gameplay.fishing.goddess.image);
for (const p of Object.values(gameplay?.pets?.species ?? {})) if (p.sprite) files.add(p.sprite.src);
for (const f of files) {
  try {
    await access(join(dir, f));
  } catch {
    errors.push(`找不到圖片：packs/${pack}/${f}`);
  }
}
// V0.14：背景音樂（music.json，可以沒有）
const music = await readJson<MusicFile>('music.json').catch(() => null);
if (music) {
  errors.push(...validateMusic(music, { scenes: world.scenes.map((s) => s.id), weather: gameplay?.weather?.types.map((t) => t.id) }));
  for (const t of Object.values(music.tracks)) {
    try {
      await access(join(dir, t.src));
    } catch {
      errors.push(`找不到音樂：packs/${pack}/${t.src}`);
    }
  }
}

if (errors.length) {
  console.error(`✗ packs/${pack} 有 ${errors.length} 個問題：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ packs/${pack} 檢查通過：${world.scenes.length} 張地圖（${Object.keys(hs?.scenes ?? {}).length} 張背景圖場景、${Object.values(hs?.scenes ?? {}).reduce((n, b) => n + b.hotspots.length, 0)} 個互動熱區）、${ch.lines.length} 句台詞` +
  (gameplay ? `、${gameplay.items.length} 種物品、${gameplay.crops.length} 種作物` : '') +
  (gameplay?.pets ? `、${Object.keys(gameplay.pets.species).length} 種寵物` : ''));
