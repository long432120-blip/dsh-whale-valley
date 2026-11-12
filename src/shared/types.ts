import type { ChatReply, ChatRequest } from './ai.ts';
// ─────────────────────────────────────────────────────────────
// 所有座標都用「舞台百分比」(0–100)，跟解析度無關，換圖不用改數字。
// ─────────────────────────────────────────────────────────────
export type Pct = number;
export type SceneId = string;
import type { ActError, GameAction, GameEvent, GameplayFile, GameState, GameView, ItemId } from './gameplay-types.ts';

export type DayPhase = 'morning' | 'afternoon' | 'evening' | 'night';
/**
 * 台詞觸發時機：點她 / 進入場景 / 離開很久後回來；
 * V0.2 玩法：餵食 / 吃不下 / 好感升級 / 體力不夠 / 釣到東西 / 收成 / 沒有種子 / 交換
 */
export type LineTrigger =
  | 'click' | 'enter' | 'welcome'
  | 'feed' | 'full' | 'levelup' | 'tired' | 'caught' | 'harvest' | 'no_seed' | 'trade'
  /** V0.4：節慶當天打招呼、結婚、出發去礦洞、從礦洞回來、婚後早上幫忙 */
  | 'festival' | 'married' | 'mine_go' | 'mine_back' | 'help';

// ───────────── scenes.json ─────────────
export interface ScenesFile {
  version: 1;
  /** CSS aspect-ratio，例如 "16 / 9"；背景圖請照這個比例出圖 */
  aspectRatio: string;
  initialScene: SceneId;
  scenes: SceneDef[];
}

export interface SceneDef {
  id: SceneId;
  name: string;
  /** 相對於角色包根目錄的路徑 */
  background: string;
  walkArea: WalkArea;
  /** 出生點（角色中心的 x）。必須有 "default"；其他 key 給熱區的 spawn 使用 */
  spawns: { default: Pct } & Record<string, Pct>;
  hotspots: Hotspot[];
}

export interface WalkArea {
  /** 角色「中心點」可走的左右範圍 */
  xMin: Pct;
  xMax: Pct;
  /** 腳底的高度（由上往下量）；一條水平地面線，V0.1 夠用 */
  groundY: Pct;
  /** 遠近縮放：花園比較遠可以設 0.9；預設 1 */
  scale?: number;
}

export interface Hotspot {
  id: string;
  /** 滑鼠移上去顯示的文字，也是無障礙標籤 */
  label: string;
  /** 熱區矩形：左上角 x/y 與寬高，全部是舞台百分比 */
  rect: { x: Pct; y: Pct; w: Pct; h: Pct };
  action: GotoAction;
}

export interface GotoAction {
  type: 'goto';
  scene: SceneId;
  /** 對應目標場景 spawns 的 key；省略就用 default */
  spawn?: string;
}

// ───────────── character.json ─────────────
export interface CharacterFile {
  version: 1;
  id: string;
  name: string;
  sprites: {
    idle: SpriteDef;
    /** 沒有走路圖就沿用 idle，再加上 walkBob 的上下晃動 */
    walk?: SpriteDef;
  };
  /** 立繪原圖的朝向；front 代表正面，走動時不翻轉 */
  facing: 'front' | 'left' | 'right';
  /** 立繪高度佔舞台高度的百分比（會再乘上場景的 scale） */
  heightPct: Pct;
  /** 走路速度：每秒走幾 % 舞台寬 */
  speed: Pct;
  /** 每次發呆多久（毫秒），在範圍內隨機 */
  idleMs: [number, number];
  /** 走路時上下輕晃 */
  walkBob?: boolean;
  bubble: { durationMs: number };
  lines: LineDef[];
}

export interface SpriteDef {
  /** 單張圖，或「水平排列」的 sprite sheet */
  src: string;
  /** sheet 的幀數；1 = 靜態圖 */
  frames?: number;
  fps?: number;
}

export interface LineDef {
  text: string;
  /** 預設 ['click'] */
  on?: LineTrigger[];
  /** 只在這些場景說；省略 = 不限 */
  scenes?: SceneId[];
  /** 只在這些時段說；省略 = 不限 */
  phases?: DayPhase[];
  /** 權重，預設 1 */
  weight?: number;
  /** 說這句時播放的動作（像素版 character.json 的 actions.clips 名稱；V0.1 忽略） */
  action?: string;
  /** 只對這些物品說（例如餵河豚時的專屬台詞） */
  items?: ItemId[];
  /** 只對這些物品分類說（fish / crop / junk…） */
  categories?: string[];
  /** 需要全部符合的標籤：liked（喜歡）、disliked（討厭）、capped（今天好感已達上限） */
  tags?: string[];
  /** 好感到多少才會說：用來解鎖台詞 */
  minAffection?: number;
}

// ───────────── Host 存檔 ─────────────
export interface PetSave {
  /** V0.2 起是 2（多了 game）；讀到 1 會自動升級 */
  version: 2;
  /** 對 host 來說是不透明字串；不認得的 id 由前端退回 initialScene */
  sceneId: SceneId;
  createdAt: number;
  /** lazy tick 的基準時間；V0.2 的飽食/心情衰減就算在 tick() 裡 */
  lastTickAt: number;
  /** 上次有人打開畫面的時間，用來算「離開多久」 */
  lastSeenAt: number;
  pokes: number;
  /** V0.2 玩法狀態：體力、飽食、好感、揹包、農田 */
  game: GameState;
}

/** host 給前端的唯讀快照；前端只看這個，不直接碰存檔 */
export interface PetView {
  sceneId: SceneId;
  phase: DayPhase;
  /** 這次打開畫面前，主人離開了幾分鐘（只有 visit() 會給出有意義的值） */
  awayMinutes: number;
  ageDays: number;
  pokes: number;
  now: number;
  /** V0.2 玩法狀態（host 有載入 gameplay.json 才有） */
  game?: GameView;
}

export type ActResult =
  | { ok: true; event: GameEvent; view: PetView }
  | { ok: false; error: ActError; view: PetView };

/**
 * 前端與 host 之間唯一的介面。
 * - Demo 用 LocalBridge（localStorage 模擬 host）
 * - DSH 裡換成 DshBridge（透過宿主通道呼叫 service）
 */
export interface HostBridge {
  /** 打開畫面時、以及畫面開著時定期呼叫：結算時間、更新「上次見面」，回傳 awayMinutes */
  visit(): Promise<PetView>;
  /** 唯讀快照，不更新「上次見面」：給 tool 或其他插件查狀態用 */
  getView(): Promise<PetView>;
  setScene(sceneId: SceneId): Promise<PetView>;
  poke(): Promise<PetView>;
  /** V0.2：所有玩法動作（釣魚、播種、收成、餵食、交換）的唯一入口 */
  act(action: GameAction): Promise<ActResult>;
  /** V0.2：host 合併好 mods 的玩法定義（給前端顯示名稱、emoji、商人清單）；沒有玩法時回傳 null */
  gameplay(): Promise<GameplayFile | null>;
  /** V0.8：AI 對話。沒有實作、或回傳 ok: false 時，畫面用 JSON 台詞 */
  chat?(req: ChatRequest): Promise<ChatReply>;
  /**
   * V0.21：要跟玩家說的一次性提醒（例如「存檔壞掉了，已經備份並開新遊戲」）。
   * 讀了就清掉；沒有實作就當作沒有提醒。
   */
  takeNotice?(): string | null;
  /**
   * V0.20：玩家自己的 API Key 設定（只有單機版有；DSH 版的 Key 在 host，瀏覽器碰不到）。
   * 有這個，側邊欄才會出現 🔑 按鈕。
   */
  /** V0.23：存檔格（3 格）與開新遊戲；朋友家（VisitBridge）沒有 */
  readonly slots?: import('./save-slots.ts').SlotApi;
  readonly aiSettings?: {
    readonly hasKey: boolean;
    masked(): string;
    save(key: string): void;
    clear(): void;
    test(key?: string): Promise<{ ok: true } | { ok: false; message: string }>;
  };
}
