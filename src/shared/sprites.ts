// V0.10：GPT 素材表切出來的圖（packs/<角色包>/sprites.json，由 tools/import_asset_sheet.py 產生）。
// 有圖就畫圖、沒有就照舊畫 emoji：所以 sprites.json 可以只涵蓋一部分東西。

export interface SpriteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpritesFile {
  version: 1;
  /** 高解析圖塊：跟 tiles.png 同樣的排列，每格放大 scale 倍 */
  tilesHd?: { image: string; scale: number };
  /** 圖集（動物、作物、物品） */
  atlas?: string;
  frames: Record<string, SpriteFrame>;
  /** 物品 id → 圖集裡的哪一張 */
  items: Record<string, string>;
  /** 動物種類 → 成年、幼崽各一張 */
  animals: Record<string, { adult?: string; baby?: string }>;
  /** 作物 id → 每個生長階段一張（null = 不畫，只看得到田地；"emoji" = 這個階段用 emoji） */
  crops: Record<string, (string | null)[]>;
  /** V0.12：礦洞怪物名稱（gameplay.json mine.zones[].monsters[].name）→ 圖集裡的哪一張 */
  monsters?: Record<string, string>;
  /** V0.12：其他單張圖（mine_rock 礦洞的石頭、mine_ladder 往下的梯子） */
  objects?: Record<string, string>;
}

/** 物品圖示：沒有就回 null（呼叫的地方用 emoji） */
export function itemFrame(f: SpritesFile | undefined, itemId: string): SpriteFrame | null {
  const k = f?.items[itemId];
  return (k && f!.frames[k]) || null;
}

export function animalFrame(f: SpritesFile | undefined, kind: string, baby: boolean): SpriteFrame | null {
  const a = f?.animals[kind];
  const k = baby ? (a?.baby ?? a?.adult) : a?.adult;
  return (k && f!.frames[k]) || null;
}

export function monsterFrame(f: SpritesFile | undefined, name: string): SpriteFrame | null {
  const k = f?.monsters?.[name];
  return (k && f!.frames[k]) || null;
}

export function objectFrame(f: SpritesFile | undefined, key: string): SpriteFrame | null {
  const k = f?.objects?.[key];
  return (k && f!.frames[k]) || null;
}

/**
 * 作物某個階段的圖。
 *   - undefined：這個作物沒有設定（整個用 emoji）
 *   - null：這個階段刻意不畫（剛播種，只看得到田地）
 */
export function cropFrame(f: SpritesFile | undefined, cropId: string, stage: number): SpriteFrame | null | undefined {
  const list = f?.crops[cropId];
  if (!list) return undefined;
  const k = list[Math.min(stage, list.length - 1)];
  if (k === null) return null;
  if (k === undefined || k === 'emoji') return undefined;
  return f!.frames[k] ?? undefined;
}

/** 檢查 sprites.json：對到不存在的圖、不存在的物品／作物／動物 */
export function validateSprites(
  file: unknown,
  ctx: { items?: string[]; crops?: Record<string, number>; animals?: string[]; monsters?: string[] } = {},
): string[] {
  const out: string[] = [];
  const f = file as SpritesFile;
  if (!f || typeof f !== 'object' || f.version !== 1 || !f.frames) return ['sprites.json：要有 version: 1 和 frames'];
  const has = (k: string) => !!f.frames[k];
  for (const [id, k] of Object.entries(f.items ?? {})) {
    if (!has(k)) out.push(`sprites.json items.${id}：圖集裡沒有 ${k}`);
    if (ctx.items && !ctx.items.includes(id)) out.push(`sprites.json items.${id}：沒有這個物品`);
  }
  for (const [id, a] of Object.entries(f.animals ?? {})) {
    for (const k of [a.adult, a.baby]) if (k && !has(k)) out.push(`sprites.json animals.${id}：圖集裡沒有 ${k}`);
    if (ctx.animals && !ctx.animals.includes(id)) out.push(`sprites.json animals.${id}：沒有這種動物`);
  }
  for (const [id, list] of Object.entries(f.crops ?? {})) {
    for (const k of list) if (k && k !== 'emoji' && !has(k)) out.push(`sprites.json crops.${id}：圖集裡沒有 ${k}`);
    if (ctx.crops) {
      if (!(id in ctx.crops)) out.push(`sprites.json crops.${id}：沒有這種作物`);
      else if (list.length !== ctx.crops[id]) out.push(`sprites.json crops.${id}：階段數 ${list.length} 跟 gameplay.json 的 ${ctx.crops[id]} 不一樣`);
    }
  }
  for (const [name, k] of Object.entries(f.monsters ?? {})) {
    if (!has(k)) out.push(`sprites.json monsters.${name}：圖集裡沒有 ${k}`);
    if (ctx.monsters && !ctx.monsters.includes(name)) out.push(`sprites.json monsters.${name}：礦洞裡沒有這種怪物`);
  }
  for (const [key, k] of Object.entries(f.objects ?? {})) {
    if (!has(k)) out.push(`sprites.json objects.${key}：圖集裡沒有 ${k}`);
  }
  for (const [k, fr] of Object.entries(f.frames)) {
    if (!(fr.w > 0 && fr.h > 0 && fr.x >= 0 && fr.y >= 0)) out.push(`sprites.json frames.${k}：座標不對`);
  }
  return out;
}
