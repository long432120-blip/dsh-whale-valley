import type { BackgroundScene, HotspotDef } from './hotspots.ts';
// V0.2 像素版的資料格式。座標一律用「格子」(tile)，不用百分比。
// 地圖本身用 Tiled 編輯器的 JSON（.tmj / .tsj），這裡只定義角色包外層的兩個檔案。
import type { DayPhase, LineDef } from './types.ts';

export type Facing = 'down' | 'left' | 'right' | 'up';
export interface TilePos { x: number; y: number }

// ───────────── packs/<name>/scenes.json（version 2） ─────────────
export interface PixelWorldFile {
  version: 2;
  /** 圖塊邊長（像素），要跟 Tiled 地圖一致 */
  tileSize: number;
  /** 畫面固定顯示幾格；比較小的地圖（例如室內）會置中，四周填黑 */
  viewport: { tilesX: number; tilesY: number };
  initialScene: string;
  scenes: {
    id: string;
    name: string;
    /** 相對於角色包根目錄 */
    /** Tiled 地圖；V0.11：整張背景圖的場景（interactables.json 有它）可以不寫 */
    map?: string;
    /** 戶外：下雨天會畫雨 */
    outdoor?: boolean;
    /** 世界地圖（🗺️）上的位置（格子座標）；省略 = 不顯示在世界地圖 */
    mapPos?: { x: number; y: number };
    /** 世界地圖上的圖示 */
    icon?: string;
  }[];
  /** V0.16：畫面上的 HUD（時間與天氣木牌） */
  hud?: { clock?: ClockHudDef };
  /** V0.18：氣氛：季節粒子（戶外）、現實時間太晚時提醒休息 */
  ambient?: AmbientDef;
}

import type { ClockHudDef } from './clock-hud.ts';

/** V0.18：一種像素粒子（季節、天氣） */
export interface AmbientFxDef {
  kind: 'petal' | 'firefly' | 'leaf' | 'snow';
  colors: string[];
  count: number;
  size: [number, number];
  fall: [number, number];
  sway: [number, number];
  dayRatio?: number;
  rainRatio?: number;
}

/** V0.18：scenes.json 的 ambient */
export interface AmbientDef {
  /** 季節 id → 粒子設定（只在 outdoor 的地圖；下雨、下雪的日子不出現，一次只有一種） */
  seasons?: Record<string, AmbientFxDef>;
  /** V0.19：天氣 id → 粒子設定（例如雪天的雪花）；有設定的天氣用它取代季節粒子 */
  weather?: Record<string, AmbientFxDef>;
  /** 現實時間（玩家電腦的時鐘，不是遊戲時間）fromHour 點以後、toHour 點以前：她提醒主人去睡覺 */
  lateNight?: { fromHour: number; toHour: number; repeatMinutes: number; maxPerNight: number; lines: string[] };
}

// ───────────── packs/<name>/character.json（version 2） ─────────────
export interface PixelCharacterFile {
  version: 2;
  id: string;
  name: string;
  /** 擴展 E3：主人（玩家操控模式）的走路圖；格式同 world */
  player?: SheetDef & { rows: Record<Facing, number>; idle: number; walk: number[]; fps: number };
  /** 地圖上走路用的圖：每一列是一個方向，每一欄是一個動作幀 */
  world: SheetDef & {
    rows: Record<Facing, number>;
    /** 站著用哪一欄 */
    idle: number;
    /** 眨眼用哪一欄（可省略） */
    blink?: number;
    /** 走路循環依序用哪些欄 */
    walk: number[];
    /** 走路循環每一幀往上抬幾個地圖像素，長度要跟 walk 一樣（可省略） */
    walkBob?: number[];
    fps: number;
  };
  /**
   * 動作表（可省略）：停下來、說話、到定點時播放的正面動作。
   * 台詞的 action、Tiled 地點的 action 屬性、onClick 都用 clips 的名稱來指定。
   */
  actions?: SheetDef & {
    /** 點她時，如果抽到的台詞沒有指定動作，就播這個 */
    onClick?: string;
    clips: Record<string, ClipDef>;
  };
  /** 對話框裡的大頭像：單張圖或水平 sprite sheet */
  portrait?: { src: string; frames?: number; fps?: number };
  /** 頭上冒的小表情：水平排列、正方形 */
  emotes?: { src: string; size: number; names: string[] };
  /** 每秒走幾格 */
  speed: number;
  idleMs: [number, number];
  dialogue: { charsPerSec: number; holdMs: number };
  /** 作息：每個時段想待在哪個場景、會去哪些地點（地點名稱對應 Tiled 裡 type=spot 的物件） */
  schedule?: Partial<Record<DayPhase, { scene: string; spots: string[] }>>;
  lines: LineDef[];
}

/** 一張排成格子的角色圖 */
export interface SheetDef {
  src: string;
  frameWidth: number;
  frameHeight: number;
  /** 腳底在單幀裡的 y（像素），用來把角色「站」在格子上 */
  footY: number;
  /**
   * 角色圖的 1 像素等於幾個地圖像素（預設 1）。
   * 細緻的角色圖可以用 1/3：在最常見的 3 倍放大下剛好一對一，其他倍率會平滑縮放。
   */
  drawScale?: number;
}

/** 一段動作：用動作表的第 row 列，依序播放 frames 裡的欄 */
export interface ClipDef {
  row: number;
  frames: number[];
  fps: number;
  /**
   * 播完後從 frames 的第幾個開始重複（坐著、睡覺這種會一直維持的動作）。
   * 省略 = 播一次就回到普通站姿。
   */
  loop?: number;
  /**
   * V0.15：這個動作用自己的一張圖（例如酒館坐著喝、浴池游泳），不用動作表。
   * 圖是側面朝右；她面向左時會左右翻轉。
   */
  sheet?: SheetDef & { faces?: 'right' | 'left' };
}

// ───────────── 解析後的地圖（renderer 與檢查工具共用） ─────────────
export interface MapModel {
  width: number;
  height: number;
  tileSize: number;
  layers: { name: string; above: boolean; gids: number[] }[];
  tileset: {
    firstgid: number;
    columns: number;
    tilecount: number;
    /** 相對於角色包根目錄 */
    image: string;
    /** 每個圖塊的名稱（tiles.tsj 的 type）；換地板、壁紙時用名稱找圖塊 */
    names: string[];
  };
  /** width*height；true = 不能走 */
  blocked: boolean[];
  spawns: Record<string, { tile: TilePos; face?: Facing }>;
  doors: DoorDef[];
  spots: Record<string, SpotDef>;
  /** 可以互動的地方（釣魚區、農田、商人、機器、建築、居民、礦洞、告示牌） */
  interactables: Interactable[];
  /** 不能點、只用來標範圍的區域：動物圍欄（pen）、礦洞地面（area） */
  areas: AreaDef[];
  /** V0.9：這個場景用一張背景圖畫（interactables.json），不畫圖塊 */
  background?: { image: string; actorScale: number; scene: BackgroundScene };
}

export interface AreaDef {
  name: string;
  kind: 'pen' | 'area';
  rect: { x: number; y: number; w: number; h: number };
  building?: string;
}

export type InteractableKind = 'fishing' | 'plot' | 'shop' | 'machine' | 'building' | 'npc' | 'mine' | 'sign' | 'bed' | 'hotspot';

export interface Interactable {
  /** Tiled 物件名稱；農田在存檔裡的 id 是「場景 id/名稱」 */
  id: string;
  kind: InteractableKind;
  rect: { x: number; y: number; w: number; h: number };
  /** 範圍外圍、上下左右緊貼、可以走的格子：她要站在這裡才能操作 */
  stands: TilePos[];
  label: string;
  /** fishing：用 gameplay.json 的哪個掉落表 */
  table?: string;
  /** 要先在 gameplay.json 的 unlocks 解鎖；沒解鎖前點了會開解鎖面板 */
  unlock?: string;
  /** machine：機器種類；building：建築 id；npc：居民 id */
  machine?: string;
  building?: string;
  npc?: string;
  /** 解鎖後畫在上面的圖示（emoji） */
  icon?: string;
  /** V0.15：圖示改用這個物品的圖（素材表有圖時），例如魚攤畫一條魚 */
  iconItem?: string;
  /** sign：點了顯示的文字 */
  text?: string;
  /** shop：用 gameplay.json 的哪個商人 */
  shop?: string;
  /** V0.9：背景圖場景的互動熱區（interactables.json）；有它就用原圖像素做點擊判定與高亮 */
  hotspot?: HotspotDef;
  /** V0.9：stands 是 interactables.json 指定的，擺家具重算時不要覆蓋 */
  standFixed?: boolean;
  /** V0.13：酒館裡的 NPC 站的位置（地圖像素，腳）；hideBelow = 這條線（地圖像素 y）以下不畫 */
  seat?: { x: number; y: number; hideBelow?: number };
  /** V0.16：她在這個熱區擺 pose 時坐的位置（地圖像素，腳）；interactables.json 的 seat 換算來的 */
  petSeat?: { x: number; y: number };
}

export interface DoorDef {
  id: string;
  /** 可點擊範圍（格子） */
  rect: { x: number; y: number; w: number; h: number };
  /** 她要走到哪一格才算「出門」：範圍內最下方、可行走的那一格 */
  stand: TilePos | null;
  to: string;
  spawn?: string;
  label: string;
  /** 要先解鎖才能通過 */
  unlock?: string;
}

export interface SpotDef {
  name: string;
  tile: TilePos;
  face?: Facing;
  /** 走到這裡時頭上冒的表情 */
  emote?: string;
  /** 走到這裡時播放的動作（clips 名稱），例如坐下、打瞌睡 */
  action?: string;
  /** V0.16：坐下的位置（地圖像素，不一定對齊格子） */
  seat?: { x: number; y: number };
}
