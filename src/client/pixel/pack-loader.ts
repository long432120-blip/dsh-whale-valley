// 讀像素角色包：scenes.json → 每張 Tiled 地圖 → 圖塊集 → 圖片。
// 「從哪裡讀」抽成 PackSource：demo 用 fetch，雙擊版和 DSH 版用打包時內嵌的資料。
import type { MapModel, PixelCharacterFile, PixelWorldFile } from '../../shared/pixel-types.ts';
import { dirname, parseTiledMap, tilesetSource, type TiledMapJson, type TiledTilesetJson } from '../../shared/tiled.ts';
import { validatePixelPack } from '../../shared/pixel-validate.ts';
import { buildBackgroundMap, validateInteractables, type InteractablesFile } from '../../shared/hotspots.ts';
import { validateSprites, type SpritesFile } from '../../shared/sprites.ts';
import { validateMusic, type MusicFile } from '../../shared/music.ts';

export interface PackSource {
  /** 讀 JSON；path 相對於角色包根目錄 */
  json(path: string): Promise<unknown>;
  /** 把圖片路徑換成可以給 <img> 用的 URL */
  asset(path: string): string;
}

export interface LoadedPixelPack {
  world: PixelWorldFile;
  character: PixelCharacterFile;
  maps: Record<string, MapModel>;
  images: Record<string, HTMLImageElement>;
  /** 對話框頭像用 CSS 背景顯示，所以給 URL 就好 */
  portraitUrl?: string;
  /** 檢查出來的問題；不會擋住載入，但會印在 console */
  problems: string[];
  /** 角色包裡其他圖片（居民、女神…）的 URL；畫面需要時才載入 */
  asset(path: string): string;
  /** V0.10：GPT 素材表切出來的圖（sprites.json）；沒有或載入失敗就是 undefined，畫面照舊用 emoji 和 16px 圖塊 */
  sprites?: {
    file: SpritesFile;
    /** 高解析圖塊（跟 tiles.png 同排列，每格放大 tilesHdScale 倍） */
    tilesHd?: HTMLImageElement;
    tilesHdScale: number;
    atlas?: HTMLImageElement;
    /** 圖集的 URL（揹包、商店這些 DOM 介面用 CSS 背景顯示） */
    atlasUrl?: string;
  };
  /** V0.14：背景音樂（music.json）；沒有就不放音樂 */
  music?: MusicFile;
  /** 音樂檔的候選網址：角色包裡的檔案（demo 伺服器）→ 網頁旁邊的 music/（單機版） */
  musicUrls(src: string): string[];
}

export interface LoadPackOptions {
  /** V0.22：音樂檔的網址前綴（DSH 版：'/api/dsh-whale-valley/music/'，由 host 提供檔案） */
  musicBase?: string;
}

export async function loadPixelPack(src: PackSource, opts: LoadPackOptions = {}): Promise<LoadedPixelPack> {
  const world = (await src.json('scenes.json')) as PixelWorldFile;
  const character = (await src.json('character.json')) as PixelCharacterFile;
  const maps: Record<string, MapModel> = {};
  for (const s of world.scenes) {
    if (!s.map) continue; // V0.11：只有背景圖的場景，下面用 interactables.json 建
    const tmj = (await src.json(s.map)) as TiledMapJson & { tilesets: (TiledTilesetJson & { firstgid: number })[] };
    const tsPath = tilesetSource(tmj, s.map);
    // 外部圖塊集（.tsj）或內嵌在地圖裡的圖塊集都支援
    const tileset = tsPath ? ((await src.json(tsPath)) as TiledTilesetJson) : tmj.tilesets[0]!;
    maps[s.id] = parseTiledMap(tmj, tileset, s.map, tsPath ?? `${dirname(s.map)}_`);
  }

  // V0.9：interactables.json（可以沒有）：有背景圖的場景，換成「背景圖＋互動熱區」
  let hotspotProblems: string[] = [];
  const hs = (await src.json('interactables.json').catch(() => null)) as InteractablesFile | null;
  if (hs) {
    hotspotProblems = validateInteractables(hs, { scenes: world.scenes.map((x) => x.id), clips: Object.keys(character.actions?.clips ?? {}) });
    if (!hotspotProblems.length) {
      // 沒有 Tiled 地圖的場景借用第一張地圖的圖塊集（給「擺家具」用）
      const anyMap = Object.values(maps)[0];
      for (const [id, bg] of Object.entries(hs.scenes)) {
        if (world.scenes.some((s) => s.id === id)) maps[id] = buildBackgroundMap(bg, world.tileSize, maps[id] ?? anyMap);
      }
    }
  }

  const paths = new Set<string>([character.world.src, ...Object.values(maps).map((m) => m.tileset.image)]);
  for (const m of Object.values(maps)) if (m.background) paths.add(m.background.image);
  if (character.emotes) paths.add(character.emotes.src);
  if (character.actions) paths.add(character.actions.src);
  for (const c of Object.values(character.actions?.clips ?? {})) if (c.sheet) paths.add(c.sheet.src); // V0.15：自己一張圖的動作
  if (character.player) paths.add(character.player.src);
  const images: Record<string, HTMLImageElement> = {};
  await Promise.all([...paths].map(async (p) => (images[p] = await loadImage(src.asset(p), p))));

  // V0.10：sprites.json（可以沒有）。圖載入失敗只印警告，畫面退回 emoji，不擋住遊戲
  let sprites: LoadedPixelPack['sprites'];
  let spriteProblems: string[] = [];
  const sf = (await src.json('sprites.json').catch(() => null)) as SpritesFile | null;
  if (sf) {
    spriteProblems = validateSprites(sf);
    const opt = (p?: string) => (p ? loadImage(src.asset(p), p).catch((err: Error) => (spriteProblems.push(err.message), undefined)) : Promise.resolve(undefined));
    const [tilesHd, atlas] = await Promise.all([opt(sf.tilesHd?.image), opt(sf.atlas)]);
    sprites = { file: sf, tilesHd, tilesHdScale: sf.tilesHd?.scale ?? 1, atlas, atlasUrl: sf.atlas && atlas ? src.asset(sf.atlas) : undefined };
  }

  // V0.14：背景音樂（可以沒有）
  const music = (await src.json('music.json').catch(() => undefined)) as MusicFile | undefined;
  const musicProblems = music ? validateMusic(music, { scenes: world.scenes.map((s) => s.id) }) : [];
  const problems = [...validatePixelPack(world, character, maps), ...hotspotProblems, ...spriteProblems, ...musicProblems];
  for (const p of problems) console.warn('[whale-pet] pack:', p);
  return {
    world,
    character,
    maps,
    images,
    portraitUrl: character.portrait ? src.asset(character.portrait.src) : undefined,
    problems,
    asset: (p) => src.asset(p),
    sprites,
    music,
    musicUrls(p) {
      const out: string[] = [];
      const file = p.split('/').pop();
      if (opts.musicBase && file) out.push(opts.musicBase + encodeURIComponent(file));
      try {
        out.push(src.asset(p));
      } catch {
        /* 單機版：音樂沒有內嵌（太大），放在網頁旁邊的 music/ */
      }
      out.push(p);
      return [...new Set(out)];
    },
  };
}

function loadImage(url: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`圖片載入失敗：${label}`));
    img.src = url;
  });
}

/** demo 伺服器版用：從網址讀 */
export function urlSource(base: URL): PackSource {
  return {
    async json(path) {
      const res = await fetch(new URL(path, base));
      if (!res.ok) throw new Error(`讀不到 ${path}（HTTP ${res.status}）`);
      return res.json();
    },
    asset: (path) => new URL(path, base).href,
  };
}

/** 雙擊版 / DSH 版用：打包時就把 JSON 和圖片內嵌進來 */
export function bundledSource(json: Record<string, unknown>, assets: Record<string, string>): PackSource {
  return {
    async json(path) {
      if (!(path in json)) throw new Error(`打包時沒有內嵌：${path}`);
      return json[path];
    },
    asset(path) {
      const url = assets[path];
      if (!url) throw new Error(`打包時沒有內嵌：${path}`);
      return url;
    },
  };
}
