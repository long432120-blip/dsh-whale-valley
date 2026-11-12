// Tiled 地圖（.tmj）與圖塊集（.tsj）的解析：純函數，瀏覽器和 Node 都能跑。
// 規則（在 Tiled 裡怎麼畫）：
//   - 圖層格式要選 CSV（不要 Base64 / 壓縮）
//   - 圖塊屬性 collides=true → 不能走
//   - 圖層屬性 above=true（或圖層名叫 above）→ 畫在角色上面（樹冠、門框）
//   - 物件 type：spawn（點）、spot（點，屬性 face / emote / action）、door（矩形，屬性 to / spawn / label）
//   - V0.2 物件 type：fishing（矩形蓋住水面，屬性 table / label）、plot（1×1 農田，屬性 label）、
//     shop（矩形，屬性 shop / label）；她會走到範圍旁邊才操作
import type { AreaDef, DoorDef, Facing, Interactable, InteractableKind, MapModel, SpotDef, TilePos } from './pixel-types.ts';

type Prop = { name: string; type?: string; value: unknown };
export interface TiledObject {
  id: number; name?: string; type?: string; class?: string;
  x: number; y: number; width?: number; height?: number; point?: boolean;
  properties?: Prop[];
}
export interface TiledLayer {
  name: string; type: string; visible?: boolean;
  data?: number[] | string; encoding?: string;
  objects?: TiledObject[]; properties?: Prop[];
}
export interface TiledMapJson {
  width: number; height: number; tilewidth: number; tileheight: number; infinite?: boolean;
  layers: TiledLayer[];
  tilesets: { firstgid: number; source?: string }[];
}
export interface TiledTilesetJson {
  tilewidth: number; tileheight: number; columns: number; tilecount: number; image: string;
  tiles?: { id: number; type?: string; properties?: Prop[] }[];
}

const FLIP_MASK = 0x1fffffff; // Tiled 把翻轉資訊放在 gid 的高位元
const FACINGS: Facing[] = ['down', 'left', 'right', 'up'];

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

/** 以角色包根目錄為基準，把 base 檔案裡的相對路徑換成角色包相對路徑 */
export function joinPath(baseDir: string, rel: string): string {
  const out: string[] = [];
  for (const part of (baseDir + rel).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!out.length) throw new Error(`路徑跑出角色包外面了：${baseDir}${rel}`);
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

const prop = (props: Prop[] | undefined, name: string): unknown => props?.find((p) => p.name === name)?.value;

/** 找出地圖引用的圖塊集路徑（外部 .tsj）；內嵌圖塊集則回傳 null */
export function tilesetSource(map: TiledMapJson, mapPath: string): string | null {
  const ts = map.tilesets?.[0];
  if (!ts) throw new Error(`${mapPath}：沒有圖塊集`);
  return ts.source ? joinPath(dirname(mapPath), ts.source) : null;
}

export function parseTiledMap(
  map: TiledMapJson,
  tileset: TiledTilesetJson,
  mapPath: string,
  tilesetPath: string,
): MapModel {
  const at = mapPath;
  if (map.infinite) throw new Error(`${at}：不支援無限地圖（Map → Map Properties 取消 Infinite）`);
  if (map.tilesets.length !== 1) throw new Error(`${at}：V0.2 只支援一個圖塊集`);
  if (map.tilewidth !== map.tileheight || tileset.tilewidth !== map.tilewidth) {
    throw new Error(`${at}：圖塊要是正方形，且地圖與圖塊集的尺寸一致`);
  }
  const { width, height } = map;
  const firstgid = map.tilesets[0]!.firstgid;
  const collides = new Set((tileset.tiles ?? []).filter((t) => prop(t.properties, 'collides') === true).map((t) => t.id));

  const layers: MapModel['layers'] = [];
  const blocked = new Array<boolean>(width * height).fill(false);
  const spawns: MapModel['spawns'] = {};
  const doors: DoorDef[] = [];
  const spots: Record<string, SpotDef> = {};
  const interactables: Interactable[] = [];
  const areas: AreaDef[] = [];
  const objects: TiledObject[] = [];

  for (const l of map.layers) {
    if (l.type === 'tilelayer') {
      if (!Array.isArray(l.data) || l.encoding) {
        throw new Error(`${at} › ${l.name}：圖層格式請在 Tiled 設成 CSV（Map Properties → Tile Layer Format）`);
      }
      if (l.data.length !== width * height) throw new Error(`${at} › ${l.name}：圖塊數量不對`);
      const gids = l.data.map((g) => g & FLIP_MASK);
      gids.forEach((g, i) => {
        if (g && collides.has(g - firstgid)) blocked[i] = true;
      });
      if (l.visible !== false) layers.push({ name: l.name, above: l.name === 'above' || prop(l.properties, 'above') === true, gids });
    } else if (l.type === 'objectgroup') {
      objects.push(...(l.objects ?? []));
    }
  }
  // V0.18：所有圖層都是空的格子（例如閣樓、溫室外面的黑色空白）不能走：不然她會走出房間、站在虛空裡
  const tileLayers = map.layers.filter((l) => l.type === 'tilelayer' && Array.isArray(l.data));
  if (tileLayers.length) {
    for (let i = 0; i < width * height; i++) if (tileLayers.every((l) => !((l.data as number[])[i]! & FLIP_MASK))) blocked[i] = true;
  }

  const ts = map.tilewidth;
  const toTile = (o: TiledObject): TilePos => ({ x: Math.floor(o.x / ts), y: Math.floor(o.y / ts) });
  const face = (o: TiledObject): Facing | undefined => {
    const f = prop(o.properties, 'face');
    return FACINGS.includes(f as Facing) ? (f as Facing) : undefined;
  };
  const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && !blocked[y * width + x];

  for (const o of objects) {
    const type = o.type ?? o.class ?? '';
    const name = o.name ?? '';
    if (type === 'spawn') spawns[name] = { tile: toTile(o), face: face(o) };
    else if (type === 'spot') {
      const emote = prop(o.properties, 'emote');
      const action = prop(o.properties, 'action');
      spots[name] = {
        name,
        tile: toTile(o),
        face: face(o),
        emote: typeof emote === 'string' ? emote : undefined,
        action: typeof action === 'string' ? action : undefined,
      };
    } else if (INTERACTABLE_KINDS.includes(type as InteractableKind)) {
      const rect = rectOf(o, ts);
      const s = (k: string) => {
        const v = prop(o.properties, k);
        return typeof v === 'string' && v ? v : undefined;
      };
      // 居民站的格子不能穿過去
      if (type === 'npc') for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (x < width && y < height) blocked[y * width + x] = true;
      }
      interactables.push({
        id: name || `${type}-${o.id}`,
        kind: type as InteractableKind,
        rect,
        stands: [], // 全部物件讀完、居民的格子都標好之後再算
        label: s('label') ?? DEFAULT_LABEL[type as InteractableKind],
        table: s('table'),
        shop: s('shop'),
        unlock: s('unlock'),
        machine: s('machine'),
        building: s('building'),
        npc: s('npc'),
        iconItem: s('iconItem'),
        icon: s('icon'),
        text: s('text'),
      });
    } else if (type === 'pen' || type === 'area') {
      const b = prop(o.properties, 'building');
      areas.push({ name, kind: type, rect: rectOf(o, ts), building: typeof b === 'string' ? b : undefined });
    } else if (type === 'door') {
      const rect = {
        x: Math.floor(o.x / ts),
        y: Math.floor(o.y / ts),
        w: Math.max(1, Math.round((o.width ?? ts) / ts)),
        h: Math.max(1, Math.round((o.height ?? ts) / ts)),
      };
      // 由下往上、由中間往兩側找第一個能站的格子
      let stand: TilePos | null = null;
      const mid = rect.x + Math.floor((rect.w - 1) / 2);
      outer: for (let y = rect.y + rect.h - 1; y >= rect.y; y--) {
        for (let d = 0; d < rect.w; d++) {
          for (const x of [mid - d, mid + d]) {
            if (x >= rect.x && x < rect.x + rect.w && walkable(x, y)) { stand = { x, y }; break outer; }
          }
        }
      }
      const to = prop(o.properties, 'to');
      const spawn = prop(o.properties, 'spawn');
      const label = prop(o.properties, 'label');
      const unlock = prop(o.properties, 'unlock');
      doors.push({
        id: name || `door-${o.id}`,
        rect,
        stand,
        to: typeof to === 'string' ? to : '',
        spawn: typeof spawn === 'string' ? spawn : undefined,
        label: typeof label === 'string' ? label : '門',
        unlock: typeof unlock === 'string' && unlock ? unlock : undefined,
      });
    }
  }
  for (const it of interactables) it.stands = standTiles(it.rect, walkable);

  return {
    width,
    height,
    tileSize: ts,
    layers,
    tileset: {
      firstgid,
      columns: tileset.columns,
      tilecount: tileset.tilecount,
      image: joinPath(dirname(tilesetPath), tileset.image),
      names: Array.from({ length: tileset.tilecount }, (_, i) => tileset.tiles?.find((t) => t.id === i)?.type ?? ''),
    },
    blocked,
    spawns,
    doors,
    spots,
    interactables,
    areas,
  };
}

const INTERACTABLE_KINDS: InteractableKind[] = ['fishing', 'plot', 'shop', 'machine', 'building', 'npc', 'mine', 'sign', 'bed'];
const DEFAULT_LABEL: Record<InteractableKind, string> = {
  fishing: '🎣 釣魚', plot: '🌱 農田', shop: '🧳 商人', machine: '⚙️ 機器', building: '🏠 建築', npc: '居民', mine: '⛏️ 礦洞', sign: '📜 告示牌', bed: '🛏️ 床', hotspot: '✨ 可以互動',
};

function rectOf(o: TiledObject, ts: number) {
  return {
    x: Math.floor(o.x / ts),
    y: Math.floor(o.y / ts),
    w: Math.max(1, Math.round((o.width ?? ts) / ts)),
    h: Math.max(1, Math.round((o.height ?? ts) / ts)),
  };
}

/** 矩形外圍、上下左右緊貼、可以走的格子 */
export function standTiles(r: { x: number; y: number; w: number; h: number }, walkable: (x: number, y: number) => boolean): TilePos[] {
  const out: TilePos[] = [];
  for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y: r.y - 1 }, { x, y: r.y + r.h });
  for (let y = r.y; y < r.y + r.h; y++) out.push({ x: r.x - 1, y }, { x: r.x + r.w, y });
  return out.filter((t) => walkable(t.x, t.y));
}

/** 她的格子跟矩形的曼哈頓距離剛好是 1（緊貼、不能站在上面） */
export function isNear(t: TilePos, r: { x: number; y: number; w: number; h: number }): boolean {
  const dx = Math.max(r.x - t.x, 0, t.x - (r.x + r.w - 1));
  const dy = Math.max(r.y - t.y, 0, t.y - (r.y + r.h - 1));
  return dx + dy === 1;
}

/** 轉向矩形：看矩形在她的哪個方向 */
export function faceToward(t: TilePos, r: { x: number; y: number; w: number; h: number }): Facing {
  if (t.y < r.y) return 'down';
  if (t.y >= r.y + r.h) return 'up';
  return t.x < r.x ? 'right' : 'left';
}

export function isWalkable(m: MapModel, t: TilePos): boolean {
  return t.x >= 0 && t.y >= 0 && t.x < m.width && t.y < m.height && !m.blocked[t.y * m.width + t.x];
}
