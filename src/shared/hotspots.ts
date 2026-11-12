// V0.9：用一張完整的背景圖當場景（例如貝殼床、水族箱的房間），上面放「互動熱區」。
// 全部由 packs/<角色包>/interactables.json 決定；這裡是純函數（host、瀏覽器、測試都能用）。
//
// 座標一律用「原圖像素」：直接在繪圖軟體裡量背景圖就好，不用換算成格子。
// 載入時再把原圖換算成遊戲的格子地圖（尋路、站位、門都沿用原本的系統）。
import type { DoorDef, Facing, Interactable, MapModel, SpotDef, TilePos } from './pixel-types.ts';
import { isNear } from './tiled.ts';

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PxPoint {
  x: number;
  y: number;
}

/** 熱區被點之後要做的事 */
export type HotspotAction =
  /** 睡覺：跳到隔天早上、體力補滿（沿用原本的床） */
  | { type: 'sleep' }
  /** 打開介面：揹包、圖鑑、寵物、世界地圖、禮物碼 */
  | { type: 'open_ui'; ui: 'bag' | 'codex' | 'pets' | 'worldmap' | 'gifts'; tab?: string }
  /** 吃東西：她坐下來，跳出「要吃什麼」（揹包裡能吃的）；V0.16：snack = leisure.json 的點心桌（每天有幾份免費的） */
  | { type: 'eat'; snack?: string }
  /** V0.16：打開冰箱：看看裡面有什麼、每天第一次會找到一樣東西（leisure.json 的 fridge） */
  | { type: 'fridge' }
  /** 說一句話（從 lines 隨機抽一句）；{time}、{weather}、{season} 會換成現在的時間、天氣、季節 */
  | { type: 'show_dialogue'; lines: string[] }
  /** V0.11：喝水（stats.json 的 drink.taps，例如廚房水龍頭） */
  | { type: 'drink'; table: string }
  /** V0.11：泡澡（leisure.json 的 bath） */
  | { type: 'bath' }
  /** V0.11：玩遊戲（leisure.json 的 play.games；點她或別的東西就停下來結算） */
  | { type: 'play'; game: string }
  /** V0.13：酒館街機：猜硬幣小遊戲（tavern.json 的 coinFlip） */
  | { type: 'coin_flip' }
  /** V0.13：酒館牌桌：跟酒館裡的人比大小（tavern.json 的 cards）；npc 不寫 = 讓主人選對手 */
  | { type: 'cards'; npc?: string }
  /** 商店（gameplay.json 的 shops，例如 kitchen 料理台） */
  | { type: 'shop'; shop: string }
  /** 門：走到 stand 之後去別的場景；有 options 時先跳出選單問要去哪（第一個是預設） */
  | { type: 'door'; to: string; spawn?: string; options?: DoorOption[] };

/** V0.11：一扇門可以通往好幾個地方（家裡的走廊） */
export interface DoorOption {
  to: string;
  spawn?: string;
  label: string;
  unlock?: string;
}

export interface HotspotDef {
  id: string;
  name: string;
  /** 點擊判定範圍（原圖像素） */
  rect: PxRect;
  /** 她走到哪裡才觸發（原圖像素，腳的位置）；沒寫就找範圍旁邊最近能站的格子 */
  stand?: PxPoint;
  /** 觸發時面向 */
  face?: Facing;
  /** 觸發時播放的動作（character.json 的 clips，例如 sit、sleepy） */
  pose?: string;
  /**
   * V0.16：坐下的位置（原圖像素，腳／椅腳的位置）。站位只能對齊格子，椅子常常在兩格之間；
   * 有 seat 的話，擺 pose 的時候她會移到這裡（例如酒館餐桌的椅子、廚房的高腳椅），起身再回到站位。
   */
  seat?: PxPoint;
  /** 觸發時頭上冒的表情 */
  emote?: string;
  /** 滑鼠移上去時的提示；沒寫用 name */
  hint?: string;
  /** 擋路（家具本身不能走過去）；預設 true，門、地毯寫 false */
  blocks?: boolean;
  /** 要先在 gameplay.json 的 unlocks 解鎖 */
  unlock?: string;
  /**
   * 她怎麼過去：walk（預設，尋路走過去）、fade（黑幕一閃直接出現在旁邊）、none（原地觸發）。
   * walk 找不到路時會自動改用 fade。
   */
  approach?: 'walk' | 'fade' | 'none';
  action: HotspotAction;
}

export interface BackgroundScene {
  /** 背景圖（相對角色包根目錄） */
  image: string;
  /** 原圖的寬高（像素）：熱區座標都以這個為準 */
  imageSize: { w: number; h: number };
  /** 換算成遊戲的幾格（每格 16px）；寬高比要跟原圖差不多，例如 1402×1122 → 15×12 */
  tiles: { w: number; h: number };
  /** 角色在這個場景的縮放（背景圖的家具比例跟格子地圖不同時用），預設 1 */
  actorScale?: number;
  /** 可以走的地板（原圖像素，可以多塊） */
  floor: PxRect[];
  /** 不能互動、但會擋路的東西（盆栽、燈…） */
  obstacles?: PxRect[];
  /** 出生點：default、從別的場景回來時的 fromXxx */
  spawns: Record<string, PxPoint & { face?: Facing }>;
  /** 她平常閒逛會去的地方（character.json 的作息用名稱指定） */
  spots?: Record<string, PxPoint & { face?: Facing; emote?: string; action?: string; /** V0.16：坐下的位置（同熱區的 seat） */ seat?: PxPoint }>;
  hotspots: HotspotDef[];
}

export interface InteractablesFile {
  version: 1;
  scenes: Record<string, BackgroundScene>;
}

export const HOTSPOT_ACTIONS = ['sleep', 'open_ui', 'eat', 'show_dialogue', 'shop', 'door', 'drink', 'bath', 'play', 'coin_flip', 'cards', 'fridge'] as const;
export const HOTSPOT_UIS = ['bag', 'codex', 'pets', 'worldmap', 'gifts'] as const;

// ───────────── 座標換算 ─────────────

/** 原圖像素 → 遊戲地圖像素（每格 tileSize） */
export function imgToMap(bg: BackgroundScene, tileSize: number) {
  const sx = (bg.tiles.w * tileSize) / bg.imageSize.w;
  const sy = (bg.tiles.h * tileSize) / bg.imageSize.h;
  return {
    sx,
    sy,
    point: (p: PxPoint) => ({ x: p.x * sx, y: p.y * sy }),
    rect: (r: PxRect) => ({ x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }),
    /** 原圖的一個點落在哪一格 */
    tile: (p: PxPoint): TilePos => ({
      x: clamp(Math.floor((p.x * sx) / tileSize), 0, bg.tiles.w - 1),
      y: clamp(Math.floor((p.y * sy) / tileSize), 0, bg.tiles.h - 1),
    }),
    /** 原圖範圍蓋到的格子（外接） */
    tileRect: (r: PxRect) => {
      const x0 = clamp(Math.floor((r.x * sx) / tileSize), 0, bg.tiles.w - 1);
      const y0 = clamp(Math.floor((r.y * sy) / tileSize), 0, bg.tiles.h - 1);
      const x1 = clamp(Math.ceil(((r.x + r.w) * sx) / tileSize), x0 + 1, bg.tiles.w);
      const y1 = clamp(Math.ceil(((r.y + r.h) * sy) / tileSize), y0 + 1, bg.tiles.h);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
  };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const inRect = (p: PxPoint, r: PxRect) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

// ───────────── 點擊判定 ─────────────

/**
 * 原圖座標 (x, y) 點到哪個熱區。重疊時取面積最小的（小東西疊在大家具上時，點得到小東西）。
 */
export function hotspotAt(bg: BackgroundScene, p: PxPoint): HotspotDef | null {
  let best: HotspotDef | null = null;
  for (const h of bg.hotspots) {
    if (!inRect(p, h.rect)) continue;
    if (!best || h.rect.w * h.rect.h < best.rect.w * best.rect.h) best = h;
  }
  return best;
}

// ───────────── 背景圖 → 格子地圖 ─────────────

/**
 * 把背景場景換算成原本的格子地圖：
 *   - 一格能走 = 格子中心在某塊地板裡，而且不在擋路的家具、障礙物裡
 *   - sleep → 原本的床（kind 'bed'）；shop → 原本的商店；door → 原本的門；其他 → kind 'hotspot'
 * base 是原本的 Tiled 地圖（拿它的圖塊集，給「擺家具」用）；沒有也可以。
 */
export function buildBackgroundMap(bg: BackgroundScene, tileSize: number, base?: MapModel): MapModel {
  const c = imgToMap(bg, tileSize);
  const W = bg.tiles.w;
  const H = bg.tiles.h;
  const blockers = [...(bg.obstacles ?? []), ...bg.hotspots.filter((h) => h.blocks !== false && h.action.type !== 'door').map((h) => h.rect)];
  const blocked: boolean[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const center = { x: ((x + 0.5) * tileSize) / c.sx, y: ((y + 0.5) * tileSize) / c.sy };
      const floor = bg.floor.some((r) => inRect(center, r));
      blocked.push(!floor || blockers.some((r) => inRect(center, r)));
    }
  }
  const walk = (t: TilePos) => t.x >= 0 && t.y >= 0 && t.x < W && t.y < H && !blocked[t.y * W + t.x];
  /** 指定的站位不能走（量歪了）時，找最近一格能走的 */
  const nearestWalkable = (t: TilePos): TilePos | null => {
    if (walk(t)) return t;
    let best: TilePos | null = null;
    let bd = Infinity;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.abs(x - t.x) + Math.abs(y - t.y);
        if (d < bd && walk({ x, y })) {
          bd = d;
          best = { x, y };
        }
      }
    }
    return best;
  };

  const spawns: MapModel['spawns'] = {};
  for (const [k, s] of Object.entries(bg.spawns)) {
    const t = nearestWalkable(c.tile(s));
    if (t) spawns[k] = { tile: t, face: s.face };
  }
  const spots: Record<string, SpotDef> = {};
  for (const [k, s] of Object.entries(bg.spots ?? {})) {
    const t = nearestWalkable(c.tile(s));
    if (t) spots[k] = { name: k, tile: t, face: s.face, emote: s.emote, action: s.action, seat: s.seat ? c.point(s.seat) : undefined };
  }

  const doors: DoorDef[] = [];
  const interactables: Interactable[] = [];
  for (const h of bg.hotspots) {
    const rect = c.tileRect(h.rect);
    const stand = h.stand ? nearestWalkable(c.tile(h.stand)) : null;
    const label = h.hint ?? h.name;
    const a = h.action;
    if (a.type === 'door') {
      const at = stand ?? nearestWalkable({ x: rect.x, y: rect.y + rect.h - 1 });
      // 門的格子範圍只算站位那一格：自己走（玩家模式）踩到才出門；點擊判定用原圖範圍
      const r = at ? { x: at.x, y: at.y, w: 1, h: 1 } : rect;
      // 有好幾個目的地：每個目的地一扇門（同一個站位），尋路和世界地圖才知道這裡通到哪些地方
      const opts = a.options?.length ? a.options : [{ to: a.to, spawn: a.spawn, label, unlock: h.unlock }];
      opts.forEach((o, k) => doors.push({ id: k ? `${h.id}#${o.to}` : h.id, rect: r, stand: at, to: o.to, spawn: o.spawn, label: o.label, unlock: o.unlock ?? h.unlock }));
      continue;
    }
    interactables.push({
      id: h.id,
      kind: a.type === 'sleep' ? 'bed' : a.type === 'shop' ? 'shop' : 'hotspot',
      rect,
      stands: stand ? [stand] : [],
      standFixed: !!stand,
      label,
      unlock: h.unlock,
      shop: a.type === 'shop' ? a.shop : undefined,
      hotspot: h,
      petSeat: h.seat ? c.point(h.seat) : undefined,
    });
  }

  return {
    width: W,
    height: H,
    tileSize,
    layers: [],
    tileset: base?.tileset ?? { firstgid: 1, columns: 1, tilecount: 0, image: '', names: [] },
    blocked,
    spawns,
    doors,
    spots,
    interactables,
    areas: [],
    background: { image: bg.image, actorScale: bg.actorScale ?? 1, scene: bg },
  };
}

/** 她到了沒：熱區有指定站位 → 要站在那一格；沒有 → 緊貼範圍就算 */
export function reachedTarget(t: TilePos, it: Interactable): boolean {
  if (it.standFixed) return it.stands.some((s) => s.x === t.x && s.y === t.y);
  return isNear(t, it.rect);
}

// ───────────── 檢查 ─────────────

/** 檢查 interactables.json；回傳問題清單（空的 = 沒問題） */
export function validateInteractables(
  file: unknown,
  ctx: { scenes: string[]; clips?: string[]; shops?: string[]; unlocks?: string[]; games?: string[]; taps?: string[]; snacks?: string[] } = { scenes: [] },
): string[] {
  const out: string[] = [];
  const f = file as InteractablesFile;
  if (!f || typeof f !== 'object' || f.version !== 1 || !f.scenes || typeof f.scenes !== 'object') return ['interactables.json：要有 version: 1 和 scenes'];
  for (const [sid, bg] of Object.entries(f.scenes)) {
    const at = `interactables.json scenes.${sid}`;
    if (ctx.scenes.length && !ctx.scenes.includes(sid)) out.push(`${at}：scenes.json 裡沒有這個場景`);
    if (!bg.image) out.push(`${at}：缺 image`);
    const { w, h } = bg.imageSize ?? ({} as { w: number; h: number });
    if (!(w > 0 && h > 0)) {
      out.push(`${at}：imageSize 要寫原圖寬高`);
      continue;
    }
    if (!(bg.tiles?.w > 0 && bg.tiles?.h > 0)) out.push(`${at}：tiles 要寫換算成幾格`);
    else if (Math.abs(w / h - bg.tiles.w / bg.tiles.h) > 0.08) out.push(`${at}：tiles 的寬高比（${bg.tiles.w}×${bg.tiles.h}）跟原圖（${w}×${h}）差太多，圖會被拉扁`);
    const inside = (r: PxRect) => r && r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1 && r.y + r.h <= h + 1;
    if (!bg.floor?.length) out.push(`${at}：至少要有一塊 floor（可以走的地板）`);
    bg.floor?.forEach((r, i) => !inside(r) && out.push(`${at}.floor[${i}]：範圍超出原圖`));
    bg.obstacles?.forEach((r, i) => !inside(r) && out.push(`${at}.obstacles[${i}]：範圍超出原圖`));
    if (!bg.spawns?.default) out.push(`${at}：spawns 要有 default`);
    for (const [k, sp] of Object.entries(bg.spots ?? {})) {
      if (sp.seat && (sp.seat.x < 0 || sp.seat.y < 0 || sp.seat.x > w || sp.seat.y > h)) out.push(`${at} 地點「${k}」：seat 超出原圖`);
      if (sp.action && ctx.clips && !['swim'].includes(sp.action) && !ctx.clips.includes(sp.action)) out.push(`${at} 地點「${k}」：character.json 沒有動作 ${sp.action}`);
    }
    const ids = new Set<string>();
    for (const hs of bg.hotspots ?? []) {
      const ht = `${at} 熱區「${hs.id}」`;
      if (!hs.id || ids.has(hs.id)) out.push(`${ht}：id 空白或重複`);
      ids.add(hs.id);
      if (!hs.name) out.push(`${ht}：缺 name`);
      if (!inside(hs.rect)) out.push(`${ht}：rect 範圍不對或超出原圖`);
      if (hs.stand && (hs.stand.x < 0 || hs.stand.y < 0 || hs.stand.x > w || hs.stand.y > h)) out.push(`${ht}：stand 超出原圖`);
      if (hs.seat && (hs.seat.x < 0 || hs.seat.y < 0 || hs.seat.x > w || hs.seat.y > h)) out.push(`${ht}：seat 超出原圖`);
      if (hs.seat && !hs.pose) out.push(`${ht}：有 seat 就要有 pose（坐下的動作）`);
      const a = hs.action;
      if (!a || !(HOTSPOT_ACTIONS as readonly string[]).includes(a.type)) {
        out.push(`${ht}：action.type 要是 ${HOTSPOT_ACTIONS.join('、')} 其中一個`);
        continue;
      }
      if (a.type === 'open_ui' && !(HOTSPOT_UIS as readonly string[]).includes(a.ui)) out.push(`${ht}：open_ui 的 ui 要是 ${HOTSPOT_UIS.join('、')}`);
      if (a.type === 'show_dialogue' && !(Array.isArray(a.lines) && a.lines.length && a.lines.every((l) => typeof l === 'string' && l))) out.push(`${ht}：show_dialogue 要有 lines`);
      if (a.type === 'shop' && ctx.shops && !ctx.shops.includes(a.shop)) out.push(`${ht}：gameplay.json 沒有商店 ${a.shop}`);
      if (a.type === 'door' && ctx.scenes.length) {
        for (const to of [a.to, ...(a.options ?? []).map((o) => o.to)]) if (!ctx.scenes.includes(to)) out.push(`${ht}：門通往不存在的場景 ${to}`);
      }
      if (a.type === 'door' && a.options) for (const o of a.options) if (!o.label) out.push(`${ht}：門的 options 每一個都要有 label`);
      if (a.type === 'play' && ctx.games && !ctx.games.includes(a.game)) out.push(`${ht}：leisure.json 沒有遊戲 ${a.game}`);
      if (a.type === 'drink' && ctx.taps && !ctx.taps.includes(a.table)) out.push(`${ht}：stats.json 的 drink 沒有 ${a.table}`);
      if (a.type === 'eat' && a.snack && ctx.snacks && !ctx.snacks.includes(a.snack)) out.push(`${ht}：leisure.json 的 snacks 沒有 ${a.snack}`);
      if (hs.pose && ctx.clips && !ctx.clips.includes(hs.pose)) out.push(`${ht}：character.json 沒有動作 ${hs.pose}`);
      if (hs.unlock && ctx.unlocks && !ctx.unlocks.includes(hs.unlock)) out.push(`${ht}：gameplay.json 沒有解鎖項目 ${hs.unlock}`);
    }
    // 換算後：出生點和每個熱區的站位都要走得到
    if (!out.some((p) => p.startsWith(at))) {
      const m = buildBackgroundMap(bg, 16);
      if (!m.spawns.default) out.push(`${at}：default 出生點附近沒有能走的格子`);
      for (const it of m.interactables) if (it.standFixed && !it.stands.length) out.push(`${at} 熱區「${it.id}」：站位附近沒有能走的格子`);
      for (const d of m.doors) if (!d.stand) out.push(`${at} 門「${d.id}」：附近沒有能走的格子`);
    }
  }
  return out;
}
