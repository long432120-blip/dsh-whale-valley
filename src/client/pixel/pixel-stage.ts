// 像素版渲染器：Canvas 2D、整數倍放大、Tiled 地圖、找路走動、星露谷式對話框。
// 玩家不操控角色（A 方案）：她照作息自己生活；點她說話、點地面叫她過去、點門帶她出門。
// V0.2：點池塘釣魚、點農田種菜／收成、點商人換種子、揹包餵食；規則都在 host（bridge.act）。
import { buildDefs, footprint, inFootprint, mineMaxFloor, mineZone } from '../../shared/gameplay.ts';
import { catchChance } from '../../shared/pets.ts';
import { dayKey } from '../../shared/time.ts';
import { COIN, type ActError, type GameAction, type GameEvent, type GameplayDefs, type ItemId, type MineReport, type TradeDef } from '../../shared/gameplay-types.ts';
import { pickLineDef, type LineContext } from '../../shared/lines.ts';
import { distances, findPath } from '../../shared/path.ts';
import type { ClipDef, DoorDef, Facing, Interactable, MapModel, SheetDef, SpotDef, TilePos } from '../../shared/pixel-types.ts';
import { pickDestination, scheduledScene } from '../../shared/schedule.ts';
import { faceToward, isWalkable, standTiles } from '../../shared/tiled.ts';
import type { ActResult, DayPhase, HostBridge, LineTrigger, PetView } from '../../shared/types.ts';
import { DialogueBox } from './dialogue.ts';
import { hotspotAt, imgToMap, reachedTarget, type PxRect } from '../../shared/hotspots.ts';
import { animalFrame, cropFrame, itemFrame, monsterFrame, objectFrame, type SpriteFrame } from '../../shared/sprites.ts';
import { RateGate, snapshotFromView, type AiEvent, type AiSpeaker, type AiTrigger } from '../../shared/ai.ts';
import type { LoadedPixelPack } from './pack-loader.ts';
import { ensurePixelStyles } from './pixel-css.ts';
import { minigameEnabled, playMinigame, setMinigameEnabled } from './minigame.ts';
import { buildBag, buildCodex, buildShop, Hud, itemLabel, Modal, Panel, setItemIcons, Toasts, type BagTab } from './ui-panels.ts';
import { buildCatch, buildPets, buildPetShop } from './ui-panels-v6.ts';
import { createPetLayer } from './pets-client.ts';
import { buildCards, buildCoinFlip, type CardOpponent, type CardState, type FlipState } from './ui-tavern.ts';
import { MusicPlayer } from './music-player.ts';
import { buildFurnitureCatalog, type CatalogTab } from './ui-furniture.ts';
import { buildMeal, type FoodRow, type FridgeState } from './ui-meal.ts';
import { ClockHud } from './clock-hud.ts';
import { buildDiary } from './ui-diary.ts';
import { buildAiSettings } from './ui-ai-settings.ts';
import { devLog, isDevMode } from '../dev-flag.ts';
import { i18n, I18nManager, t, type Locale } from '../i18n.ts';
import type { ShellApi } from '../game-shell.ts';
import { encodeInvite, type VisitBridge } from '../visit.ts';
import { buildAdoption, buildChat, buildLetterComposer, buildMailbox, buildMarket, buildSettings, buildVisitModal, copyToClipboard, modalToast, type MarketTab, type VisitTab } from './ui-social.ts';
import { SeasonFx } from './season-fx.ts';
import { lateNightDue, parseLateNight } from '../../shared/late-night.ts';
import { pickTrack } from '../../shared/music.ts';
import {
  buildAnimals, buildGifts, buildMachine, buildMine, buildNpc, buildReport, buildSell, buildUnlock, buildWorldMap, button, decodeCard, el as uiEl, encodeCard,
  formatDuration, type CardData,
} from './ui-panels-v4.ts';

export interface PixelStageOptions {
  pack: LoadedPixelPack;
  bridge: HostBridge;
  /** 向 host 輪詢的間隔（DSH 目前不保證會把宿主事件推到瀏覽器） */
  pollMs?: number;
  rng?: () => number;
  onView?: (view: PetView) => void;
  /** V0.22：外殼（串門切換、聊天室）；沒有就沒有這些功能 */
  shell?: ShellApi;
}

export interface PixelStageHandle {
  goto(sceneId: string, spawn?: string): Promise<void>;
  say(trigger: LineTrigger): void;
  /** 重新「打開畫面」：結算離開時間；離開夠久，她會已經照作息換了地方，並跟你打招呼 */
  visit(): Promise<void>;
  /** 向 host 拿最新狀態（時段變了，她會自己走去下一個地方） */
  refresh(): Promise<void>;
  dispose(): void;
}

type Goal =
  | { kind: 'spot'; spot: SpotDef }
  | { kind: 'door'; door: DoorDef }
  | { kind: 'tile' }
  | { kind: 'interact'; target: Interactable; sceneId: string }
  | null;

const ERROR_TEXT: Partial<Record<ActError, string>> = {
  no_item: '數量不夠',
  not_food: '這個不能吃喔',
  plot_busy: '這格已經種了東西',
  plot_empty: '這格是空地',
  not_ready: '還沒成熟',
  not_seed: '這不是種子',
  no_game: '這個版本沒有玩法資料',
  not_for_sale: '這個不能賣',
  locked: '還沒解鎖',
  already: '已經做過了',
  busy: '機器還在用',
  no_room: '空間不夠了，先升級建築',
  too_deep: '還不能去那麼深',
  weak_pickaxe: '鎬子不夠力，去鐵匠舖換一把',
  away: '她去礦洞了，回來之前做不了',
  not_today: '今天沒有賣這個',
  too_soon: '今天已經送過了',
  bad_code: '這串碼不對喔',
  already_watered: '土還是濕的，不用再澆',
  has_sprinkler: '這格已經有灑水器了',
  wrong_season: '這個季節種不活',
  too_many_pets: '寵物養滿了，先放生一隻',
  gone: '已經不在了',
  not_hungry: '牠現在不餓',
  not_here: '要在同一張地圖才行',
  sold_out: '今天賣完了，明天再來',
};
/** V0.22：社交相關的錯誤（文字在語言包） */
const SOCIAL_ERRORS: Partial<Record<ActError, string>> = {
  bad_code: 'err.badCode', own_code: 'err.ownCode', not_yours: 'err.notYours', bad_price: 'err.badPrice',
  visitor: 'err.visitor', already: 'err.already', cooldown: 'err.cooldown', gone: 'err.gone', no_item: 'err.noCoins',
  no_room: 'err.stallFull', too_many_pets: 'err.tooManyPets', sold_out: 'err.soldOut', not_for_sale: 'err.notForSale',
};

const GIFT_REACTION = { love: '哇！這是我最喜歡的！', like: '謝謝，我很喜歡。', neutral: '謝謝你。', dislike: '呃……這個我不太需要。' } as const;
/** 解鎖「stable」（馬廄）後，她在戶外走路的速度倍率 */
const HORSE_SPEED = 1.6;
const DIRS_V: Record<Facing, { x: number; y: number }> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
const UI_FONT = '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';

const PHASE_TINT: Record<DayPhase, string | null> = {
  morning: null,
  afternoon: null,
  evening: 'rgba(255,140,80,0.16)',
  night: 'rgba(20,28,90,0.45)',
};
const FADE_MS = 280;
const EMOTE_MS = 1600;
const WELCOME_AFTER_MIN = 60;

export async function mountPixelStage(root: HTMLElement, opts: PixelStageOptions): Promise<PixelStageHandle> {
  const { pack, bridge } = opts;
  const { world, character: ch } = pack;
  const rng = opts.rng ?? Math.random;
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  ensurePixelStyles(doc);

  const TS = world.tileSize;
  const VW = world.viewport.tilesX * TS;
  const VH = world.viewport.tilesY * TS;
  const worldImg = pack.images[ch.world.src]!;
  const emoteImg = ch.emotes ? pack.images[ch.emotes.src] : undefined;
  const actionsImg = ch.actions ? pack.images[ch.actions.src] : undefined;

  // ── 1. DOM：舞台 > canvas + 門的提示 + 轉場黑幕 + 對話框 ──
  const el = (cls: string) => Object.assign(doc.createElement('div'), { className: cls });
  const stage = el('px-stage');
  stage.style.aspectRatio = `${VW} / ${VH}`;
  const canvas = doc.createElement('canvas');
  canvas.className = 'px-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${ch.name}的家。按 Enter 和她說話`);
  const tip = el('px-tip');
  const fade = el('px-fade');
  stage.append(canvas, tip, fade);
  // V0.6：地圖在左、所有 UI（狀態列、任務、按鈕、面板、提示）在右邊的側邊欄，不蓋在地圖上
  const app = el('px-app');
  // V0.10：揹包、圖鑑的物品圖示用素材表的圖集（CSS 背景切一塊）
  if (pack.sprites?.atlas && pack.sprites.atlasUrl) {
    app.style.setProperty('--px-atlas', `url("${pack.sprites.atlasUrl}")`);
    setItemIcons({ file: pack.sprites.file, w: pack.sprites.atlas.naturalWidth, h: pack.sprites.atlas.naturalHeight });
  } else setItemIcons(null);
  const shell = el('px-shell');
  const side = el('px-side');
  const sideInner = el('px-side-inner');
  const sideTop = el('px-side-top');
  const sideToggle = Object.assign(doc.createElement('button'), { className: 'px-side-toggle', type: 'button' });
  sideTop.append(sideToggle, Object.assign(doc.createElement('span'), { textContent: ch.name }));
  sideInner.append(sideTop);
  side.append(sideInner);
  shell.append(stage, side);
  app.append(shell);
  root.append(app);
  const SIDE_KEY = 'whale-pet:side-collapsed';
  function setSideCollapsed(on: boolean) {
    shell.classList.toggle('px-side-collapsed', on);
    sideToggle.textContent = on ? '⟨' : '⟩ 收起';
    sideToggle.title = on ? '打開側邊欄' : '收起側邊欄（地圖變大）';
    sideToggle.setAttribute('aria-expanded', String(!on));
    try {
      localStorage.setItem(SIDE_KEY, on ? '1' : '');
    } catch {
      // 存不了就算了
    }
  }
  sideToggle.addEventListener('click', () => {
    setSideCollapsed(!shell.classList.contains('px-side-collapsed'));
    resize();
  });
  setSideCollapsed((() => {
    try {
      return localStorage.getItem(SIDE_KEY) === '1';
    } catch {
      return false;
    }
  })());
  const dialog = new DialogueBox(stage, {
    name: ch.name,
    portraitUrl: pack.portraitUrl,
    portraitFrames: ch.portrait?.frames,
    portraitFps: ch.portrait?.fps,
    ...ch.dialogue,
  });
  const ctx = canvas.getContext('2d')!;
  i18n().patchContext(ctx); // V0.22：簡體模式時，畫布上的字也轉

  // ── V0.2 玩法：host 有玩法定義才啟用狀態列、揹包、釣魚、種菜、商人 ──
  // V0.22：在朋友家（VisitBridge）：唯讀，只能聊天、澆水、留信
  const visiting = (bridge as Partial<VisitBridge>).visiting ? (bridge as VisitBridge) : null;
  const gameplayFile = await bridge.gameplay().catch(() => null);
  const gdefs: GameplayDefs | null = gameplayFile ? buildDefs(gameplayFile) : null;
  const hud = gdefs
    ? new Hud(sideInner, [
        { icon: '🎒', title: '揹包（B）', label: '打開揹包', onClick: () => toggleBag(), key: 'bag' },
        { icon: '🗺️', title: '地圖（M）：點地點，她會自己走過去', label: '打開地圖', onClick: () => toggleWorldMap('walk'), key: 'worldmap' },
        { icon: '🌀', title: '一鍵傳送（T）：點地點，直接傳送過去', label: '一鍵傳送', onClick: () => toggleWorldMap('teleport'), key: 'teleport' },
        ...(pack.music ? [{ icon: '🔊', title: '背景音樂（N）：開／關', label: '背景音樂開關', onClick: () => toggleMusic(), cls: 'px-music-btn' }] : []),
        { icon: '📖', title: '圖鑑（C）', label: '打開魚類圖鑑', onClick: () => toggleCodex(), key: 'codex' },
        ...(gameplayFile?.furniture && !visiting ? [{ icon: '🪑', title: '家具目錄（F）：買家具、二手賣出', label: '家具目錄', onClick: () => toggleCatalog(), key: 'catalog' }] : []),
        // V0.22：在朋友家不能裝修、寄禮物、看日記
        ...(!visiting ? [
          { icon: '🛠️', title: '裝修模式（R）：擺家具、收回家具', label: '裝修模式', onClick: () => toggleDecorMode(), cls: 'px-decor-btn' },
          { icon: '🎁', title: '禮物碼與名片（G）', label: '禮物碼', onClick: () => openGifts(), key: 'gifts' },
        ] : []),
        ...(gameplayFile?.diary && !visiting ? [{ icon: '📔', title: '鯨魚娘的日記（L）：每天睡覺時她會寫一篇', label: '鯨魚娘的日記', onClick: () => toggleDiary(), key: 'diary' }] : []),
        ...(gameplayFile?.pets ? [{ icon: '🐾', title: '寵物（K）', label: '打開寵物', onClick: () => togglePets(), key: 'pets' }] : []),
        ...(ch.player ? [{ icon: '🕹️', title: '自己走（P）：方向鍵移動，她跟在後面', label: '玩家操控', onClick: () => setPlayerMode(!player.on), cls: 'px-player-btn' }] : []),
        // V0.20：單機版才有（DSH 版的 Key 在 host）
        ...(bridge.aiSettings && !visiting ? [{ icon: '🔑', title: 'AI 對話設定（I）：填你自己的 DeepSeek API Key', label: 'AI 對話設定', onClick: () => toggleAiSettings(), key: 'aikey' }] : []),
        // V0.22：社交（在朋友家只留聊天室和留信）
        ...(gameplayFile?.social && !visiting ? [
          { icon: '🏪', title: t('hud.market'), label: t('hud.market'), onClick: () => toggleMarket(), key: 'market' },
          { icon: '📮', title: t('hud.mail'), label: t('hud.mail'), onClick: () => toggleMail(), key: 'mail' },
        ] : []),
        ...(gameplayFile?.social && visiting ? [{ icon: '✉️', title: t('hud.letter'), label: t('hud.letter'), onClick: () => toggleLetter(), key: 'letter' }] : []),
        ...(opts.shell?.chat ? [{ icon: '💬', title: t('hud.chat'), label: t('hud.chat'), onClick: () => toggleChat(), key: 'chat' }] : []),
        ...(gameplayFile?.social && !visiting ? [{ icon: '⚙️', title: t('hud.settings'), label: t('hud.settings'), onClick: () => toggleSettings(), key: 'settings' }] : []),
      ])
    : null;
  // V0.16：時間與天氣木牌（scenes.json 的 hud.clock）；在畫布後面，黑幕、對話框會蓋在它上面
  const clockHud = gdefs && world.hud?.clock ? new ClockHud(stage, world.hud.clock, (p) => pack.asset(p), canvas) : null;
  const outdoor = new Set(world.scenes.filter((s) => s.outdoor).map((s) => s.id));
  stage.append(dialog.el); // 對話框疊在狀態列上面
  const modeHost = el('px-side-status'); // 戰鬥血量、裝修模式的提示放這裡（任務框在它前面）
  sideInner.append(modeHost);
  // V0.6.2：系統面板（揹包、圖鑑、寵物、地圖、禮物碼）在側邊欄；
  // 跟地圖上的東西互動（商店、機器、動物、礦洞、送禮、睡覺、捕捉…）用畫面中央的模態視窗
  // 世界地圖也用大視窗：側邊欄太窄，地點會擠在一起
  const MODAL_KINDS = new Set(['shop', 'sell', 'unlock', 'machine', 'animals', 'mine', 'report', 'sleep', 'catch', 'gift', 'worldmap', 'arcade', 'cards', 'catalog', 'meal', 'diary', 'aikey', 'market', 'visit']);
  const sidePanel = new Panel(sideInner);
  const modal = new Modal(shell);
  /** 兩個面板合起來的介面：其他程式只要說「開哪一種」，這裡決定開在側邊欄還是模態視窗 */
  const panel = {
    get kind() {
      return modal.kind ?? sidePanel.kind;
    },
    get isOpen() {
      return modal.isOpen || sidePanel.isOpen;
    },
    get isShown() {
      return modal.isOpen || sidePanel.isShown;
    },
    close() {
      if (modal.isOpen) modal.close();
      else sidePanel.close();
    },
    dispose() {
      modal.dispose();
      sidePanel.dispose();
    },
  };
  // V0.12：地圖用「一鍵傳送」模式開著時，亮的是 🌀 按鈕
  const hudKind = (k: string | null) => (k === 'worldmap' && mapMode === 'teleport' ? 'teleport' : k);
  sidePanel.onChange = (k) => hud?.setOpen(hudKind(modal.kind ?? k));
  modal.onChange = (k) => hud?.setOpen(hudKind(k ?? sidePanel.kind));
  sidePanel.onShow = () => {
    if (!shell.classList.contains('px-side-collapsed')) return;
    setSideCollapsed(false);
    resize();
  };
  const toasts = new Toasts(sideInner); // 側邊欄最下面
  stage.append(fade); // 轉場黑幕永遠在最上層
  let bagTab: BagTab = 'all';
  let selectedSeed: ItemId | undefined;
  /** 手上拿著灑水器：下一次點田就安裝 */
  let holdingSprinkler = false;
  let openShopId: string | null = null;
  let fishing: { skip: () => void } | null = null;
  let growthTimer: ReturnType<typeof setTimeout> | undefined;
  /** 面板開著時，狀態變了要重畫：每個面板把自己的畫法放在這裡 */
  let panelRender: (() => void) | null = null;
  /** 裝修模式：holding = 手上的家具；沒拿東西時點家具會收回 */
  let decorMode = false;
  let holding: ItemId | null = null;
  const modeTag = Object.assign(doc.createElement('div'), { className: 'px-mode' });
  modeTag.hidden = true;
  modeHost.append(modeTag);
  let mineFloor = 1;
  let lastGiftCode: string | null = null;
  let friendCard: CardData | null = null;
  /** 動物在圍欄裡閒晃的位置（只在畫面上，不存檔） */
  const animalPos = new Map<number, { x: number; y: number; tx: number; ty: number; flip: boolean }>();

  // ── 2. 整數倍放大：每個像素都是同樣大小的方塊（Windows 125%/150% 縮放也不會一格寬一格窄） ──
  let scale = 1;
  function resize() {
    const dpr = win.devicePixelRatio || 1;
    // 地圖用整數倍放大；側邊欄拿剩下的寬度。窄的時候側邊欄排到下面，地圖用整個寬度
    const stacked = win.getComputedStyle(shell).flexDirection === 'column';
    const sideMin = stacked ? 0 : shell.classList.contains('px-side-collapsed') ? 58 : 230;
    // 容器實際可用寬度（沒有下限）。低於 320px 時只能縮小，不能假裝放得下。
    const room = (shell.clientWidth || VW) - sideMin - (stacked ? 0 : 8);
    const avail = Math.max(VW / dpr, room);
    scale = Math.max(1, Math.floor((avail * dpr) / VW));
    const wantW = (VW * scale) / dpr;
    // 容器比 320px 還窄（極窄浮層、分割視窗）時，等比縮小到放得下，
    // 否則右邊會被 overflow:clip 裁掉，而且沒有捲軸可以補救。
    const shownW = room > 0 ? Math.min(wantW, room) : wantW;
    const shownH = shownW * (VH / VW);
    canvas.width = VW * scale;
    canvas.height = VH * scale;
    canvas.style.width = `${shownW}px`;
    canvas.style.height = `${shownH}px`;
    stage.style.width = stacked ? '' : `${shownW}px`;
    draw(performance.now());
  }
  // ResizeObserver 的回呼裡會改 stage/canvas 的尺寸，而觀察對象是父層 shell，
  // 同步執行會變成「改尺寸 → 再觸發」的回饋迴圈（瀏覽器會噴
  // "ResizeObserver loop completed with undelivered notifications"）。
  // 排到下一幀再算，一幀只算一次。
  let resizeRaf = 0;
  function scheduleResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      resize();
    });
  }
  const ro = new ResizeObserver(scheduleResize);
  ro.observe(shell);

  // ── 3. 地圖：底層與「above」層各預先畫成一張圖，每幀只要貼上去 ──
  let map!: MapModel;
  /** 角色包裡原本的地圖；map = 原本的地圖＋擺上去的家具和田 */
  let baseMap!: MapModel;
  let placedSig = '';
  let decorSig = '';
  let sceneId = '';
  let below!: HTMLCanvasElement;
  let above: HTMLCanvasElement | null = null;
  let ox = 0;
  let oy = 0;
  // V0.9：背景圖場景（interactables.json）
  let actorScale = 1;
  let bgCache: { canvas: HTMLCanvasElement; scale: number; src: string } | null = null;
  /** 滑鼠正停在哪個熱區上（地圖像素），畫高亮框用 */
  let hoverHs: { rect: PxRect; locked: boolean } | null = null;
  /** 熱區讓她擺的姿勢（沙發几 → 坐下），介面關掉前一直維持 */
  let seatedPose: string | null = null;

  /**
   * V0.10：有高解析圖塊（sprites.json 的 tilesHd，跟 tiles.png 同排列、每格放大 R 倍）就用它，
   * 圖層畫成 R 倍大，貼到畫面時再照放大倍率縮一次（blitLayer）。沒有就照舊用 16px。
   */
  function hdTiles(m: MapModel): { img: HTMLImageElement; r: number } | null {
    const hd = pack.sprites?.tilesHd;
    const base = pack.images[m.tileset.image];
    const r = pack.sprites?.tilesHdScale ?? 1;
    if (!hd || !base || r <= 1 || hd.naturalWidth !== base.naturalWidth * r || hd.naturalHeight !== base.naturalHeight * r) return null;
    return { img: hd, r };
  }

  function renderLayers(m: MapModel, wantAbove: boolean, swap?: Map<number, number>): HTMLCanvasElement | null {
    const hd = hdTiles(m);
    const R = hd?.r ?? 1;
    const c = doc.createElement('canvas');
    c.width = m.width * TS * R;
    c.height = m.height * TS * R;
    const g = c.getContext('2d')!;
    const img = hd?.img ?? pack.images[m.tileset.image]!;
    const S = TS * R;
    const { firstgid, columns, tilecount } = m.tileset;
    let drew = false;
    for (const l of m.layers) {
      if (l.above !== wantAbove) continue;
      l.gids.forEach((gid0, i) => {
        const gid = swap?.get(gid0) ?? gid0;
        const id = gid - firstgid;
        if (!gid || id < 0 || id >= tilecount) return;
        g.drawImage(img, (id % columns) * S, Math.floor(id / columns) * S, S, S,
          (i % m.width) * S, Math.floor(i / m.width) * S, S, S);
        drew = true;
      });
      if (l.name === 'ground' && !wantAbove) softEdges(m, l.gids, g, img, S);
    }
    return drew || !wantAbove ? c : null;
  }

  /**
   * V0.13：小路、沙灘、石板路跟草地的交界原本是直角硬邊。
   * 在交界處把旁邊那格草地的圖，用鋸齒狀的遮罩往路上多畫一小條，看起來像草長過界。
   */
  function softEdges(m: MapModel, gids: number[], g: CanvasRenderingContext2D, img: CanvasImageSource, S: number) {
    const { firstgid, columns, names } = m.tileset;
    const nameAt = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) return '';
      const id = gids[y * m.width + x]! - firstgid;
      return id >= 0 ? names[id] ?? '' : '';
    };
    const soft = (n: string) => /^(path|sand|pave)/.test(n);
    const grass = (n: string) => /^grass/.test(n);
    const band = Math.round(S * 0.2);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (!soft(nameAt(x, y))) continue;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          const nb = nameAt(x + dx, y + dy);
          if (!grass(nb)) continue;
          const id = gids[(y + dy) * m.width + x + dx]! - firstgid;
          const sx = (id % columns) * S;
          const sy = Math.floor(id / columns) * S;
          g.save();
          g.beginPath();
          // 鋸齒邊：沿著交界走，每一小段長出去的深度不一樣（用座標當種子，每次畫都一樣）
          const steps = 8;
          const along = (k: number) => (k / steps) * S;
          const depth = (k: number) => band * (0.35 + 0.65 * Math.abs(Math.sin((x * 7.3 + y * 3.1 + k * 1.7) * (dx || 1) * (dy || 1))));
          const X0 = x * S;
          const Y0 = y * S;
          if (dy === -1 || dy === 1) {
            const edge = dy === -1 ? Y0 : Y0 + S;
            const sgn = dy === -1 ? 1 : -1;
            g.moveTo(X0, edge);
            for (let k = 0; k <= steps; k++) g.lineTo(X0 + along(k), edge + sgn * depth(k));
            g.lineTo(X0 + S, edge);
          } else {
            const edge = dx === -1 ? X0 : X0 + S;
            const sgn = dx === -1 ? 1 : -1;
            g.moveTo(edge, Y0);
            for (let k = 0; k <= steps; k++) g.lineTo(edge + sgn * depth(k), Y0 + along(k));
            g.lineTo(edge, Y0 + S);
          }
          g.closePath();
          g.clip();
          // 草地那格的圖往路這邊平移一格畫：接縫處的花紋是連續的
          g.drawImage(img, sx, sy, S, S, X0, Y0, S, S);
          g.restore();
        }
      }
    }
  }

  // ── 4. 角色狀態 ──
  const pet = {
    tile: { x: 0, y: 0 } as TilePos,
    px: 0,
    py: 0,
    face: 'down' as Facing,
    path: [] as TilePos[],
    goal: null as Goal,
    walking: false,
    idleUntil: 0,
    walkClock: 0,
    blinkUntil: 0,
    nextBlink: 0,
    /** 正在播放的動作（動作表）；null = 用走路圖 */
    clip: null as { name: string; def: ClipDef; start: number } | null,
    /** V0.16：坐在椅子上的位置（地圖像素）：播 clip 這個動作時畫在這裡，其他時候回到格子上 */
    seat: null as { x: number; y: number; clip: string } | null,
  };
  let emote: { name: string; start: number } | null = null;
  let marker: { tile: TilePos; until: number } | null = null;
  let view: PetView | undefined;
  let pendingScene: string | null = null;
  let busy = false;
  let disposed = false;
  let lastLine: string | undefined;
  let raf = 0;

  const rand = (a: number, b: number) => a + rng() * (b - a);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const feet = (t: TilePos) => ({ x: t.x * TS + TS / 2, y: t.y * TS + TS - 2 });
  const warn = (what: string) => (err: unknown) => console.warn(`[whale-pet] ${what} failed`, err);

  function applyScene(id: string, spawnKey = 'default') {
    sceneId = pack.maps[id] ? id : world.initialScene;
    baseMap = pack.maps[sceneId]!;
    placedSig = decorSig = '\u0000';
    deriveMap();
    above = renderLayers(map, true);
    animalPos.clear();
    petLayer?.resetScene();
    ox = Math.floor((VW - map.width * TS) / 2);
    oy = Math.floor((VH - map.height * TS) / 2);
    actorScale = map.background?.actorScale ?? 1;
    hoverHs = null;
    seatedPose = null;
    const sp = map.spawns[spawnKey] ?? map.spawns.default;
    placeAt(sp?.tile ?? firstWalkable(map), sp?.face ?? 'down');
    stage.dataset.scene = sceneId;
    if (pendingScene === sceneId) pendingScene = null;
    updateMusic();
  }

  function placeAt(t: TilePos, face: Facing) {
    const f = feet(t);
    Object.assign(pet, { tile: { ...t }, px: f.x, py: f.y, face, path: [], goal: null, clip: null, seat: null });
    idle();
  }

  /** V0.16：坐到椅子上（熱區、地點的 seat）；clip = 坐著的動作 */
  function sitAt(seat: { x: number; y: number } | undefined, clip: string) {
    if (!seat) return;
    pet.seat = { x: seat.x, y: seat.y, clip };
    pet.px = seat.x;
    pet.py = seat.y;
  }
  /** 坐著的動作在播：畫在椅子上；換成別的動作（揮手、被點）就回到格子上 */
  function syncSeat() {
    if (!pet.seat || pet.walking || swim) return;
    const p = pet.clip?.name === pet.seat.clip ? pet.seat : feet(pet.tile);
    pet.px = p.x;
    pet.py = p.y;
  }

  /** 播放動作表裡的一段動作；動作表都是正面，所以會轉向前方 */
  function playClip(name: string | undefined): boolean {
    const def = name ? ch.actions?.clips[name] : undefined;
    if (!def || (!actionsImg && !def.sheet)) return false;
    if (def.sheet && !pack.images[def.sheet.src]) return false;
    pet.clip = { name: name!, def, start: performance.now() };
    if (!def.sheet) pet.face = 'down'; // V0.15：自己一張圖的動作（側面）照目前的方向
    return true;
  }

  /** 目前動作該顯示哪一欄；播完（且不重複）就回到走路圖 */
  function clipColumn(now: number): number | null {
    const c = pet.clip;
    if (!c) return null;
    const { frames, fps, loop } = c.def;
    const k = Math.floor(((now - c.start) / 1000) * fps);
    if (k < frames.length) return frames[Math.max(0, k)]!;
    if (loop === undefined) {
      pet.clip = null;
      return null;
    }
    return frames[loop + ((k - frames.length) % (frames.length - loop))]!;
  }

  const clipMs = (def: ClipDef) => (def.frames.length / def.fps) * 1000;

  function idle(ms = rand(ch.idleMs[0], ch.idleMs[1])) {
    pet.walking = false;
    pet.idleUntil = performance.now() + ms;
  }

  function showEmote(name: string) {
    if (ch.emotes?.names.includes(name)) emote = { name, start: performance.now() };
  }

  function walkTo(t: TilePos, goal: Goal): boolean {
    const p = findPath(map, pet.tile, t);
    if (p === null) {
      showEmote('dots');
      idle();
      return false;
    }
    pet.goal = goal;
    pet.path = p;
    if (pet.seat) {
      // 從椅子上起身：先回到站位那一格再走（不然會從椅子斜斜地滑過去）
      const f = feet(pet.tile);
      Object.assign(pet, { px: f.x, py: f.y, seat: null });
    }
    if (!p.length) arrive();
    else {
      pet.walking = true;
      pet.clip = null; // 起身走路
    }
    return true;
  }

  function arrive() {
    pet.walking = false;
    const g = pet.goal;
    pet.goal = null;
    checkForage(pet.tile); // 走到掉落物上：順手撿起來
    if (g?.kind === 'interact') {
      // 到了再確認一次：路上可能換了場景，或被別的點擊取代
      if (g.sceneId === sceneId && reachedTarget(pet.tile, g.target)) void interact(g.target);
      else {
        showEmote('dots');
        idle();
      }
    } else if (g?.kind === 'door') {
      void goto(g.door.to, g.door.spawn);
    } else if (g?.kind === 'spot') {
      if (g.spot.face) pet.face = g.spot.face;
      if (g.spot.emote && rng() < 0.6) showEmote(g.spot.emote);
      if (g.spot.action === 'swim') {
        // V0.15：浴池旁的地點：下水游一下
        if (!startSwim(rand(9000, 16000))) idle();
      } else if (playClip(g.spot.action)) {
        sitAt(g.spot.seat, g.spot.action!); // V0.16：酒館的椅子
        // 坐下、打瞌睡這種會維持的動作，多待一會兒
        const def = pet.clip!.def;
        idle(def.loop !== undefined ? rand(ch.idleMs[0] * 3, ch.idleMs[1] * 3) : clipMs(def) + rand(ch.idleMs[0], ch.idleMs[1]));
      } else idle(rand(ch.idleMs[0] * 1.5, ch.idleMs[1] * 1.5));
    } else idle();
  }

  /** 發呆結束：要換場景就走去門口，否則照作息挑下一個地方 */
  function decide() {
    if (!view) return idle();
    if (playingNow() && !away()) return void sitForPlay(); // V0.11：在玩遊戲，不亂走
    if (swim) return void (pet.idleUntil = Infinity); // V0.15：在游泳，游完自己上岸
    if (travelStep()) return;
    if (player.on) return followPlayer();
    if (pendingScene && pendingScene !== sceneId) {
      const door = map.doors.find((d) => d.to === pendingScene && d.stand);
      if (door) {
        walkTo(door.stand!, { kind: 'door', door });
        return;
      }
      pendingScene = null;
    }
    const d = pickDestination(ch, view.phase, sceneId, map, pet.tile, rng);
    if (!d) idle();
    else if (d.kind === 'spot') walkTo(d.spot.tile, { kind: 'spot', spot: d.spot });
    else walkTo(d.tile, { kind: 'tile' });
  }

  // ── 5. 每幀更新：沿著路徑一格一格走 ──
  function update(now: number, dt: number) {
    if (now >= pet.nextBlink) {
      pet.blinkUntil = now + 140;
      pet.nextBlink = now + rand(2500, 5500);
    }
    if (gdefs) updateAnimals(dt);
    updateSwim(now, dt); // V0.15
    petLayer?.update(dt, now);
    updatePlayer(dt, now);
    if (player.on && (player.tile.x !== lastPlayerTile.x || player.tile.y !== lastPlayerTile.y)) {
      lastPlayerTile = { ...player.tile };
      checkForage(player.tile); // 主人自己走過去也撿得到
    }
    updateCombat(dt, now);
    syncSeat(); // V0.16
    if (busy || dialog.open || away()) return; // 說話時停下來，就像星露谷的 NPC；去礦洞時不在
    if (pet.walking) {
      const next = pet.path[0]!;
      const f = feet(next);
      const dx = f.x - pet.px;
      const dy = f.y - pet.py;
      const dist = Math.hypot(dx, dy);
      const horse = view?.game?.unlocked.includes('stable') && outdoor.has(sceneId) ? HORSE_SPEED : 1;
      const step = ch.speed * horse * TS * dt;
      if (Math.abs(dx) > Math.abs(dy)) pet.face = dx > 0 ? 'right' : 'left';
      else if (dy !== 0) pet.face = dy > 0 ? 'down' : 'up';
      pet.walkClock += dt;
      if (dist <= step) {
        pet.px = f.x;
        pet.py = f.y;
        pet.tile = next;
        pet.path.shift();
        if (!pet.path.length) arrive();
      } else {
        pet.px += (dx / dist) * step;
        pet.py += (dy / dist) * step;
      }
    } else if (now >= pet.idleUntil) {
      decide();
    }
  }

  // ── 6. 繪製：底層 → 點擊標記 → 影子 → 角色 → above 層 → 時段濾色 → 表情 ──
  function draw(now: number) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#120e1c';
    ctx.fillRect(0, 0, VW, VH);
    if (!map) return;
    blitLayer(below);
    if (map.background) drawBackground();

    if (marker && now < marker.until) {
      const x = ox + marker.tile.x * TS;
      const y = oy + marker.tile.y * TS;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const [cx, cy] of [[1, 1], [TS - 4, 1], [1, TS - 2], [TS - 4, TS - 2]] as const) {
        ctx.fillRect(x + cx, y + cy, 3, 1);
      }
      for (const [cx, cy] of [[1, 1], [TS - 2, 1], [1, TS - 4], [TS - 2, TS - 4]] as const) {
        ctx.fillRect(x + cx, y + cy, 1, 3);
      }
    }

    drawExits(now);
    if (gdefs && view?.game) {
      drawExtras(now);
      drawCrops(now);
      petLayer?.drawGround(now);
    }
    drawCombat(now);
    drawDecorPreview();
    if (away()) {
      petLayer?.draw(now, Infinity, false);
      drawPlayer(now);
      finishDraw(now);
      return;
    }
    if (player.py <= pet.py) drawPlayer(now);
    petLayer?.draw(now, pet.py, false); // 寵物：在她後面的先畫

    const w = ch.world;
    const sx = ox + Math.round(pet.px);
    const sy = oy + Math.round(pet.py);
    const sw = Math.max(8, Math.round(w.frameWidth * (w.drawScale ?? 1) * actorScale * 0.4));
    ctx.fillStyle = 'rgba(20,20,40,0.28)';
    ctx.fillRect(sx - Math.floor(sw / 2), sy - 1, sw, 3);
    ctx.fillRect(sx - Math.floor(sw / 2) - 1, sy, sw + 2, 1);

    // 播動作時用動作表，否則用走路圖
    const clipCol = clipColumn(now);
    let sheet: SheetDef = w;
    let img = worldImg;
    let col = w.idle;
    let row = w.rows[pet.face];
    let bob = 0;
    let flip = false;
    const own = pet.clip?.def.sheet;
    if (clipCol !== null && own && pack.images[own.src]) {
      // V0.15：酒館坐著喝、浴池游泳：動作自己一張圖（側面朝右；面向左就翻過來）
      sheet = own;
      img = pack.images[own.src]!;
      col = clipCol;
      row = pet.clip!.def.row;
      flip = (own.faces ?? 'right') === 'right' ? pet.face === 'left' : pet.face === 'right';
    } else if (clipCol !== null && ch.actions && actionsImg) {
      sheet = ch.actions;
      img = actionsImg;
      col = clipCol;
      row = pet.clip!.def.row;
    } else if (pet.walking) {
      const k = Math.floor(pet.walkClock * w.fps) % w.walk.length;
      col = w.walk[k]!;
      bob = w.walkBob?.[k] ?? 0;
    } else if (w.blink !== undefined && now < pet.blinkUntil && pet.face !== 'up') {
      col = w.blink;
    }
    drawFrame(img, sheet, col, row, sx, sy, bob, flip);
    drawFoodPop(now, sx, sy, Math.round(sheet.footY * (sheet.drawScale ?? 1) * actorScale)); // V0.16
    if (player.py > pet.py) drawPlayer(now);
    petLayer?.draw(now, pet.py, true);
    const clipName = pet.clip?.name ?? '';
    if (stage.dataset.clip !== clipName) stage.dataset.clip = clipName; // 方便除錯與測試
    const where = `${pet.tile.x},${pet.tile.y}${pet.goal ? `>${pet.goal.kind}` : ''}`;
    if (stage.dataset.tile !== where) stage.dataset.tile = where;

    finishDraw(now);

    if (emote && emoteImg && ch.emotes) {
      const t = now - emote.start;
      if (t > EMOTE_MS) emote = null;
      else {
        const s = ch.emotes.size;
        const idx = ch.emotes.names.indexOf(emote.name);
        const rise = Math.round(Math.min(1, t / 200) * 3);
        const head = Math.round(sheet.footY * (sheet.drawScale ?? 1) * actorScale);
        ctx.drawImage(emoteImg, idx * s, 0, s, s, sx - Math.floor(s / 2), sy - head - s + 2 - rise, s, s);
      }
    }
  }

  /**
   * V0.9：背景圖。先照目前的放大倍率縮一次存起來（高品質縮圖），之後每一幀直接貼上；
   * 這樣原圖的細節保留到螢幕解析度，不會被縮成 16px 格子的解析度。
   */
  function drawBackground() {
    const bg = map.background!;
    const img = pack.images[bg.image];
    if (!img) return;
    if (!bgCache || bgCache.scale !== scale || bgCache.src !== bg.image) {
      const c = doc.createElement('canvas');
      c.width = map.width * TS * scale;
      c.height = map.height * TS * scale;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      bgCache = { canvas: c, scale, src: bg.image };
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bgCache.canvas, ox * scale, oy * scale);
    ctx.restore();
  }

  /**
   * V0.10：把預先畫好的圖層貼到畫面。高解析圖層先照目前的放大倍率縮一次存起來（高品質縮圖），
   * 之後每一幀直接貼；16px 圖層照舊直接貼（交給 canvas 的最近鄰放大）。
   */
  const layerCache = new WeakMap<HTMLCanvasElement, { scale: number; canvas: HTMLCanvasElement }>();
  function blitLayer(src: HTMLCanvasElement) {
    const w = map.width * TS;
    if (src.width === w) return void ctx.drawImage(src, ox, oy);
    let c = layerCache.get(src);
    if (!c || c.scale !== scale) {
      const out = doc.createElement('canvas');
      out.width = w * scale;
      out.height = map.height * TS * scale;
      const g = out.getContext('2d')!;
      // 縮小用高品質平滑；放大（很大的螢幕）用最近鄰，保持像素感
      g.imageSmoothingEnabled = out.width < src.width;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, out.width, out.height);
      c = { scale, canvas: out };
      layerCache.set(src, c);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(c.canvas, ox * scale, oy * scale);
    ctx.restore();
  }

  /** V0.9：滑鼠停在可以互動的家具上：柔和的發光框（一閃一閃），讓人知道這裡可以點 */
  function drawHotspotHover(now: number) {
    if (!hoverHs || busy || dialog.open) return;
    const r = hoverHs.rect;
    const k = 0.55 + 0.25 * Math.sin(now / 260);
    const x = ox + r.x;
    const y = oy + r.y;
    ctx.save();
    ctx.fillStyle = hoverHs.locked ? `rgba(40,30,60,${0.18 * k})` : `rgba(255,244,214,${0.16 * k})`;
    roundRect(x, y, r.w, r.h, 3);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hoverHs.locked ? `rgba(200,190,220,${k})` : `rgba(255,236,170,${k})`;
    roundRect(x + 0.5, y + 0.5, r.w - 1, r.h - 1, 3);
    ctx.stroke();
    ctx.restore();
  }
  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** above 層、雨、時段濾色、鎖頭（角色之後畫） */
  function finishDraw(now: number) {
    if (above) blitLayer(above);
    drawWeather(now);
    drawSeason(now, 'normal'); // V0.18：季節粒子（跟著時段變暗）
    const tint = view ? PHASE_TINT[view.phase] : null;
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(ox, oy, map.width * TS, map.height * TS);
    }
    drawSeason(now, 'glow'); // 晚上的螢火蟲畫在夜色上面
    drawHearts(now); // V0.18：摸頭、願望實現的愛心
    if (gdefs && view?.game) {
      drawLocks();
      drawGuide(now);
      updateGuide(now);
    }
    drawHotspotHover(now);
  }

  function drawFrame(img: HTMLImageElement, sh: SheetDef, col: number, row: number, sx: number, sy: number, bob: number, flip = false) {
    const ds = (sh.drawScale ?? 1) * actorScale; // V0.9：背景圖場景可以把她縮小一點（interactables.json 的 actorScale）
    const srcX = col * sh.frameWidth;
    const srcY = row * sh.frameHeight;
    if (ds === 1) {
      const dx = sx - Math.floor(sh.frameWidth / 2);
      const dy = sy - sh.footY - bob;
      if (!flip) return void ctx.drawImage(img, srcX, srcY, sh.frameWidth, sh.frameHeight, dx, dy, sh.frameWidth, sh.frameHeight);
      ctx.save();
      ctx.translate(dx + sh.frameWidth, dy);
      ctx.scale(-1, 1); // V0.15：左右翻轉
      ctx.drawImage(img, srcX, srcY, sh.frameWidth, sh.frameHeight, 0, 0, sh.frameWidth, sh.frameHeight);
      ctx.restore();
      return;
    }
    // 細緻角色圖：直接在螢幕像素座標上畫，位置對齊整數像素；剛好一對一時不做平滑，保持銳利
    const dw = Math.round(sh.frameWidth * ds * scale);
    const dh = Math.round(sh.frameHeight * ds * scale);
    const dx = Math.round((sx - (sh.frameWidth * ds) / 2) * scale);
    const dy = Math.round((sy - sh.footY * ds - bob) * scale);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = dw !== sh.frameWidth || dh !== sh.frameHeight;
    ctx.imageSmoothingQuality = 'high';
    if (flip) {
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1); // V0.15：左右翻轉
      ctx.drawImage(img, srcX, srcY, sh.frameWidth, sh.frameHeight, 0, 0, dw, dh);
    } else ctx.drawImage(img, srcX, srcY, sh.frameWidth, sh.frameHeight, dx, dy, dw, dh);
    ctx.restore();
  }

  // ── 7. 說話 ──
  /**
   * 說一句話；台詞有指定動作就播（點她時沒指定就播 onClick）。
   * extra：物品、標籤等條件，vars：替換台詞裡的 {level} 這類變數；after：對話框關掉後要做的事。
   */
  function say(
    trigger: LineTrigger,
    extra: Partial<LineContext> & { vars?: Record<string, string> } = {},
    after?: () => void,
  ): { shown: boolean; played: boolean } {
    if (!view || !map) return { shown: false, played: false };
    const { vars, ...more } = extra;
    const ctxLine: LineContext = { trigger, sceneId, phase: view.phase, affection: view.game?.affection ?? 0, ...more };
    const line = pickLineDef(ch.lines, ctxLine, rng, lastLine);
    if (!line) {
      after?.();
      return { shown: false, played: false };
    }
    lastLine = line.text;
    const text = line.text.replace(/\{(\w+)\}/g, (m, k: string) => vars?.[k] ?? m);
    return showLine(text, line.action ?? (trigger === 'click' ? ch.actions?.onClick : undefined), after);
  }

  /** 把一句話放進她的對話框（逐字打出來）；JSON 台詞和 AI 台詞都走這裡 */
  function showLine(text: string, action?: string, after?: () => void): { shown: boolean; played: boolean } {
    // V0.16：坐在椅子上說話：繼續坐著（不換成站著的動作，免得從椅子上跳下來）
    const keepSeat = !!(pet.seat && seatedPose && pet.clip?.name === seatedPose);
    const played = keepSeat ? false : playClip(action);
    pet.idleUntil = Infinity; // 說話時不亂走；對話框關掉後再繼續
    dialog.show(text, () => {
      if (seatedPose && playClip(seatedPose)) pet.idleUntil = Infinity; // V0.9：還坐在沙發上
      else idle(700);
      after?.();
    }, (oy + pet.py) / VH > 0.55);
    return { shown: true, played };
  }

  // ───────────── V0.8：AI 對話 ─────────────
  // 瀏覽器這邊只決定「誰、為什麼說話」；API Key、提示詞、對話記憶都在 host（或 demo 的開發伺服器）。
  // 任何失敗（沒有 Key、逾時、網路、被限流）都回 null，呼叫的地方就改用 JSON 台詞，遊戲不會卡住。
  const aiGate = new RateGate(3000, 12); // 3 秒內最多送一次、一分鐘最多 12 次（狂點的時候直接用 JSON 台詞）
  let aiOff = !bridge.chat; // 沒有 Key／關掉了：這次遊戲就不再問了
  let thinking = false;
  const sceneTitle = (id: string) => pack.world.scenes.find((x) => x.id === id)?.name ?? id;
  const aiReady = () => !aiOff && !!gdefs && !!view?.game;

  async function aiLine(speaker: AiSpeaker, trigger: AiTrigger, event?: AiEvent): Promise<string | null> {
    if (!aiReady() || !bridge.chat) return null;
    if (aiGate.acquire('all') > 0) return null;
    try {
      // 快照只有 demo 開發伺服器會用；DSH 模式 bridge 會把它拿掉，host 自己讀存檔
      const snapshot = snapshotFromView(view!, gdefs!, sceneTitle, Date.now());
      const r = await Promise.race([
        bridge.chat({ speaker, trigger, event, snapshot }),
        new Promise<null>((ok) => setTimeout(() => ok(null), 15_000)), // 最後一道保險：host 沒回應也不會一直思考中
      ]);
      if (!r) return null;
      if (r.ok) return r.text;
      if (r.reason === 'no_key' || r.reason === 'disabled') aiOff = true;
      if (r.reason !== 'rate_limited') devLog(`[whale-pet] AI 沒有回話（${r.reason}），改用內建台詞`);
      return null;
    } catch (err) {
      warn('chat')(err);
      return null;
    } finally {
      aiGate.release('all');
    }
  }

  /**
   * 鯨魚娘用 AI 說一句：等待時頭上冒「思考中…」，到了用對話框逐字打出來；失敗就呼叫 fallback（JSON 台詞）。
   * mode 'bubble'：事件的感想（天氣變了、女神）用頭上的小氣泡，不打斷主人。
   */
  async function aiSay(trigger: AiTrigger, event: AiEvent | undefined, fallback: () => void, mode: 'dialog' | 'bubble' = 'dialog') {
    if (!aiReady() || thinking || away()) return fallback();
    thinking = true;
    pet.idleUntil = Infinity;
    showThinking(true);
    const text = await aiLine('whale', trigger, event);
    showThinking(false);
    thinking = false;
    if (!text) return fallback();
    if (mode === 'bubble') {
      idle(600);
      return speak([text], true);
    }
    showLine(text, trigger === 'click' ? ch.actions?.onClick : undefined);
  }

  function talk() {
    if (busy || away() || thinking) return;
    if (playingNow()) return void stopPlay(); // V0.11：玩遊戲時點她 → 叫她停下來
    if (swim) return void endSwim(true); // V0.15：游泳時點她 → 上岸
    Object.assign(pet, { path: [], goal: null, walking: false, face: 'down' as Facing });
    bridge.poke().then(setView, warn('poke'));
    void aiSay('click', undefined, () => {
      if (!say('click').played) showEmote('heart');
    });
  }

  // ── V0.2 玩法：走到旁邊才操作 ──
  const plotKey = (it: Interactable) => `${sceneId}/${it.id}`;
  const stop = (face: Facing) => {
    Object.assign(pet, { path: [], goal: null, walking: false, face });
    pet.clip = null;
  };

  function interactableAt(tx: number, ty: number): Interactable | undefined {
    return map.interactables.find((it) => tx >= it.rect.x && tx < it.rect.x + it.rect.w && ty >= it.rect.y && ty < it.rect.y + it.rect.h)
      ?? (gdefs ? npcAt(tx, ty) : undefined);
  }

  /** 已經在旁邊就直接做；不然走到最近、走得到的站位 */
  function approach(target: Interactable) {
    if (isLocked(target.unlock)) return openUnlock(target.unlock!);
    // 她不在（去礦洞）：釣魚、種田做不了；其他（商店、機器、居民…）主人自己去
    if (away()) {
      if (target.kind === 'fishing' || target.kind === 'plot') return void toasts.show(ERROR_TEXT.away!);
      return void interact(target);
    }
    if (!pet.walking && reachedTarget(pet.tile, target)) return void interact(target);
    // V0.9：熱區可以指定「原地觸發」或「黑幕一閃直接過去」
    const how = target.hotspot?.approach ?? 'walk';
    if (how === 'none') return void interact(target);
    const dist = distances(map, pet.tile);
    const d = (t: TilePos) => dist[t.y * map.width + t.x]!;
    const best = target.stands.filter((t) => Number.isFinite(d(t))).sort((a, b) => d(a) - d(b))[0];
    if (how === 'fade' || (!best && target.hotspot && target.stands.length)) return void blinkTo(target.stands[0]!, target);
    if (!best) return showEmote('dots');
    marker = { tile: best, until: performance.now() + 700 };
    walkTo(best, { kind: 'interact', target, sceneId });
  }

  async function interact(target: Interactable) {
    if (isLocked(target.unlock)) return openUnlock(target.unlock!);
    if (target.kind === 'fishing') await onWater(target);
    else if (target.kind === 'plot') await onPlot(target);
    else if (target.kind === 'machine') openMachine(target);
    else if (target.kind === 'building') openAnimals(target.building!);
    else if (target.kind === 'npc') openNpc(target.npc!);
    else if (target.kind === 'mine') openMine();
    else if (target.kind === 'bed') {
      if (!away()) stop(faceToward(pet.tile, target.rect));
      openSleep();
    }
    else if (target.kind === 'sign') {
      if (!away()) stop(faceToward(pet.tile, target.rect));
      toasts.show(`${target.icon ?? '📜'} ${target.text ?? target.label}`, 4200);
    } else if (target.kind === 'hotspot') runHotspot(target);
    else openShop(target);
  }

  // ───────────── V0.9：互動熱區（interactables.json） ─────────────
  /** 黑幕一閃，她直接出現在站位上（找不到路、或熱區指定 approach: fade） */
  async function blinkTo(t: TilePos, target: Interactable) {
    if (busy) return;
    busy = true;
    fade.classList.add('on');
    await wait(FADE_MS);
    placeAt(t, target.hotspot?.face ?? faceToward(t, target.rect));
    fade.classList.remove('on');
    busy = false;
    void interact(target);
  }

  /** 熱區的動作：sleep、shop、door 在別的地方處理（沿用原本的床、商店、門） */
  function runHotspot(it: Interactable) {
    const h = it.hotspot!;
    const a = h.action;
    const here = !away();
    if (here) {
      stop(h.face ?? faceToward(pet.tile, it.rect));
      if (h.emote) showEmote(h.emote);
    }
    /** 打開介面時她擺個姿勢（坐下…），介面關掉才起身 */
    const pose = () => {
      if (!here || !h.pose || !playClip(h.pose)) return undefined;
      pet.idleUntil = Infinity;
      seatedPose = h.pose; // 介面開著的期間一直維持（吃完東西說完話也坐回去）
      sitAt(it.petSeat, h.pose); // V0.16：坐到椅子上（不一定對齊格子）
      return () => {
        seatedPose = null;
        pet.seat = null;
        if (!pet.walking && !swim) {
          const f = feet(pet.tile);
          pet.px = f.x;
          pet.py = f.y;
        }
        idle(700);
      };
    };
    if (a.type === 'open_ui') {
      if (a.ui === 'bag') {
        if (a.tab) bagTab = a.tab as BagTab;
        showPanel('bag', renderBag, pose());
      } else if (a.ui === 'codex') showPanel('codex', renderCodex, pose());
      else if (a.ui === 'pets') {
        if (panel.kind !== 'pets') togglePets();
      } else if (a.ui === 'worldmap') {
        if (panel.kind !== 'worldmap') toggleWorldMap();
      } else if (a.ui === 'gifts') openGifts();
    } else if (a.type === 'eat') {
      // V0.16：坐下來，畫面中間跳出「要吃什麼」（揹包裡能吃的）；零食桌另外有免費的零食
      const sn = a.snack ? gdefs?.file.leisure?.snacks?.[a.snack] : undefined;
      openMeal(a.snack ? 'snack' : 'table', `${sn?.emoji ?? '🍽️'} ${h.name}`, a.snack, pose());
    } else if (a.type === 'fridge') {
      // 冰箱開著的時候，她站在冰箱前面看（不亂走）；關上才走開
      const sat = pose();
      if (here && !sat) pet.idleUntil = Infinity;
      void openFridge(h.name, sat ?? (() => { if (!away()) idle(700); }));
    } else if (a.type === 'show_dialogue') {
      const text = fillLine(pick(a.lines), worldVars());
      if (here) showLine(text, h.pose);
      else toasts.show(`${h.name}：${text}`, 4200);
    } else if (a.type === 'drink') {
      void drink(it, a.table);
    } else if (a.type === 'bath') {
      void takeBath(it);
    } else if (a.type === 'play') {
      void startPlay(a.game, it);
    } else if (a.type === 'coin_flip') {
      openCoinFlip();
    } else if (a.type === 'cards') {
      openCards(a.npc);
    }
  }

  // ───────────── V0.16：坐下來吃飯、零食桌、冰箱 ─────────────
  // 熱區被點 → 她走到站位、坐上椅子 → 畫面中間跳出「要吃什麼」。吃東西（feed）、零食（snack）、冰箱（fridge）都送 host。
  let meal: { kind: 'table' | 'snack' | 'fridge'; title: string; snack?: string; line?: string; eating?: boolean; fridge?: FridgeState } | null = null;
  /** 吃東西時頭上冒出來的食物（畫面效果） */
  let foodPop: { emoji: string; start: number } | null = null;
  const FOOD_POP_MS = 1300;

  function openMeal(kind: 'table' | 'snack' | 'fridge', title: string, snack?: string, onClose?: () => void) {
    meal = { kind, title, snack };
    stage.dataset.meal = kind;
    showPanel('meal', renderMeal, () => {
      meal = null;
      delete stage.dataset.meal;
      onClose?.();
    });
    // 視窗停在她的另一邊，看得到她坐著吃
    modal.dock(away() || (ox + pet.px) / VW > 0.5 ? 'left' : 'right');
  }
  function mealFoods(): FoodRow[] {
    const g = view?.game;
    if (!g || !gdefs) return [];
    const likes = new Set(gdefs.file.affection.likes ?? []);
    return Object.entries(g.inventory)
      .filter(([id, n]) => n > 0 && gdefs!.items.get(id)?.food)
      .map(([id, n]) => {
        const def = gdefs!.items.get(id)!;
        return { id, name: def.name, emoji: def.emoji, count: n, satiety: def.food!.satiety, affection: def.food!.affection, liked: likes.has(id) };
      })
      .sort((a, b) => Number(b.liked) - Number(a.liked) || b.satiety - a.satiety);
  }
  function renderMeal() {
    if (!meal || !gdefs || !view?.game) return;
    const g = view.game;
    const L = gdefs.file.leisure;
    const sn = meal.snack ? L?.snacks?.[meal.snack] : undefined;
    openPanel('meal', meal.title, buildMeal(doc, {
      kind: meal.kind,
      herName: ch.name,
      foods: mealFoods(),
      satiety: { now: g.satiety, max: gdefs.file.satiety.max },
      snack: sn ? { name: sn.name, emoji: sn.emoji, perDay: sn.perDay, left: g.stats.pantry?.snacks[meal.snack!] ?? sn.perDay, satiety: sn.satiety, affection: sn.affection } : undefined,
      fridge: meal.fridge,
      line: meal.line,
      eating: meal.eating,
      onEat: (id) => void mealEat(id),
      onSnack: () => void mealSnack(),
      onGo: (where) => mealGo(where),
      onClose: () => panel.close(),
    }));
  }
  async function mealEat(id: ItemId) {
    if (!meal || meal.eating) return;
    meal.eating = true;
    renderMeal();
    const res = await act({ type: 'feed', item: id });
    if (meal) meal.eating = false;
    if (!res) return renderMeal();
    if (!res.ok) {
      renderMeal();
      return sayError(res.error);
    }
    if (res.event.type !== 'fed') return;
    const it = itemLabel(gdefs!, id);
    foodPop = { emoji: it.emoji, start: performance.now() };
    if (meal) meal.line = undefined;
    onFed(res.event); // 吐司＋她說的話（坐著就繼續坐著）
    renderMeal();
  }
  async function mealSnack() {
    const sn = meal?.snack ? gdefs?.file.leisure?.snacks?.[meal.snack] : undefined;
    if (!meal || !sn || meal.eating) return;
    meal.eating = true;
    renderMeal();
    const res = await act({ type: 'snack', table: meal.snack! });
    if (meal) meal.eating = false;
    if (!res || !res.ok) {
      renderMeal();
      if (res && !res.ok) {
        if (res.error === 'sold_out') toasts.show(`${sn.emoji} 今天的${sn.name}被吃光了，明天再來！`);
        else sayError(res.error);
      }
      return;
    }
    const e = res.event;
    if (e.type !== 'snacked') return;
    foodPop = { emoji: sn.emoji, start: performance.now() };
    const got = [e.satiety > 0 && `🍙 +${Math.round(e.satiety)}`, e.stamina > 0 && `⚡ +${Math.round(e.stamina)}`, e.gain > 0 && `❤ +${e.gain}`].filter(Boolean).join('　');
    toasts.show(`${sn.emoji} ${sn.name}：${got || '吃了一份'}（今天還剩 ${e.left} 份）`);
    if (e.levelUp) toasts.show(`💖 ${ch.name}對你的感覺變成「${e.levelUp}」了`, 3600);
    if (meal) meal.line = pick(sn.lines);
    if (!away()) showEmote('heart');
    stage.dataset.snacked = String(e.left);
    renderMeal();
  }
  /** 打開冰箱：門打開的動畫 → host 決定今天找到什麼 → 放進揹包 */
  async function openFridge(title: string, onClose?: () => void) {
    const F = gdefs?.file.leisure?.fridge;
    openMeal('fridge', `🧊 ${title}`, undefined, onClose);
    meal!.fridge = { opening: true };
    renderMeal();
    if (!F) return;
    const [res] = await Promise.all([act({ type: 'fridge' }), wait(650)]);
    if (!meal || meal.kind !== 'fridge') return; // 開門時視窗被關掉了：東西已經放進揹包
    if (!res || !res.ok || res.event.type !== 'fridge_opened') {
      meal.fridge = { opening: false, fresh: true, find: null };
      if (res && !res.ok) sayError(res.error);
      renderMeal();
      meal.fridge.fresh = false;
      return;
    }
    const e = res.event;
    const it = e.item ? itemLabel(gdefs!, e.item) : null;
    const line = it ? fillLine(pick(F.lines.found), { item: `${it.emoji}${it.name}` }) : pick(F.lines.empty);
    meal.fridge = { opening: false, fresh: true, find: e.item && it ? { id: e.item, emoji: it.emoji, name: it.name, count: e.count } : null, line };
    stage.dataset.fridge = e.item ?? 'empty';
    if (!away()) showEmote(e.item ? 'exclaim' : 'dots');
    if (it) toasts.show(`🧊 冰箱裡找到 ${it.emoji} ${it.name}${e.count > 1 ? ` ×${e.count}` : ''}！`);
    renderMeal();
    meal.fridge.fresh = false; // 之後重畫（揹包數量變了）不要再播一次開門
  }
  /** 揹包空空的：帶她去冰箱或爐子（同一個場景才走過去，不然告訴主人在哪） */
  function mealGo(where: 'fridge' | 'stove') {
    panel.close();
    const target = map.interactables.find((x) => (where === 'fridge' ? x.hotspot?.action.type === 'fridge' : x.hotspot?.action.type === 'shop' && x.shop === 'kitchen'));
    if (target) return approach(target);
    toasts.show(where === 'fridge' ? '🧊 冰箱在廚房喔（走廊 →🍳 廚房）' : '🍳 爐子在廚房喔（走廊 →🍳 廚房）', 3600);
  }
  /** 吃東西時，食物從她頭上冒出來、慢慢往上飄 */
  function drawFoodPop(now: number, sx: number, sy: number, head: number) {
    if (!foodPop) return;
    const t = (now - foodPop.start) / FOOD_POP_MS;
    if (t >= 1) return void (foodPop = null);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const px = Math.round(11 * scale * (t < 0.15 ? 0.6 + (t / 0.15) * 0.4 : 1));
    ctx.font = `${px}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(foodPop.emoji, sx * scale, (sy - head - 2 - t * 8) * scale);
    ctx.restore();
  }

  // ───────────── V0.13：酒館（tavern.json） ─────────────
  // 熱區被點 → 她走到站位 → runHotspot → 打開小遊戲視窗。視窗裡的每一步都送給 host（act），畫面只記狀態。
  let flip: FlipState = { s: 'idle' };
  let cardSt: CardState = { s: 'pick' };

  function openCoinFlip() {
    const T = gdefs?.file.tavern;
    if (!T) return;
    flip = (view?.game?.coins ?? 0) < T.coinFlip.cost ? { s: 'broke', line: pick(T.coinFlip.lines.broke) } : { s: 'idle' };
    showPanel('arcade', renderCoinFlip);
  }
  function renderCoinFlip() {
    const T = gdefs!.file.tavern!;
    const g = view?.game;
    openPanel('arcade', '🕹️ 街機：猜硬幣', buildCoinFlip(doc, {
      state: flip,
      coins: g?.coins ?? 0,
      cost: T.coinFlip.cost,
      reward: T.coinFlip.reward,
      affectionLeft: g?.stats.tavern?.flipAffectionLeft ?? 0,
      herName: ch.name,
      onInsert: () => {
        flip = { s: 'choose' };
        renderCoinFlip();
      },
      onGuess: (side) => void doFlip(side),
      onAgain: () => {
        flip = { s: 'choose' };
        renderCoinFlip();
      },
      onQuit: () => panel.close(),
    }));
  }
  async function doFlip(guess: 'heads' | 'tails') {
    const T = gdefs!.file.tavern!;
    flip = { s: 'flipping', guess };
    renderCoinFlip();
    // 硬幣至少轉 1.2 秒（host 通常更快就回來了）
    const [res] = await Promise.all([act({ type: 'coin_flip', guess }), wait(1200)]);
    if (panel.kind !== 'arcade') return; // 轉的時候視窗被關掉了：結果已經算進存檔，不再跳出來
    if (!res || !res.ok) {
      flip = res && !res.ok && res.error === 'no_item' ? { s: 'broke', line: pick(T.coinFlip.lines.broke) } : { s: 'idle' };
      if (res && !res.ok && res.error !== 'no_item') sayError(res.error);
      return renderCoinFlip();
    }
    const e = res.event;
    if (e.type !== 'coin_flipped') return;
    flip = { s: 'result', guess: e.guess, result: e.result, win: e.win, coins: e.coins, gain: e.gain, line: pick(e.win ? T.coinFlip.lines.win : T.coinFlip.lines.lose) };
    renderCoinFlip();
    stage.dataset.coinFlip = `${e.result}|${e.win ? 1 : 0}`;
    if (!away()) showEmote(e.win ? 'heart' : 'dots');
    if (e.levelUp) toasts.show(`💖 ${ch.name}對你的感覺變成「${e.levelUp}」了`, 3600);
  }

  /** 現在在酒館、可以一起打牌的人 */
  function cardOpponents(): CardOpponent[] {
    const g = view?.game;
    const T = gdefs?.file.tavern;
    if (!g || !T) return [];
    return (g.stats.tavern?.npcs ?? []).map((id) => {
      const n = gdefs!.file.npcs?.[id];
      return { id, name: n?.name ?? id, emoji: n?.emoji ?? '🙂', hearts: g.npcs[id]?.hearts ?? 0, wins: g.stats.tavern?.cardWins[id] ?? 0 };
    });
  }
  function openCards(npc?: string) {
    const ops = cardOpponents();
    if (!ops.length) return void toasts.show('酒館裡沒有人可以一起打牌');
    const one = npc && ops.some((o) => o.id === npc) ? npc : ops.length === 1 ? ops[0]!.id : null;
    cardSt = one ? { s: 'ready', npc: one } : { s: 'pick' };
    showPanel('cards', renderCards);
  }
  function renderCards() {
    const T = gdefs!.file.tavern!;
    openPanel('cards', '🃏 牌桌：比大小', buildCards(doc, {
      state: cardSt,
      opponents: cardOpponents(),
      maxWins: T.cards.maxWinsPerDay,
      friendship: T.cards.friendship,
      herName: ch.name,
      onPick: (id) => {
        cardSt = { s: 'ready', npc: id };
        renderCards();
      },
      onDeal: () => void dealCards(),
      onSwitch: () => {
        cardSt = { s: 'pick' };
        renderCards();
      },
      onQuit: () => panel.close(),
    }));
  }
  async function dealCards() {
    if (cardSt.s === 'pick' || cardSt.s === 'dealing') return;
    const T = gdefs!.file.tavern!;
    const npc = cardSt.npc;
    cardSt = { s: 'dealing', npc };
    renderCards();
    const [res] = await Promise.all([act({ type: 'cards', npc }), wait(900)]);
    if (panel.kind !== 'cards') return;
    if (!res || !res.ok) {
      cardSt = { s: 'pick' };
      if (res && !res.ok) toasts.show(res.error === 'not_here' ? '對方已經回家了' : '出了點問題');
      return renderCards();
    }
    const e = res.event;
    if (e.type !== 'cards_played') return;
    cardSt = { s: 'result', npc, mine: e.mine, theirs: e.theirs, outcome: e.outcome, gain: e.gain, line: pick(T.cards.lines[e.outcome]) };
    renderCards();
    stage.dataset.cards = `${npc}|${e.outcome}|${e.gain}`;
    hops.set(npc, performance.now() + 420);
  }

  /** 酒館裡 NPC 頭上的小對話（tavern.json 的 seats[].bubble） */
  const npcBubbles = new Map<string, { text: string; until: number }>();
  let nextNpcBubbleAt = 0;
  function updateTavern(now: number) {
    const T = gdefs?.file.tavern;
    const tv = view?.game?.stats.tavern;
    if (!T || !tv || sceneId !== T.scene) return;
    if (now > nextNpcBubbleAt) {
      nextNpcBubbleAt = now + 7000 + rng() * 8000;
      const seats = [...T.residents, ...T.social.seats].filter((x) => x.bubble?.length && tv.npcs.includes(x.npc));
      const seat = seats[Math.floor(rng() * seats.length)];
      if (seat) npcBubbles.set(seat.npc, { text: pick(seat.bubble!), until: now + 3800 });
    }
    checkSocialTalk();
  }
  function drawNpcBubble(npc: string, x: number, y: number, now: number) {
    const b = npcBubbles.get(npc);
    if (!b || now > b.until) return;
    ctx.save();
    ctx.font = `7px ${UI_FONT}`;
    const w = Math.ceil(ctx.measureText(b.text).width) + 8;
    const bx = Math.round(Math.min(VW - w - 2, Math.max(2, x - w / 2)));
    const by = Math.round(y - 13);
    ctx.fillStyle = 'rgba(255,250,240,0.95)';
    ctx.strokeStyle = '#3b2433';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + 0.5, by + 0.5, w, 11, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3b2433';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.text, bx + 4, by + 6.5);
    ctx.restore();
  }

  /**
   * 社交時間：她（或主人自己走時的主人）走到 NPC 旁邊 talkRadius 格內 → 自動聊一段（她說一句、對方回一句）。
   * 每個 NPC 每晚一次（記在這個分頁裡；重新整理後同一晚可能再聊一次，無妨）。
   */
  const socialTalked = new Set<string>();
  function checkSocialTalk() {
    const T = gdefs?.file.tavern;
    const tv = view?.game?.stats.tavern;
    if (!T || !tv?.social || !view || busy || dialog.open || panel.isOpen || away() || fishing || thinking) return;
    if (!player.on && pet.goal) return; // 她正要去做事（點餐、玩街機）：路過不打斷，做完、停下來再聊
    const me = player.on ? player.tile : pet.tile;
    for (const it of map.interactables) {
      if (it.kind !== 'npc' || !it.npc) continue;
      const talks = T.social.talks[it.npc];
      const def = gdefs!.file.npcs?.[it.npc];
      if (!talks?.length || !def) continue;
      const key = `${dayKey(view.now)}:${it.npc}`;
      if (socialTalked.has(key)) continue;
      if (Math.abs(me.x - it.rect.x) + Math.abs(me.y - it.rect.y) > T.social.talkRadius) continue;
      socialTalked.add(key);
      const t = pick(talks);
      if (!player.on) Object.assign(pet, { path: [], goal: null, walking: false });
      stop(faceToward(pet.tile, it.rect));
      pet.idleUntil = Infinity;
      stage.dataset.socialTalk = it.npc;
      dialog.show(t.her, () => sayAs(def, [t.reply]), (oy + pet.py) / VH > 0.55);
      return;
    }
  }

  // ───────────── V0.14：家具目錄（furniture_shop.json） ─────────────
  // 側邊欄 🪑（F）或小葵的選單打開。買 → buy_furniture（host 扣錢、放進揹包、記錄買過的）；
  // 擺放 → 跟揹包點家具一樣進裝修模式；二手賣 → sell_furniture（只能賣揹包裡的，擺出去的要先收回）。
  let catalogTab: CatalogTab = 'all';
  let justBought: ItemId | null = null;
  function toggleCatalog() {
    if (panel.kind === 'catalog') return panel.close();
    openCatalog();
  }
  function openCatalog() {
    if (!gdefs?.file.furniture) return;
    justBought = null;
    showPanel('catalog', renderCatalog);
  }
  function renderCatalog() {
    const F = gdefs?.file.furniture;
    const g = view?.game;
    if (!F || !g) return;
    openPanel('catalog', `${F.emoji} ${F.name}`, buildFurnitureCatalog(doc, {
      file: F,
      game: g,
      tab: catalogTab,
      justBought,
      onTab: (t) => {
        catalogTab = t;
        renderCatalog();
      },
      onBuy: (id) => void buyFurniture(id),
      onSell: (id) => void sellFurniture(id),
      onPlace: (id) => placeFromCatalog(id),
    }));
  }
  async function buyFurniture(id: ItemId) {
    const res = await act({ type: 'buy_furniture', item: id });
    if (!res) return;
    if (!res.ok) return void toasts.show(res.error === 'no_item' ? '🪙 金幣不足' : ERROR_TEXT[res.error] ?? '買不了');
    if (res.event.type !== 'furniture_bought') return;
    justBought = id;
    const it = itemLabel(gdefs!, id);
    toasts.show(`🎉 買了 ${it.emoji} ${it.name}！放進揹包的「家具」分頁了（🪙 -${res.event.cost}）`, 3200);
    stage.dataset.bought = id;
    if (panel.kind === 'catalog') renderCatalog();
  }
  async function sellFurniture(id: ItemId) {
    const res = await act({ type: 'sell_furniture', item: id });
    if (!res) return;
    if (!res.ok) return void toasts.show(res.error === 'no_item' ? '揹包裡沒有這件（擺出去的要先在裝修模式收回）' : '賣不了');
    if (res.event.type !== 'furniture_sold') return;
    const it = itemLabel(gdefs!, id);
    toasts.show(`💰 二手賣出 ${it.emoji} ${it.name}：🪙 +${res.event.coins}`);
    if (panel.kind === 'catalog') renderCatalog();
  }
  function placeFromCatalog(id: ItemId) {
    const it = itemLabel(gdefs!, id);
    if (it.def?.decor) return void decorate(id);
    if (!it.def?.place) return;
    holding = id;
    setDecorMode(true);
    panel.close();
    const fp = footprint(id, 0, 0, gdefs!);
    toasts.show(`${it.emoji} 拿著${it.name}${fp.w > 1 || fp.h > 1 ? `（${fp.w}×${fp.h} 格）` : ''}：點地圖上的空格擺放（點的是左上角）`, 3600);
  }

  // ───────────── V0.14：背景音樂（music.json） ─────────────
  const music = pack.music ? new MusicPlayer(doc, pack.music, (src) => pack.musicUrls(src)) : null;
  if (music) {
    music.onChange = (st) => {
      const b = shell.querySelector<HTMLButtonElement>('.px-music-btn');
      if (b) {
        b.textContent = st.on ? '🔊' : '🔇';
        b.title = st.on ? `背景音樂（N）：${st.name ? `正在播「${st.name}」` : '點一下畫面就會開始播'}。按一下關掉` : '背景音樂（N）：關著。按一下打開';
        b.classList.toggle('on', st.on);
      }
      stage.dataset.music = st.on ? st.track ?? '' : 'off';
    };
    music.onChange({ on: music.prefs.on, track: null, name: null });
  }
  /** 照現在的場景、戶外、天氣、時段選歌（酒館、礦洞、下雨、夜晚、白天） */
  function updateMusic() {
    if (!music || !sceneId) return;
    music.set(pickTrack(pack.music, { scene: sceneId, outdoor: outdoor.has(sceneId), weather: view?.game?.weather?.id, phase: view?.phase }));
  }
  function toggleMusic() {
    if (!music) return;
    const on = music.toggle();
    toasts.show(on ? '🔊 背景音樂打開了' : '🔇 背景音樂關掉了', 1800);
  }

  /** 社交時間開始、結束的那一刻重新拿一次畫面資料（NPC 搬家） */
  let socialTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSocial() {
    clearTimeout(socialTimer);
    const T = gdefs?.file.tavern;
    if (!T || !view) return;
    const d = new Date(view.now);
    const nextAt = (h: number) => {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h % 24, 0, 1).getTime() + (h >= 24 ? 86_400_000 : 0);
      return t > view!.now ? t : t + 86_400_000;
    };
    const next = Math.min(nextAt(T.social.fromHour), nextAt(T.social.toHour));
    socialTimer = setTimeout(() => void refresh().catch(warn('social')), Math.min(next - view.now + 500, 6 * 3_600_000));
  }

  // ───────────── V0.11：泡澡、玩遊戲（遊戲室）、掛機 ─────────────
  const fillLine = (t: string, vars: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  /** 台詞裡的 {time}、{weather}、{season} */
  function worldVars(): Record<string, string> {
    const g = view?.game;
    const d = new Date(view?.now ?? Date.now());
    return {
      time: `${d.getHours()} 點 ${String(d.getMinutes()).padStart(2, '0')} 分`,
      weather: g?.weather?.name ?? '晴天',
      season: g?.season ? `${g.season.name}天第 ${g.season.day} 天` : '',
    };
  }
  const playingNow = () => !!view?.game?.stats.play;

  async function takeBath(it: Interactable) {
    const L = gdefs?.file.leisure;
    const g = view?.game;
    if (!L || !g) return;
    if ((g.stats.bathReadyAt ?? 0) > (view?.now ?? 0)) {
      if (!away()) speak([pick(L.lines.bathCooldown)], true);
      return;
    }
    busy = true;
    fade.classList.add('on');
    await wait(FADE_MS);
    const res = await act({ type: 'bath' });
    await wait(600);
    fade.classList.remove('on');
    busy = false;
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type !== 'bathed') return;
    const ev = res.event;
    if (!away()) stop(faceToward(pet.tile, it.rect));
    toasts.show(`♨️ 泡好澡了：⚡ +${Math.round(ev.stamina)}${ev.gain ? `　❤ +${ev.gain}` : ''}`, 4200);
    if (ev.levelUp && say('levelup', { vars: { level: ev.levelUp } }).shown) return;
    if (away()) return;
    // V0.15：下水游一圈（點她就上岸）；沒有游泳圖就照舊說一句話
    if (startSwim((L.bath.swimSeconds ?? 15) * 1000)) speak([pick(L.lines.bathIn)], true);
    else {
      showEmote('heart');
      showLine(pick(L.lines.bathIn), 'happy');
    }
  }

  // ───────────── V0.15：浴池游泳（character.json 的 swim 動作） ─────────────
  let swim: { x0: number; x1: number; y: number; until: number; back: TilePos; nextLine: number } | null = null;
  /** 在浴池裡左右游來游去 ms 毫秒；浴池是浴室熱區裡動作是 bath 的那一個（水面在範圍中間偏上） */
  function startSwim(ms: number): boolean {
    const bg = map.background?.scene;
    const tub = bg?.hotspots.find((h) => h.action.type === 'bath');
    if (!bg || !tub || away() || !ch.actions?.clips.swim?.sheet) return false;
    const c = imgToMap(bg, TS);
    const r = tub.rect;
    const a = c.point({ x: r.x + r.w * 0.2, y: r.y + r.h * 0.47 });
    const b = c.point({ x: r.x + r.w * 0.8, y: r.y + r.h * 0.47 });
    const now = performance.now();
    swim = { x0: a.x, x1: b.x, y: a.y, until: now + ms, back: { ...pet.tile }, nextLine: now + 4000 };
    Object.assign(pet, { path: [], goal: null, walking: false, seat: null, px: (a.x + b.x) / 2, py: a.y, face: 'right' as Facing });
    pet.idleUntil = Infinity;
    playClip('swim');
    stage.dataset.swim = '1';
    return true;
  }
  function updateSwim(now: number, dt: number) {
    if (!swim) return;
    if (now > swim.until) return endSwim();
    const v = 16 * actorScale; // 每秒游幾個地圖像素
    pet.px += (pet.face === 'left' ? -1 : 1) * v * dt;
    if (pet.px >= swim.x1) {
      pet.px = swim.x1;
      pet.face = 'left';
    } else if (pet.px <= swim.x0) {
      pet.px = swim.x0;
      pet.face = 'right';
    }
    pet.py = swim.y + Math.sin(now / 380) * 0.8; // 隨著水浮上浮下
    if (pet.clip?.name !== 'swim') playClip('swim');
    const lines = gdefs?.file.leisure?.lines.swim;
    if (now > swim.nextLine && lines?.length && bubble.hidden) {
      swim.nextLine = now + rand(6000, 11000);
      speak([pick(lines)]);
    }
  }
  /** 上岸：回到下水前站的那一格 */
  function endSwim(byClick = false) {
    if (!swim) return;
    const back = swim.back;
    swim = null;
    delete stage.dataset.swim;
    pet.clip = null;
    placeAt(back, 'down');
    if (byClick) showEmote('heart');
    idle(byClick ? 1500 : undefined);
  }

  let playBubbleAt = 0;
  async function startPlay(game: string, it?: Interactable) {
    const L = gdefs?.file.leisure;
    if (!L?.play.games[game]) return;
    const res = await act({ type: 'play', game });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    sitForPlay(it);
    const name = L.play.games[game]!.name;
    toasts.show(`${L.play.games[game]!.emoji} 她開始玩${name}了（點她就會停下來）`, 4200);
    speak([fillLine(pick(L.lines.playStart), { game: name })], true);
    playBubbleAt = performance.now() + 20_000;
  }
  /** 坐到遊戲機前（換場景、重新整理之後也會呼叫） */
  function sitForPlay(it?: Interactable) {
    const g = view?.game?.stats.play;
    if (!g || away()) return;
    const target = it ?? map.interactables.find((x) => x.hotspot?.action.type === 'play' && (x.hotspot.action as { game: string }).game === g.game);
    if (!target) return void stopPlay(true); // 不在遊戲室（不同步了）：直接結算
    if (target?.stands[0] && (pet.tile.x !== target.stands[0].x || pet.tile.y !== target.stands[0].y)) placeAt(target.stands[0], 'up');
    Object.assign(pet, { path: [], goal: null, walking: false });
    const pose = target?.hotspot?.pose;
    if (pose && playClip(pose)) {
      seatedPose = pose;
      sitAt(target.petSeat, pose); // V0.16
    }
    pet.idleUntil = Infinity;
    stage.dataset.playing = g.game;
  }
  /** 叫她停下來：結算玩了多久、好感、體力。quiet：不說話（例如要睡覺了） */
  async function stopPlay(quiet = false) {
    const L = gdefs?.file.leisure;
    if (!L || !playingNow()) return;
    const res = await act({ type: 'stop_play' });
    seatedPose = null;
    pet.seat = null;
    delete stage.dataset.playing;
    idle(800);
    if (!res?.ok || res.event.type !== 'play_stopped') return;
    const ev = res.event;
    const name = L.play.games[ev.game]?.name ?? '';
    const parts = [ev.gain ? `❤ +${ev.gain}` : '', ev.stamina ? `⚡ +${Math.round(ev.stamina)}` : ''].filter(Boolean).join('　');
    toasts.show(`${L.play.games[ev.game]?.emoji ?? '🎮'} 玩了 ${ev.minutes} 分鐘${parts ? `：${parts}` : ''}`, 5000);
    if (quiet || away()) return;
    if (ev.levelUp && say('levelup', { vars: { level: ev.levelUp } }).shown) return;
    const lines = ev.minutes < 1 ? L.lines.playQuit : L.lines.playEnd;
    showLine(fillLine(pick(lines), { minutes: ev.minutes, level: ev.level, game: name, gain: ev.gain, stamina: Math.round(ev.stamina) }), 'happy');
  }
  /** 玩的時候：偶爾冒一句、頭上冒音符 */
  function updatePlay(now: number) {
    const L = gdefs?.file.leisure;
    if (!L || !playingNow() || away() || busy || dialog.open) return;
    if (now < playBubbleAt) return;
    playBubbleAt = now + 25_000 + rng() * 20_000;
    if (rng() < 0.6) speak([pick(L.lines.playing)]);
    else showEmote(rng() < 0.5 ? 'note' : 'heart');
  }

  // 掛機：主人一段時間沒動作，她自己跑去遊戲室玩
  let lastInputAt = performance.now();
  const markInput = () => {
    lastInputAt = performance.now();
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel'] as const) doc.addEventListener(ev, markInput, { passive: true, capture: true });
  let lastMoveMark = 0;
  doc.addEventListener('pointermove', () => {
    const t = performance.now();
    if (t - lastMoveMark > 1000) {
      lastMoveMark = t;
      lastInputAt = t;
    }
  }, { passive: true, capture: true });
  function checkAfk(now: number) {
    const L = gdefs?.file.leisure;
    const mins = L?.play.afkMinutes ?? 0;
    if (!L || !mins || now - lastInputAt < mins * 60_000) return;
    if (playingNow() || swim || busy || away() || player.on || fishing || travel || dialog.open || panel.isShown || decorMode || !pack.maps.gameroom) return;
    lastInputAt = now; // 不要一直觸發
    const tvOf = (m: MapModel) => m.interactables.find((x) => x.hotspot?.action.type === 'play');
    speak([pick(L.lines.afkGo)], true);
    const go = () => {
      const tv = tvOf(map);
      if (tv) approach(tv);
    };
    if (sceneId === 'gameroom') return go();
    if (routeTo('gameroom')) travelTo('gameroom', go);
    else void goto('gameroom').then(() => go());
  }

  /** 背景圖場景：滑鼠（地圖像素）點到哪個熱區 → 對應的互動物件或門 */
  function hotspotHit(lx: number, ly: number): { it?: Interactable; door?: DoorDef; doors?: DoorDef[]; rect: PxRect; locked: boolean } | null {
    const bg = map.background;
    if (!bg) return null;
    const c = imgToMap(bg.scene, TS);
    const h = hotspotAt(bg.scene, { x: lx / c.sx, y: ly / c.sy });
    if (!h) return null;
    const rect = c.rect(h.rect);
    const locked = isLocked(h.unlock);
    if (h.action.type === 'door') {
      // V0.11：一個門口可以通往好幾個地方（id 是 hall、hall#kitchen…）
      const doors = map.doors.filter((d) => d.id === h.id || d.id.startsWith(`${h.id}#`));
      return doors[0] ? { door: doors[0], doors, rect, locked } : null;
    }
    const it = map.interactables.find((x) => x.id === h.id);
    return it ? { it, rect, locked } : null;
  }

  /** 走廊：問要去哪裡 */
  function chooseDoor(doors: DoorDef[]) {
    const name = (id: string) => world.scenes.find((x) => x.id === id)?.name ?? id;
    dialog.choose('要去哪裡呢？', [
      ...doors.map((d) => ({
        label: isLocked(d.unlock) ? `🔒 ${d.label ?? name(d.to)}` : d.label ?? name(d.to),
        onClick: () => clickDoor(d),
      })),
      { label: '👋 不去了', onClick: () => undefined },
    ]);
  }

  function clickDoor(door: DoorDef) {
    if (isLocked(door.unlock)) return openUnlock(door.unlock!);
    if (away()) return void goto(door.to, door.spawn); // 她不在：主人自己過去
    if (door.stand) {
      marker = { tile: door.stand, until: performance.now() + 700 };
      walkTo(door.stand, { kind: 'door', door });
    }
  }

  /** 所有玩法動作都走這裡：送給 host、拿回最新狀態 */
  async function act(a: GameAction): Promise<ActResult | null> {
    try {
      const r = await bridge.act(a);
      setView({ ...r.view, awayMinutes: 0 });
      return r;
    } catch (err) {
      warn('act')(err);
      toasts.show('出了點問題，稍後再試一次');
      return null;
    }
  }

  function sayError(err: ActError) {
    if (err === 'no_stamina') {
      // V0.7：她拒絕，並說怎麼恢復
      const lines = gdefs?.file.stats?.lines.exhausted;
      if (lines?.length && !away()) {
        speak([pick(lines)], true);
        showEmote('dots');
      } else if (!say('tired').shown) toasts.show('體力不夠了，休息一下吧');
      toasts.show('⚡ 體力不夠：吃東西，或回房間睡覺');
    } else if (err === 'full') {
      if (!say('full').shown) toasts.show('她吃不下了');
    } else if (err === 'cooldown') showEmote('dots');
    else if (err === 'visitor') toasts.show(t('err.visitor'));
    else toasts.show(ERROR_TEXT[err] ?? '現在不能這樣做');
  }
  /** V0.22：社交動作的錯誤（語言包的文字） */
  function socialError(err: ActError) {
    toasts.show(t(SOCIAL_ERRORS[err] ?? 'err.generic'), 4200);
  }

  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)]!;

  /** V0.7：點水邊。她不渴就直接釣魚；渴了（飽食／水分不到八成）而且這裡的水能喝，先問要釣魚還是喝水 */
  async function onWater(zone: Interactable) {
    const g = view?.game;
    const table = zone.table ?? 'pond';
    const canDrink = !!g && g.stats.drinkTables.includes(table) && g.satiety < g.satietyMax * 0.8;
    if (!canDrink || !g) return startFishing(zone);
    stop(faceToward(pet.tile, zone.rect));
    pet.idleUntil = Infinity;
    const dk = gdefs!.file.stats!.satiety.drink;
    const wait = Math.max(0, Math.ceil((g.stats.drinkReadyAt - view!.now) / 60_000));
    const cost = g.stats.costs.fish;
    dialog.choose(g.stats.low.satiety ? pick(gdefs!.file.stats!.lines.hungry) : '要在這裡做什麼呢？', [
      { label: g.stamina < cost ? `🎣 釣魚（體力不夠）` : `🎣 釣魚（⚡ -${cost}）`, disabled: g.stamina < cost, onClick: () => void startFishing(zone) },
      { label: wait > 0 ? `💧 喝水（再等 ${wait} 分鐘）` : `💧 喝水（🍙 +${dk.satiety}）`, disabled: wait > 0, onClick: () => void drink(zone, table) },
      { label: '👋 離開', onClick: () => undefined },
    ], undefined, () => {
      if (!fishing && !away()) idle(600);
    });
  }
  async function drink(zone: Interactable, table: string) {
    stop(faceToward(pet.tile, zone.rect));
    showEmote('note');
    const res = await act({ type: 'drink', table });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'drank') {
      toasts.show(`💧 喝了水：🍙 +${Math.round(res.event.satiety)}`);
      speak([pick(gdefs!.file.stats!.lines.drink)], true);
    }
    idle(900);
  }

  // 釣魚：面向池塘、冒「…」等一下（點一下可以跳過），結果在一開始就由 host 決定並存檔
  async function startFishing(zone: Interactable) {
    const f = gdefs!.file.fishing;
    if (!view?.game) return;
    if (view.game.stamina < f.staminaCost) return sayError('no_stamina');
    stop(faceToward(pet.tile, zone.rect));
    pet.idleUntil = Infinity;
    let skip!: () => void;
    const skipped = new Promise<void>((r) => (skip = r));
    fishing = { skip };
    stage.dataset.fishing = '1'; // 給測試看
    showEmote('dots');
    const dots = setInterval(() => showEmote('dots'), EMOTE_MS - 100);
    await Promise.race([wait(view.game.fishing?.waitMs ?? f.durationMs), skipped]); // 魚竿、魚餌會改變等待時間
    clearInterval(dots);
    // 小遊戲（可以在揹包裡關掉）：決定這次的品質；釣到什麼仍由 host 決定
    const quality = f.minigame && minigameEnabled() ? await playMinigame(stage, f.minigame, rng) : undefined;
    const res = await act({ type: 'fish', table: zone.table ?? 'pond', quality });
    fishing = null;
    delete stage.dataset.fishing;
    emote = null;
    idle(1500);
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'escaped') {
      toasts.show(`魚跑掉了……${res.event.bait ? `（用掉一個${itemLabel(gdefs!, res.event.bait).name}）` : ''}`);
      showEmote('dots');
      return;
    }
    if (res.event.type !== 'caught') return;
    const it = itemLabel(gdefs!, res.event.item);
    const junk = it.def?.category === 'junk';
    const rr = res.event.rarity !== 'common' ? gdefs!.file.fishing.rarities?.[res.event.rarity] : undefined;
    const rareTag = rr ? `${res.event.rarity === 'legendary' ? '🌟' : '✨'}【${rr.name}】` : '';
    toasts.show(`${rareTag}釣到了 ${it.emoji} ${it.name}${res.event.count > 1 ? ` ×${res.event.count}（完美！）` : ''}${junk ? '…' : '！'}`, rr ? 3600 : undefined);
    if (res.event.bait && !res.view.game?.inventory[res.event.bait]) toasts.show(`${itemLabel(gdefs!, res.event.bait).emoji} 魚餌用完了`);
    for (const r of res.event.rewards) {
      toasts.show(`🎁 收集完成「${r.name}」：${Object.entries(r.reward).map(([id, n]) => `${itemLabel(gdefs!, id).emoji}×${n}`).join(' ')}`, 4200);
    }
    const isNew = res.event.first && it.def?.category === 'fish';
    if (isNew) toasts.show(`📖 圖鑑新增：${it.name}！`, 3200);
    showEmote(junk ? 'dots' : 'exclaim');
    if (res.event.goddess) {
      await showGoddess(res.event.goddess.until);
      toasts.show('🍀 好運到明天早上！', 3600);
      void aiSay('goddess', undefined, () => {}, 'bubble'); // 沒有 AI 就不多說（女神畫面已經講過了）
      return;
    }
    const ev = res.event;
    const caughtLine = () => say('caught', { item: ev.item, category: it.def?.category, tags: [...(isNew ? ['new'] : []), ...(rr ? [ev.rarity] : [])] });
    // V0.8：釣到傳說魚是大事件，讓 AI 說；其他魚用 JSON 台詞（省錢、也不用每次等）
    if (res.event.rarity === 'legendary') void aiSay('legendary', { item: res.event.item }, () => void caughtLine());
    else caughtLine();
  }

  // 農田：空地 → 播種；成熟 → 收成；還在長 → 告訴你還要多久
  async function onPlot(plot: Interactable) {
    const g = view?.game;
    if (!g || !gdefs) return;
    const key = plotKey(plot);
    const st = g.plots[key];
    stop(faceToward(pet.tile, plot.rect));
    const sprinklerItem = gdefs.file.farming?.sprinklerItem;
    if (holdingSprinkler && sprinklerItem && g.inventory[sprinklerItem] && !g.sprinklers.includes(key)) {
      const res = await act({ type: 'sprinkler', plot: key });
      if (!res) return;
      if (!res.ok) return sayError(res.error);
      holdingSprinkler = (res.view.game?.inventory[sprinklerItem] ?? 0) > 0;
      toasts.show('⛲ 裝好灑水器了：這格以後不用澆水');
      showEmote('note');
      idle(1200);
      return;
    }
    if (!st) {
      const seeds = Object.keys(g.inventory).filter((id) => gdefs.items.get(id)?.category === 'seed');
      const inSeason = (id: ItemId) => {
        const c = gdefs.cropBySeed.get(id);
        return !c?.seasons || !g.season || c.seasons.includes(g.season.id);
      };
      const seed = selectedSeed && g.inventory[selectedSeed] && inSeason(selectedSeed) ? selectedSeed : seeds.find(inSeason);
      if (!seed && seeds.length) {
        toasts.show(`現在是${g.season?.name ?? ''}天，手上的種子都不是這一季的（看揹包裡種子的說明）`, 3600);
        showEmote('dots');
        return;
      }
      if (!seed) {
        if (!say('no_seed').shown) toasts.show('沒有種子了，去跟旅行商人換吧！');
        return;
      }
      const res = await act({ type: 'plant', plot: key, seed });
      if (!res) return;
      if (!res.ok) return sayError(res.error);
      const it = itemLabel(gdefs, seed);
      toasts.show(`種下了 ${it.emoji} ${it.name}${res.view.game?.plots[key]?.watered ? '' : '，記得澆水 💧'}`);
      showEmote('note');
      idle(1200);
      return;
    }
    if (!st.ready && !st.watered) {
      const res = await act({ type: 'water', plot: key });
      if (!res) return;
      if (!res.ok) return sayError(res.error);
      toasts.show(`💧 澆水了（可以濕 ${gdefs.file.farming?.waterHours ?? 0} 小時）`);
      showEmote('note');
      idle(1000);
      return;
    }
    if (st.ready) {
      const res = await act({ type: 'harvest', plot: key });
      if (!res) return;
      if (!res.ok) return sayError(res.error);
      if (res.event.type === 'harvested') {
        const it = itemLabel(gdefs, res.event.item);
        toasts.show(`收成了 ${it.emoji} ${it.name} ×${res.event.count}！`);
        if (!say('harvest', { item: res.event.item, category: it.def?.category }).played) playClip('happy');
      } else toasts.show('清掉了認不得的作物');
      return;
    }
    toasts.show(`${st.emoji} ${cropName(st.crop)}：${st.stageName}，${eta(st)}`);
  }

  const eta = (st: { nextAt: number | null }) =>
    st.nextAt === null ? '沒有水，長不大' : `還要 ${formatDuration(st.nextAt - view!.now)}`;

  const cropName = (crop: string) => {
    const c = gdefs?.crops.get(crop);
    return c ? itemLabel(gdefs!, c.harvest.item).name : '作物';
  };

  // 商人：打開交換清單；她會在攤位前等你
  function openShop(it: Interactable) {
    if (!away()) {
      stop(faceToward(pet.tile, it.rect));
      pet.idleUntil = Infinity;
    }
    openShopById(it.shop);
  }

  function openShopById(id: string | undefined) {
    const shop = id ? gdefs?.file.shops[id] : undefined;
    if (!shop) return void toasts.show('商人不在');
    if (shop.mode === 'sell') return openSell(id);
    if (id === gdefs?.file.pets?.shop) return openPetShop(id!);
    openShopId = id!;
    showPanel('shop', renderShop, () => (openShopId = null));
  }

  /** 打開面板：記住畫法（狀態變了會重畫），關掉時她繼續走動 */
  function showPanel(kind: string, render: () => void, onClose?: () => void) {
    tip.classList.remove('show');
    if (MODAL_KINDS.has(kind)) {
      modalRender = render;
      render();
      modalClose = onClose ?? null;
      return;
    }
    panelRender = render;
    render();
    panelClose = onClose ?? null;
  }
  let panelClose: (() => void) | null = null;
  let modalRender: (() => void) | null = null;
  let modalClose: (() => void) | null = null;
  function openPanel(kind: string, title: string, content: HTMLElement) {
    if (MODAL_KINDS.has(kind)) {
      const money = kind === 'shop' || kind === 'sell' || kind === 'unlock' || kind === 'animals' || kind === 'catch';
      modal.setInfo(money && view?.game ? `🪙 ${view.game.coins}` : '');
      modal.open(kind, title, content, () => {
        modalRender = null;
        const cb = modalClose;
        modalClose = null;
        cb?.();
        if (!away()) idle(800);
      });
      return;
    }
    sidePanel.open(kind, title, content, () => {
      panelRender = null;
      const cb = panelClose;
      panelClose = null;
      cb?.();
      if (!away()) idle(800);
    });
  }

  function renderShop() {
    const shop = openShopId ? gdefs?.file.shops[openShopId] : undefined;
    if (!shop || !gdefs) return;
    openPanel('shop', `${shop.emoji} ${shop.name}`, buildShop(doc, {
      shop, defs: gdefs, inventory: view?.game?.inventory ?? {}, season: view?.game?.season?.id, festival: view?.game?.festival?.id,
      shopId: openShopId!, bought: view?.game?.shopToday,
      onTrade: (t) => void trade(t),
    }));
  }

  async function trade(t: TradeDef) {
    if (!openShopId) return;
    const res = await act({ type: 'trade', shop: openShopId, trade: t.id });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'traded') {
      const got = Object.entries(res.event.get).map(([id, n]) => {
        const it = itemLabel(gdefs!, id);
        return `${it.emoji} ${it.name} ×${n}`;
      }).join('、');
      const verb = gdefs!.file.shops[openShopId]?.verb;
      toasts.show(`${verb === '點' ? '上菜囉！' : verb ? '做好了' : '換到了'} ${got}`); // V0.13：酒館點餐
      const firstSeed = Object.keys(res.event.get).find((id) => gdefs!.items.get(id)?.category === 'seed');
      if (firstSeed) selectedSeed = firstSeed;
    }
  }

  // 揹包：點魚或作物 → 餵她；點種子 → 選擇播種用的種子
  function toggleBag() {
    if (panel.kind === 'bag') panel.close();
    else showPanel('bag', renderBag);
  }

  function bagFooter(): HTMLElement {
    const g = view!.game!;
    const box = uiEl(doc, 'div', 'px-row-btns');
    const fi = g.fishing;
    if (fi) {
      const rod = fi.rod ? itemLabel(gdefs!, fi.rod) : null;
      const bait = fi.bait ? itemLabel(gdefs!, fi.bait) : null;
      box.append(uiEl(doc, 'span', 'px-gear-now',
        `🎣 ${rod ? rod.name : '徒手'}｜${bait ? `${bait.emoji} ${bait.name} ×${fi.baitLeft}` : '沒用魚餌'}｜等魚 ${(fi.waitMs / 1000).toFixed(1)} 秒`));
    }
    const on = minigameEnabled();
    box.append(button(doc, `🎣 釣魚小遊戲：${on ? '開' : '關'}`, () => {
      setMinigameEnabled(!on);
      renderBag();
    }));
    const m = gdefs!.file.marriage;
    if (m && g.canPropose) {
      const it = itemLabel(gdefs!, m.item);
      box.append(button(doc, `💍 送她 ${it.emoji} ${it.name}（告白）`, () => void propose(), { disabled: !g.inventory[m.item] }));
    }
    return box;
  }

  function renderBag() {
    if (!gdefs || !view?.game) return;
    openPanel('bag', '🎒 揹包', buildBag(doc, {
      footer: bagFooter(),
      game: view.game,
      defs: gdefs,
      tab: bagTab,
      selectedSeed,
      heldTool: holdingSprinkler ? gdefs.file.farming?.sprinklerItem : undefined,
      gear: { rod: view.game.fishing?.rod ?? null, bait: view.game.fishing?.bait ?? null },
      onTab: (t) => {
        bagTab = t;
        renderBag();
      },
      selectedFood,
      onEat: (id) => void eat(id),
      onSlot: (id) => void onBagSlot(id),
    }));
  }

  async function onBagSlot(id: ItemId) {
    const it = itemLabel(gdefs!, id);
    if (it.def?.category === 'seed') {
      selectedSeed = id;
      renderBag();
      toasts.show(`播種時會用 ${it.emoji} ${it.name}`);
      return;
    }
    // 魚竿、魚餌：點一下換上（魚餌再點一次卸下）
    const gear = it.def?.gear;
    if (gear) {
      const cur = gear.kind === 'rod' ? view?.game?.fishing?.rod : view?.game?.fishing?.bait;
      const next = gear.kind === 'bait' && cur === id ? null : id;
      const res = await act({ type: 'set_gear', slot: gear.kind, item: next });
      if (res && !res.ok) return sayError(res.error);
      toasts.show(next ? `${it.emoji} 換上了${it.name}` : `${it.emoji} 卸下了${it.name}`);
      return;
    }
    if (id === gdefs!.file.farming?.sprinklerItem) {
      holdingSprinkler = !holdingSprinkler;
      if (holdingSprinkler) {
        panel.close();
        toasts.show(`${it.emoji} 拿著灑水器：點一塊田來安裝`, 3200);
      } else renderBag();
      return;
    }
    if (it.def?.place) return void placeFromCatalog(id); // V0.14：跟家具目錄的「擺放」一樣
    if (it.def?.decor) return void decorate(id);
    if (!it.def?.food) return void toasts.show(`${it.emoji} ${it.name}：${it.def?.description ?? '不能吃喔'}`);
    // V0.7：食物先選起來，下面出現「餵她吃」按鈕（寫著能恢復多少）
    selectedFood = selectedFood === id ? undefined : id;
    renderBag();
  }
  let selectedFood: ItemId | undefined;
  async function eat(id: ItemId) {
    if (busy || fishing) return;
    if (away()) return void toasts.show(ERROR_TEXT.away!);
    dialog.close();
    stop('down');
    const res = await act({ type: 'feed', item: id });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'fed') onFed(res.event);
  }

  function onFed(e: Extract<GameEvent, { type: 'fed' }>) {
    const it = itemLabel(gdefs!, e.item);
    const tags = [e.liked && 'liked', e.disliked && 'disliked', e.capped && 'capped'].filter((x): x is string => !!x);
    const got = [e.satiety > 0 && `🍙 +${Math.round(e.satiety)}`, e.stamina > 0 && `⚡ +${Math.round(e.stamina)}`, e.gain > 0 && `❤ +${e.gain}`].filter(Boolean).join('　');
    toasts.show(`${it.emoji} ${it.name}：${got || '吃了'}${e.gain > 0 ? '' : e.capped ? '（今天的好感已經滿了）' : e.disliked ? '（她好像不太喜歡…）' : ''}`);
    const level = e.levelUp;
    const then = level
      ? () => {
          toasts.show(`好感等級提升：${level}！`);
          void aiSay('levelup', { level }, () => {
            if (!say('levelup', { vars: { level } }).shown) showEmote('heart');
          });
        }
      : undefined;
    // 今天好感滿了：不管餵什麼都說「吃不下更多好感」那類台詞，不要讓物品專屬台詞蓋過去
    const lineCtx = e.capped ? { tags: ['capped'] } : { item: e.item, category: it.def?.category, tags };
    const r = say('feed', lineCtx, then);
    if (!r.played) showEmote('heart');
  }

  // 圖鑑
  function toggleCodex() {
    if (panel.kind === 'codex') panel.close();
    else showPanel('codex', renderCodex);
  }
  function renderCodex() {
    if (!gdefs || !view?.game) return;
    openPanel('codex', '📖 魚類圖鑑', buildCodex(doc, { defs: gdefs, caught: view.game.caught, claimed: view.game.claimed }));
  }

  function drawCrops(now: number) {
    const fontFor = (px: number) => `${px}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const sprinklers = new Set(view!.game!.sprinklers);
    for (const it of map.interactables) {
      if (it.kind !== 'plot') continue;
      const key = plotKey(it);
      const st = view!.game!.plots[key];
      const x = ox + it.rect.x * TS;
      const y = oy + it.rect.y * TS;
      const hasSprinkler = sprinklers.has(key);
      // 濕的土比較深色
      if (hasSprinkler || st?.watered) {
        ctx.fillStyle = 'rgba(40,25,60,0.32)';
        ctx.fillRect(x + 1, y + 1, TS - 2, TS - 2);
      }
      if (hasSprinkler) {
        ctx.fillStyle = '#9fd8ff';
        ctx.fillRect(x + TS - 5, y + 1, 4, 4);
        ctx.fillStyle = '#3f7fc4';
        ctx.fillRect(x + TS - 4, y + 2, 2, 2);
      }
      ctx.font = fontFor(TS - 4);
      if (!st) continue;
      ctx.fillStyle = '#000';
      // 口渴：頭上一顆閃爍的水滴
      if (!st.ready && !st.watered && Math.floor(now / 500) % 2 === 0) {
        ctx.fillStyle = '#6ec1ff';
        ctx.fillRect(x + 1, y + 2, 2, 3);
        ctx.fillRect(x + 1, y + 1, 1, 1);
      }
      const bob = st.ready ? Math.round(Math.abs(Math.sin(now / 260)) * 2) : 0; // 成熟了會輕輕跳
      // V0.10：作物有圖就畫圖（null = 剛播種，只看得到田地）
      const fr = pack.sprites?.atlas ? cropFrame(pack.sprites.file, st.crop, st.stage) : undefined;
      if (fr) {
        spriteAt(fr, ox + it.rect.x * TS + TS / 2, oy + it.rect.y * TS + TS / 2 - bob, TS + 2, false, true);
        ctx.font = fontFor(TS - 4);
        continue;
      }
      if (fr === null) continue;
      ctx.fillStyle = '#000';
      ctx.fillText(st.emoji, ox + it.rect.x * TS + TS / 2, oy + it.rect.y * TS + TS / 2 + 1 - bob);
    }
  }

  function describe(it: Interactable): string {
    if (!gdefs) return it.label;
    if (isLocked(it.unlock)) return `🔒 ${it.label}（點一下看解鎖條件）`;
    const g = view?.game;
    if (it.kind === 'fishing') return `${it.label}（體力 -${gdefs.file.fishing.staminaCost}）`;
    if (it.kind === 'shop' || it.kind === 'sign') return it.label;
    if (it.kind === 'machine') {
      const st = g?.machines[`${sceneId}/${it.id}`];
      return st ? (st.ready ? `${it.label}：做好了！` : `${it.label}：還要 ${formatDuration(st.readyAt - view!.now)}`) : `${it.label}：空著`;
    }
    if (it.kind === 'building') {
      const animals = g?.animals.filter((a) => a.building === it.building) ?? [];
      const ready = animals.filter((a) => a.pending).length;
      return `${it.label}（${animals.length} 隻${ready ? `，${ready} 個產品可以收` : ''}）`;
    }
    if (it.kind === 'npc') {
      const n = gdefs.file.npcs?.[it.npc!];
      const st = g?.npcs[it.npc!];
      return n ? `${n.emoji} ${n.name}${n.title ? `（${n.title}）` : ''} ${'❤'.repeat(st?.hearts ?? 0)}${st?.talkedToday ? '' : ' 💬'}` : it.label;
    }
    if (it.kind === 'mine') {
      const t = g?.mine.trip;
      return t ? (t.ready ? '⛏️ 她回來了！點一下接她' : `⛏️ 她在 ${t.floor} 樓，還要 ${formatDuration(t.endsAt - view!.now)}`) : `${it.label}（最深 ${g?.mine.deepest ?? 0} 樓）`;
    }
    const st = view?.game?.plots[plotKey(it)];
    const hasSprinkler = !!view?.game?.sprinklers.includes(plotKey(it));
    if (holdingSprinkler && !hasSprinkler) return '⛲ 點一下安裝灑水器';
    if (!st) {
      const seed = selectedSeed && view?.game?.inventory[selectedSeed] ? itemLabel(gdefs, selectedSeed).name : null;
      return `${seed ? `🌱 空地：點一下種 ${seed}` : '🌱 空地：點一下播種'}${hasSprinkler ? '（有灑水器）' : ''}`;
    }
    if (st.ready) return `${st.emoji} ${cropName(st.crop)}成熟了！點一下收成`;
    if (!st.watered) return `💧 ${cropName(st.crop)}（${st.stageName}）口渴了：點一下澆水`;
    return `${st.emoji} ${cropName(st.crop)}・${st.stageName}・${eta(st)}`;
  }

  // ───────────── V0.4：解鎖、擺放、裝修、居民、動物、礦洞、禮物碼 ─────────────
  /** 她去礦洞了（地圖上看不到她） */
  const away = () => !!view?.game?.mine.trip;
  const isLocked = (id?: string) => !!id && !!gdefs && !view?.game?.unlocked.includes(id);
  const inRect = (t: TilePos, r: { x: number; y: number; w: number; h: number }) => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h;

  /** 原本的地圖＋擺上去的家具（會擋路）和田（可以種）；地板、壁紙換了就重畫底層 */
  function deriveMap() {
    const placed = view?.game?.placed[sceneId] ?? [];
    const decor = view?.game?.decor[sceneId] ?? {};
    const tv = view?.game?.stats.tavern;
    const pSig = JSON.stringify(placed) + '|' + (tv?.npcs.join(',') ?? ''); // V0.13：酒館裡的人變了也要重算
    const dSig = JSON.stringify(decor);
    if (pSig !== placedSig || !map) {
      placedSig = pSig;
      const W = baseMap.width;
      const blocked = baseMap.blocked.slice();
      const extra: Interactable[] = [];
      for (const p of placed) {
        if (p.x >= W || p.y >= baseMap.height) continue;
        const def = gdefs?.items.get(p.item)?.place;
        if (def?.blocking) {
          // V0.14：家具佔好幾格：每一格都擋路
          const r = footprint(p.item, p.x, p.y, gdefs!);
          for (let y = r.y; y < Math.min(baseMap.height, r.y + r.h); y++) for (let x = r.x; x < Math.min(W, r.x + r.w); x++) blocked[y * W + x] = true;
        }
        if (def?.plot) extra.push({ id: `placed-${p.x}-${p.y}`, kind: 'plot', rect: { x: p.x, y: p.y, w: 1, h: 1 }, stands: [], label: '🌱 自己擺的田' });
      }
      // V0.13：社交時間（tavern.json）：老闆一直在酒館；晚上那幾個 NPC 從小鎮搬到酒館
      const T = gdefs?.file.tavern;
      let base = baseMap.interactables;
      if (T && tv) {
        const bg = baseMap.background?.scene;
        if (sceneId === T.scene && bg) {
          const c = imgToMap(bg, TS);
          const seats = [...T.residents, ...T.social.seats].filter((s) => tv.npcs.includes(s.npc));
          for (const s of seats) {
            const t = c.tile(s.at);
            blocked[t.y * W + t.x] = true;
            const p = c.point(s.at);
            const stand = s.stand ? c.tile(s.stand) : null;
            extra.push({
              id: `npc-${s.npc}`, kind: 'npc', npc: s.npc, rect: { x: t.x, y: t.y, w: 1, h: 1 },
              stands: stand ? [stand] : [], standFixed: !!stand,
              label: gdefs?.file.npcs?.[s.npc]?.name ?? s.npc,
              seat: { x: p.x, y: p.y, hideBelow: s.hideBelow !== undefined ? s.hideBelow * c.sy : undefined },
            });
          }
        } else if (tv.social) {
          const gone = new Set(T.social.seats.map((s) => s.npc));
          base = base.filter((it) => {
            // 居民本人，以及標了 npc 的東西（老陳的魚攤）都跟著去酒館
            if (!it.npc || !gone.has(it.npc)) return true;
            if (it.kind === 'npc' && !baseMap.background) blocked[it.rect.y * W + it.rect.x] = false; // 人走了，那一格可以走了
            return false;
          });
        }
      }
      const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < baseMap.height && !blocked[y * W + x];
      const all = [...base.map((it) => ({ ...it })), ...extra];
      for (const it of all) if (!it.standFixed) it.stands = standTiles(it.rect, walk); // V0.9：熱區指定的站位不重算
      map = { ...baseMap, blocked, interactables: all };
    }
    if (dSig !== decorSig || !below) {
      decorSig = dSig;
      below = renderLayers(baseMap, false, decorSwap(decor))!;
    }
  }

  function decorSwap(decor: Partial<Record<'floor' | 'wall', ItemId>>): Map<number, number> | undefined {
    const { names, firstgid } = baseMap.tileset;
    const m = new Map<number, number>();
    for (const item of Object.values(decor)) {
      const rep = item ? gdefs?.items.get(item)?.decor?.replace : undefined;
      for (const [from, to] of Object.entries(rep ?? {})) {
        const a = names.indexOf(from);
        const b = names.indexOf(to);
        if (a >= 0 && b >= 0) m.set(a + firstgid, b + firstgid);
      }
    }
    return m.size ? m : undefined;
  }

  // ───────────── V0.10：素材表的圖（有圖畫圖，沒有就畫 emoji） ─────────────
  /** 把圖集裡的一張畫進 size×size 的框（等比、置中；bottom 時貼底） */
  function spriteAt(fr: SpriteFrame, cx: number, cy: number, size: number, flip = false, bottom = false) {
    const atlas = pack.sprites?.atlas;
    if (!atlas) return;
    const k = size / Math.max(fr.w, fr.h);
    const w = fr.w * k;
    const h = fr.h * k;
    const y = bottom ? cy + size / 2 - h : cy - h / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = true; // 從 64～96px 縮到螢幕大小，用平滑縮圖才不會糊成一團
    ctx.imageSmoothingQuality = 'high';
    if (flip) {
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(atlas, fr.x, fr.y, fr.w, fr.h, -w / 2, y, w, h);
    } else ctx.drawImage(atlas, fr.x, fr.y, fr.w, fr.h, cx - w / 2, y, w, h);
    ctx.restore();
  }
  /** 物品：有圖畫圖，沒有畫 emoji */
  function itemAt(itemId: string, emoji: string, cx: number, cy: number, size: number, flip = false) {
    const fr = pack.sprites?.atlas ? itemFrame(pack.sprites.file, itemId) : null;
    if (fr) spriteAt(fr, cx, cy, size + 2, flip);
    else emojiAt(emoji, cx, cy, size, flip);
  }

  function emojiAt(text: string, cx: number, cy: number, size: number, flip = false) {
    ctx.font = `${size}px ${EMOJI_FONT}`;
    ctx.fillStyle = '#000'; // 彩色 emoji 會吃 fillStyle 的透明度：一定要不透明
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!flip) return void ctx.fillText(text, cx, cy);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(-1, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function shadow(cx: number, cy: number, w: number) {
    ctx.fillStyle = 'rgba(20,20,40,0.25)';
    ctx.fillRect(Math.round(cx - w / 2), Math.round(cy), w, 2);
  }

  /** 擺的東西、機器狀態、居民、動物（在角色之前畫） */
  function drawExtras(now: number) {
    const g = view!.game!;
    const bob = Math.round(Math.abs(Math.sin(now / 300)) * 2);
    // V0.14：先畫地毯（家具可以擺在地毯上），再照由上往下畫其他家具
    const placedHere = [...(g.placed[sceneId] ?? [])].sort((a, b) => {
      const ra = gdefs!.items.get(a.item)?.place?.rug ? 0 : 1;
      const rb = gdefs!.items.get(b.item)?.place?.rug ? 0 : 1;
      return ra - rb || a.y - b.y;
    });
    for (const p of placedHere) {
      const def = gdefs!.items.get(p.item);
      const fp = footprint(p.item, p.x, p.y, gdefs!);
      if (fp.w > 1 || fp.h > 1) {
        // 佔好幾格：圖縮放到整個範圍，貼底
        const cx = ox + (fp.x + fp.w / 2) * TS;
        const cy = oy + (fp.y + fp.h / 2) * TS;
        if (def?.place?.blocking) shadow(cx, oy + (fp.y + fp.h) * TS - 2, Math.round(fp.w * 7));
        const fr = pack.sprites?.atlas ? itemFrame(pack.sprites.file, p.item) : null;
        if (fr) spriteAt(fr, cx, cy, Math.max(fp.w, fp.h) * TS - 1, false, !def?.place?.rug);
        else emojiAt(def?.emoji ?? '❓', cx, cy, Math.min(fp.w, fp.h) * TS - 3);
        continue;
      }
      const cx = ox + p.x * TS + TS / 2;
      const cy = oy + p.y * TS + TS / 2;
      if (def?.place?.plot) {
        ctx.fillStyle = '#6a4128';
        ctx.fillRect(cx - TS / 2 + 1, cy - TS / 2 + 1, TS - 2, TS - 2);
        ctx.fillStyle = '#8a5a36';
        ctx.fillRect(cx - TS / 2 + 2, cy - TS / 2 + 2, TS - 4, TS - 4);
        continue;
      }
      if (def?.place?.blocking) shadow(cx, cy + 5, 10);
      itemAt(p.item, def?.emoji ?? '❓', cx, cy, TS - 3);
    }
    const sf = pack.sprites?.atlas ? pack.sprites.file : undefined;
    for (const it of map.interactables) {
      const cx = ox + (it.rect.x + it.rect.w / 2) * TS;
      const top = oy + it.rect.y * TS;
      // V0.13：機器有圖就畫圖（還沒解鎖的畫淡一點，上面照樣蓋鎖頭）；地圖上的底座圖塊是透明的
      const mfr = it.kind === 'machine' ? objectFrame(sf, `machine_${it.machine}`) : null;
      if (mfr) {
        ctx.save();
        if (isLocked(it.unlock)) ctx.globalAlpha = 0.5;
        shadow(cx, top + it.rect.h * TS - 2, 7);
        spriteAt(mfr, cx, top + it.rect.h * TS - TS / 2 - 1, TS + 1, false, true);
        ctx.restore();
      }
      if (isLocked(it.unlock)) continue;
      if (it.kind === 'machine') {
        const def = gdefs!.file.machines?.[it.machine!];
        if (!mfr) emojiAt(def?.emoji ?? '⚙️', cx, top + 4, 11);
        const st = g.machines[`${sceneId}/${it.id}`];
        if (st) emojiAt(st.ready ? '✨' : '⏳', cx + 6, top - 4 - (st.ready ? bob : 0), 8);
      } else if (it.kind === 'building') {
        if (g.animals.some((a) => a.building === it.building && a.pending)) emojiAt('✨', cx, top - 2 - bob, 10);
      } else if (it.kind === 'sign' && it.iconItem && sf && itemFrame(sf, it.iconItem)) {
        itemAt(it.iconItem, it.icon ?? '❓', cx, top + (it.rect.h * TS) / 2, Math.min(13, it.rect.h * TS - 3)); // V0.15：用素材表的圖
      } else if (it.kind === 'sign' && it.icon) {
        emojiAt(it.icon, cx, top + (it.rect.h * TS) / 2, Math.min(14, it.rect.h * TS - 2));
      } else if (it.kind === 'npc') {
        const n = gdefs!.file.npcs?.[it.npc!];
        const img = imgOf(n?.sprite);
        if (img) drawNpcSprite(it, img, now);
        else {
          shadow(cx, top + TS - 2, 9);
          emojiAt(n?.emoji ?? '🙂', cx, top + TS / 2 - 1, TS - 2);
        }
        const foot = npcFoot(it);
        const headTop = img ? foot.y - img.naturalHeight * NPC_SCALE * actorScale : top;
        if (!g.npcs[it.npc!]?.talkedToday) emojiAt('💬', foot.x + 7, headTop - 1 - bob, 8);
        drawNpcBubble(it.npc!, foot.x, headTop - 2, now);
      } else if (it.kind === 'mine' && g.mine.trip) {
        emojiAt(g.mine.trip.ready ? '✨' : '⛏️', cx, top - 4 - bob, 10);
      }
    }
    // 動物：在自己建築的圍欄裡閒晃
    for (const a of g.animals) {
      const pos = animalPos.get(a.id);
      if (!pos) continue;
      const def = gdefs!.file.animals?.[a.kind];
      const baby = !!def?.baby && (view?.now ?? Date.now()) < a.bornAt + (def.baby.growHours ?? 0) * 3_600_000;
      const fr = pack.sprites?.atlas ? animalFrame(pack.sprites.file, a.kind, baby) : null;
      shadow(ox + pos.x, oy + pos.y + 5, baby ? 7 : 9);
      // V0.10：有圖畫圖（素材表的動物跟 emoji 一樣朝左，往右走時翻過來）；幼崽畫小一點
      if (fr) spriteAt(fr, ox + pos.x, oy + pos.y - 1, baby ? 12 : 16, pos.flip, true);
      else emojiAt((baby ? def?.baby?.emoji : undefined) ?? def?.emoji ?? '❓', ox + pos.x, oy + pos.y, 11, pos.flip);
      if (a.pending) itemAt(a.pending, itemLabel(gdefs!, a.pending).emoji, ox + pos.x + 6, oy + pos.y - 9 - bob, 7);
    }
  }

  function drawLocks() {
    for (const it of map.interactables) {
      if (!isLocked(it.unlock)) continue;
      emojiAt('🔒', ox + (it.rect.x + it.rect.w / 2) * TS, oy + (it.rect.y + it.rect.h / 2) * TS, 10);
    }
    for (const d of map.doors) {
      if (!isLocked(d.unlock)) continue;
      emojiAt('🔒', ox + (d.rect.x + d.rect.w / 2) * TS, oy + (d.rect.y + d.rect.h / 2) * TS, 10);
    }
  }

  function updateAnimals(dt: number) {
    const g = view?.game;
    if (!g) return;
    const pens = map.areas.filter((a) => a.kind === 'pen');
    const alive = new Set<number>();
    for (const a of g.animals) {
      const pen = pens.find((p) => p.building === a.building);
      if (!pen) continue;
      alive.add(a.id);
      const r = pen.rect;
      const rnd = () => ({ x: (r.x + 0.3 + rng() * (r.w - 0.6)) * TS, y: (r.y + 0.4 + rng() * (r.h - 0.6)) * TS });
      let p = animalPos.get(a.id);
      if (!p) {
        const s = rnd();
        p = { x: s.x, y: s.y, tx: s.x, ty: s.y, flip: false };
        animalPos.set(a.id, p);
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.5) {
        if (rng() < dt * 0.6) {
          const t = rnd();
          p.tx = t.x;
          p.ty = t.y;
        }
      } else {
        const step = Math.min(d, 9 * dt);
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        if (Math.abs(dx) > 0.5) p.flip = dx > 0;
      }
    }
    for (const id of animalPos.keys()) if (!alive.has(id)) animalPos.delete(id);
  }

  // 解鎖
  function openUnlock(id: string) {
    const def = gdefs?.file.unlocks?.[id];
    if (!def || !view?.game) return;
    showPanel('unlock', () => openPanel('unlock', `${def.emoji ?? '🔒'} ${def.name}`, buildUnlock(doc, {
      id, def, defs: gdefs!, inventory: view!.game!.inventory, unlocked: view!.game!.unlocked, onUnlock: () => void doUnlock(id),
    })));
  }
  async function doUnlock(id: string) {
    const res = await act({ type: 'unlock', id });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    panel.close();
    const def = gdefs!.file.unlocks![id]!;
    toasts.show(`🔓 ${def.emoji ?? ''} ${def.name} 完成！`, 3200);
    if (!away()) showEmote('exclaim');
  }

  // 出貨箱
  /** 賣東西：出貨箱什麼都收；指定的商人（例如老陳的魚攤）只收他要的分類 */
  function openSell(shopId?: string) {
    const sh = shopId ? gdefs?.file.shops[shopId] : undefined;
    showPanel('sell', () => openPanel('sell', sh ? `${sh.emoji} ${sh.name}` : '📦 出貨箱', buildSell(doc, {
      defs: gdefs!, inventory: view!.game!.inventory, greeting: sh?.greeting ? `${sh.greeting} ` : undefined, buys: sh?.buys,
      onSell: (item, count) => void sell(item, count, shopId),
    })));
  }
  async function sell(item: ItemId, count: number, shop?: string) {
    const res = await act({ type: 'sell', item, count, ...(shop ? { shop } : {}) });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'sold') {
      const it = itemLabel(gdefs!, item);
      toasts.show(`賣了 ${it.emoji} ${it.name} ×${res.event.count}：🪙 +${res.event.coins}`);
    }
  }

  // 加工機器
  function openMachine(it: Interactable) {
    const def = it.machine ? gdefs?.file.machines?.[it.machine] : undefined;
    if (!def) return void toasts.show('這台機器壞了');
    const key = `${sceneId}/${it.id}`;
    if (!away()) {
      stop(faceToward(pet.tile, it.rect));
      pet.idleUntil = Infinity;
    }
    showPanel('machine', () => openPanel('machine', `${def.emoji} ${def.name}`, buildMachine(doc, {
      def, defs: gdefs!, state: view!.game!.machines[key], inventory: view!.game!.inventory, now: view!.now,
      onStart: (recipe) => void machineStart(key, it.machine!, recipe),
      onCollect: () => void machineCollect(key),
    })));
  }
  async function machineStart(key: string, machine: string, recipe: string) {
    const res = await act({ type: 'machine_start', key, machine, recipe });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'machine_started') toasts.show(`⏳ 開始製作，${formatDuration(res.event.readyAt - res.view.now)}後完成`);
  }
  async function machineCollect(key: string) {
    const res = await act({ type: 'machine_collect', key });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'machine_collected') {
      toasts.show(`拿到了 ${Object.entries(res.event.get).map(([id, n]) => `${itemLabel(gdefs!, id).emoji} ${itemLabel(gdefs!, id).name} ×${n}`).join('、')}`);
    }
  }

  // 動物
  function openAnimals(building: string) {
    const def = gdefs?.file.buildings?.[building];
    if (!def) return;
    if (!view?.game?.buildings[building]) return openUnlock(building);
    showPanel('animals', () => {
      const g = view!.game!;
      const bv = g.buildings[building];
      if (!bv) return;
      openPanel('animals', `${def.emoji} ${def.name}`, buildAnimals(doc, {
        id: building, def, defs: gdefs!, view: bv, animals: g.animals.filter((a) => a.building === building), inventory: g.inventory, now: view!.now,
        onBuy: (kind) => void animalAct({ type: 'buy_animal', kind }),
        onFeed: () => void animalAct({ type: 'feed_animals', building }),
        onPet: (id) => void animalAct({ type: 'pet_animal', animal: id }),
        onCollect: () => void animalAct({ type: 'collect_animals', building }),
        onUpgrade: () => void animalAct({ type: 'upgrade_building', building }),
        onSell: (id) => void animalAct({ type: 'sell_animal', animal: id }),
      }));
    });
  }
  async function animalAct(a: GameAction) {
    const res = await act(a);
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    const e = res.event;
    const fmt = (items: Record<ItemId, number>) => Object.entries(items).map(([id, n]) => `${itemLabel(gdefs!, id).emoji} ${itemLabel(gdefs!, id).name} ×${n}`).join('、');
    if (e.type === 'animal_bought') toasts.show(`${gdefs!.file.animals?.[e.kind]?.emoji ?? ''} 「${e.name}」來到你家了！`);
    else if (e.type === 'animals_fed') toasts.show(`🌾 餵了 ${e.count} 隻`);
    else if (e.type === 'animal_petted') toasts.show(`🤚 摸摸～ 心情 ${e.mood}、好感 ${e.friendship}`);
    else if (e.type === 'animals_collected') toasts.show(`🧺 收到 ${fmt(e.items)}`);
    else if (e.type === 'building_upgraded') toasts.show(`⬆ 升級完成：可以養 ${e.capacity} 隻`);
    else if (e.type === 'animal_sold') toasts.show(`👋 把「${e.name}」賣給商人了：🪙 +${e.coins}`);
  }

  // 居民
  /** 點居民：在遊戲畫面中間跳出 RPG 對話框，選「聊天／送禮／逛商店／離開」 */
  function openNpc(id: string) {
    const def = gdefs?.file.npcs?.[id];
    const st = view?.game?.npcs[id];
    if (!def || !st) return;
    if (!away()) pet.idleUntil = Infinity;
    hops.set(id, performance.now() + 420);
    let image: string | undefined;
    try {
      image = def.portrait || def.sprite ? pack.asset((def.portrait ?? def.sprite)!) : undefined;
    } catch {
      image = undefined;
    }
    const shopIds = [...(def.shop ? [def.shop] : []), ...(def.shops ?? []).filter((x) => x !== def.shop)];
    const F = gdefs?.file.furniture;
    const catalogOpt = F && F.npc === id ? [{ label: `${F.emoji} 看「${F.name}」`, onClick: () => openCatalog() }] : []; // V0.14
    const firstShop = shopIds.map((sid) => gdefs!.file.shops[sid]).find((x) => x?.greeting);
    const hearts = '❤'.repeat(st.hearts) + '♡'.repeat(Math.max(0, 10 - st.hearts));
    const text = `${firstShop?.greeting ?? '嗨！今天想做什麼呢？'}\n${hearts}`;
    dialog.choose(text, [
      { label: st.talkedToday ? '💬 聊天（今天聊過了）' : '💬 聊天', onClick: () => void npcTalk(id) },
      { label: st.giftedToday ? '🎁 今天送過禮了' : '🎁 送禮', disabled: st.giftedToday, onClick: () => openGift(id) },
      ...shopIds.map((sid) => {
        const sh = gdefs!.file.shops[sid]!;
        return { label: sh.mode === 'sell' ? `${sh.emoji} 賣東西給${def.name}` : `${sh.emoji} 逛「${sh.name}」`, onClick: () => openShopById(sid) };
      }),
      ...catalogOpt,
      { label: '👋 離開', onClick: () => undefined },
    ], { name: def.name, emoji: def.emoji, image }, () => {
      if (!away()) idle(700);
    });
  }
  /** 送禮：模態視窗裡選要送的東西 */
  function openGift(id: string) {
    const def = gdefs?.file.npcs?.[id];
    if (!def || !view?.game) return;
    showPanel('gift', () => openPanel('gift', `🎁 送禮給${def.name}`, buildNpc(doc, {
      def, defs: gdefs!, state: view!.game!.npcs[id]!, inventory: view!.game!.inventory, giftOnly: true,
      onTalk: () => void npcTalk(id),
      onGift: (item) => void npcGift(id, item),
    })));
  }
  /** 居民說話：對話框換成對方的名字和頭像；多句的劇情一句一句接著播 */
  function sayAs(who: { name: string; emoji: string; portrait?: string; sprite?: string }, lines: string[], i = 0, after?: () => void) {
    if (!away()) pet.idleUntil = Infinity;
    const npcId = Object.entries(gdefs?.file.npcs ?? {}).find(([, n]) => n.name === who.name)?.[0];
    if (npcId && i === 0) hops.set(npcId, performance.now() + 420); // 說話時輕輕跳一下
    dialog.show(lines[i]!, () => {
      if (i + 1 < lines.length) sayAs(who, lines, i + 1, after);
      else {
        if (!away()) idle(700);
        after?.();
      }
    }, false, npcSpeaker(who));
  }
  async function npcTalk(id: string) {
    const def = gdefs!.file.npcs![id]!;
    const res = await act({ type: 'talk', npc: id });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type !== 'talked') return;
    panel.close();
    if (res.event.gain > 0) toasts.show(`${def.emoji} ${def.name} 好感 +${res.event.gain}`);
    if (res.event.event) {
      toasts.show(`✨ ${def.name}的劇情`, 3200);
      sayAs(def, res.event.event.lines); // 劇情是寫好的，不交給 AI
      return;
    }
    // V0.8：先讓 AI 想；想不出來（沒 Key、逾時…）就用 host 從 JSON 抽好的那句
    const fallbackText = res.event.text;
    if (!aiReady()) return sayAs(def, [fallbackText]);
    dialog.thinking(npcSpeaker(def));
    const text = await aiLine(id, 'talk');
    sayAs(def, [text ?? fallbackText]);
  }
  function npcSpeaker(who: { name: string; emoji: string; portrait?: string; sprite?: string }) {
    let image: string | undefined;
    try {
      image = who.portrait || who.sprite ? pack.asset((who.portrait ?? who.sprite)!) : undefined;
    } catch {
      image = undefined;
    }
    return { name: who.name, emoji: who.emoji, image };
  }
  async function npcGift(id: string, item: ItemId) {
    const def = gdefs!.file.npcs![id]!;
    const res = await act({ type: 'gift', npc: id, item });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type !== 'gifted') return;
    panel.close();
    const e = res.event;
    toasts.show(`${itemLabel(gdefs!, item).emoji} 送給${def.name}：好感 ${e.gain >= 0 ? '+' : ''}${e.gain}`);
    sayAs(def, [GIFT_REACTION[e.reaction]]);
  }

  // 告白、結婚
  async function propose() {
    if (away()) return void toasts.show(ERROR_TEXT.away!);
    panel.close();
    const res = await act({ type: 'propose' });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    stop('down');
    toasts.show('💍 你們結婚了！從明天起，她每天早上會幫忙照顧農場。', 5200);
    if (!say('married').played) showEmote('heart');
  }

  // 礦洞
  function openMine() {
    const mine = gdefs?.file.mine;
    if (!mine || !view?.game) return;
    const max = Math.min(view.game.mine.deepest + 1, mineMaxFloor(gdefs!));
    mineFloor = Math.min(Math.max(1, mineFloor === 1 ? max : mineFloor), max);
    showPanel('mine', renderMine);
  }
  function renderMine() {
    openPanel('mine', '⛏️ 礦洞', buildMine(doc, {
      defs: gdefs!, game: view!.game!, now: view!.now, floor: mineFloor, canDive: !!ch.player && !!pack.maps.mine,
      onFloor: (f) => {
        mineFloor = f;
        renderMine();
      },
      onStart: () => void mineStart(),
      onCollect: () => void mineCollect(),
      onDive: () => {
        panel.close();
        void startDive(mineFloor);
      },
    }));
  }
  async function mineStart() {
    const res = await act({ type: 'mine_start', floor: mineFloor });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type !== 'mine_started') return;
    panel.close();
    toasts.show(`⛏️ 她出發去 ${res.event.floor} 樓了，${formatDuration(res.event.endsAt - res.view.now)}後回來`, 3600);
    say('mine_go');
  }
  async function mineCollect() {
    const res = await act({ type: 'mine_collect' });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'mine_returned') showReport(res.event.report);
  }
  function showReport(r: MineReport) {
    showPanel('report', () => openPanel('report', '⛏️ 礦洞報告', buildReport(doc, gdefs!, r)));
    pet.face = 'down';
    if (!say('mine_back', { tags: r.injured ? ['injured'] : [] }).played) showEmote(r.injured ? 'dots' : 'exclaim');
  }

  // 禮物碼與名片（擴展 E6）
  function cardData(): CardData {
    const g = view!.game!;
    const fish = gdefs!.file.items.filter((i) => i.category === 'fish');
    return { n: ch.name, lv: g.level, a: g.affection, f: fish.filter((i) => g.caught[i.id]).length, t: fish.length, m: g.married };
  }
  function openGifts() {
    if (!gdefs || !view?.game) return;
    showPanel('gifts', () => openPanel('gifts', '🎁 禮物碼與名片', buildGifts(doc, {
      defs: gdefs!, inventory: Object.fromEntries(Object.entries(view!.game!.inventory).filter(([id]) => id !== COIN || true)),
      lastCode: lastGiftCode, card: encodeCard(cardData()), friend: friendCard,
      onSend: (item, count) => void giftSend(item, count),
      onRedeem: (code) => void giftRedeem(code),
      onCard: (code) => {
        friendCard = decodeCard(code);
        if (!friendCard) toasts.show(ERROR_TEXT.bad_code!);
        panelRender?.();
      },
    })), () => (lastGiftCode = null));
  }
  async function giftSend(item: ItemId, count: number) {
    const res = await act({ type: 'gift_send', item, count });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'gift_code') {
      lastGiftCode = res.event.code;
      toasts.show('🎁 禮物碼做好了，複製給朋友吧');
      panelRender?.();
    }
  }
  async function giftRedeem(code: string) {
    const res = await act({ type: 'gift_redeem', code });
    if (!res) return;
    if (!res.ok) return void toasts.show(res.error === 'already' ? '這張禮物碼已經收過了（自己寄出的也不能收）' : ERROR_TEXT[res.error] ?? '收不了');
    if (res.event.type === 'gift_received') {
      toasts.show(`📥 收到 ${Object.entries(res.event.items).map(([id, n]) => `${itemLabel(gdefs!, id).emoji} ${itemLabel(gdefs!, id).name} ×${n}`).join('、')}`);
    }
  }

  // 地板、壁紙
  async function decorate(item: ItemId) {
    const rep = gdefs!.items.get(item)?.decor?.replace ?? {};
    const names = new Set(Object.keys(rep));
    const { names: tileNames, firstgid } = baseMap.tileset;
    const has = baseMap.layers.some((l) => l.gids.some((g) => g && names.has(tileNames[g - firstgid] ?? '')));
    if (map.background) return void toasts.show('這個房間是一整張畫好的背景圖，換不了地板和壁紙（閣樓可以換）');
    if (!has) return void toasts.show('這裡沒有可以換的地板或壁紙（到閣樓試試）');
    const res = await act({ type: 'decorate', scene: sceneId, item });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'decorated') {
      const old = res.event.returned ? itemLabel(gdefs!, res.event.returned) : null;
      toasts.show(`✨ 換好了！${old ? `舊的${old.name}收回揹包了` : ''}`);
    }
  }

  // 裝修模式：擺家具、收回家具
  function setDecorMode(on: boolean) {
    decorMode = on;
    if (!on) holding = null;
    modeTag.hidden = !on;
    shell.querySelector('.px-decor-btn')?.classList.toggle('on', on); // 按鈕在側邊欄（不在 stage 裡）
    stage.dataset.decor = on ? '1' : '';
    updateModeTag();
  }
  function toggleDecorMode() {
    setDecorMode(!decorMode);
    if (decorMode) toasts.show('🛠 裝修模式：揹包點家具拿起來、點地圖擺放；點已經擺的家具收回。Esc 離開', 4200);
  }
  function updateModeTag() {
    const it = holding && gdefs ? itemLabel(gdefs, holding) : null;
    modeTag.textContent = it
      ? `🛠 拿著 ${it.emoji} ${it.name}（剩 ${view?.game?.inventory[holding!] ?? 0}）：點空格擺放｜Esc 離開`
      : '🛠 裝修模式：點家具收回｜🎒 揹包選家具｜Esc 離開';
  }
  /** V0.14：這一格上面的家具（佔好幾格的也算；疊在地毯上的先算上面那件） */
  function placedAt(t: TilePos) {
    const hits = (view?.game?.placed[sceneId] ?? []).filter((p) => inFootprint(footprint(p.item, p.x, p.y, gdefs!), t.x, t.y));
    return hits.find((p) => !gdefs!.items.get(p.item)?.place?.rug) ?? hits[0];
  }
  /** 裝修模式：拿著家具時，滑鼠停的格子畫一個預覽框（綠色可以擺、紅色不行） */
  let decorHover: TilePos | null = null;
  function drawDecorPreview() {
    if (!decorMode || !holding || !decorHover || !gdefs) return;
    const def = gdefs.items.get(holding)?.place;
    if (!def) return;
    const fp = footprint(holding, decorHover.x, decorHover.y, gdefs);
    const bad = !!placeProblem(decorHover, def, holding);
    ctx.save();
    ctx.globalAlpha = 0.55;
    const fr = pack.sprites?.atlas ? itemFrame(pack.sprites.file, holding) : null;
    if (fr) spriteAt(fr, ox + (fp.x + fp.w / 2) * TS, oy + (fp.y + fp.h / 2) * TS, Math.max(fp.w, fp.h) * TS - 1, false, !def.rug);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = bad ? '#e0454b' : '#3fbf6a';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + fp.x * TS + 0.5, oy + fp.y * TS + 0.5, fp.w * TS - 1, fp.h * TS - 1);
    ctx.restore();
  }
  async function onDecorClick(t: TilePos) {
    const here = placedAt(t);
    if (!holding) {
      if (!here) return void toasts.show('這裡沒有家具。從 🎒 揹包選一件家具來擺吧');
      const res = await act({ type: 'pickup', scene: sceneId, x: t.x, y: t.y });
      if (!res) return;
      if (!res.ok) return void toasts.show(res.error === 'plot_busy' ? '田裡還有作物，收成之後才能收回' : ERROR_TEXT[res.error] ?? '收不回來');
      toasts.show(`收回了 ${itemLabel(gdefs!, here.item).emoji} ${itemLabel(gdefs!, here.item).name}`);
      return;
    }
    const def = gdefs!.items.get(holding)?.place;
    if (!def) return;
    const why = placeProblem(t, def, holding);
    if (why) return void toasts.show(why);
    const item = holding;
    const res = await act({ type: 'place', scene: sceneId, item, x: t.x, y: t.y });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (!res.view.game?.inventory[item]) holding = null;
    updateModeTag();
  }
  function placeProblem(t: TilePos, def: { blocking: boolean; where?: string; rug?: boolean }, item: ItemId): string | null {
    const fp = footprint(item, t.x, t.y, gdefs!);
    if (t.x < 0 || t.y < 0 || fp.x + fp.w > map.width || fp.y + fp.h > map.height) return fp.w > 1 || fp.h > 1 ? `這件要 ${fp.w}×${fp.h} 格，往左上一點` : '請點地圖裡面';
    const isOut = outdoor.has(sceneId);
    if (def.where === 'indoor' && isOut) return '這個要擺在室內';
    if (def.where === 'outdoor' && !isOut) return '這個要擺在戶外';
    // V0.14：佔好幾格的家具，每一格都要檢查
    const tiles: TilePos[] = [];
    for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) tiles.push({ x, y });
    const others = (view?.game?.placed[sceneId] ?? []).filter((p) => !!gdefs!.items.get(p.item)?.place?.rug === !!def.rug);
    for (const c of tiles) {
      // 地毯可以鋪在已經擺好的家具底下：只看原本的地圖能不能走；其他家具要看現在能不能走
      const free = def.rug ? !baseMap.blocked[c.y * baseMap.width + c.x] : isWalkable(map, c);
      if (!free) return fp.w > 1 || fp.h > 1 ? '有一格放不下' : '這格放不下';
      if (others.some((p) => inFootprint(footprint(p.item, p.x, p.y, gdefs!), c.x, c.y))) return '這裡已經有東西了';
      if (map.doors.some((d) => inRect(c, d.rect))) return '不能擋在門口';
      if (map.interactables.some((it) => inRect(c, it.rect))) return '這裡已經有東西了';
      if (def.blocking && !away() && c.x === pet.tile.x && c.y === pet.tile.y) return '她站在這裡';
    }
    if (def.blocking && wouldBlock(tiles)) return '會擋住路，換個地方吧';
    return null;
  }
  /** 放下去之後，原本走得到的門、出生點、地點、互動物件，還走不走得到 */
  function wouldBlock(ts: TilePos[]): boolean {
    const from = away() ? map.spawns.default?.tile : pet.tile;
    if (!from) return false;
    const idx = (p: TilePos) => p.y * map.width + p.x;
    const blocked = map.blocked.slice();
    for (const t of ts) blocked[idx(t)] = true;

    const before = distances(map, from);
    const after = distances({ ...map, blocked }, from);
    const ok0 = (p: TilePos) => Number.isFinite(before[idx(p)]!);
    const ok1 = (p: TilePos) => !ts.some((t) => p.x === t.x && p.y === t.y) && Number.isFinite(after[idx(p)]!);
    const targets = [...map.doors.flatMap((d) => (d.stand ? [d.stand] : [])), ...Object.values(map.spots).map((s) => s.tile), ...Object.values(map.spawns).map((s) => s.tile)];
    if (targets.some((p) => ok0(p) && !ok1(p))) return true;
    return map.interactables.some((it) => it.stands.some(ok0) && !it.stands.some(ok1));
  }

  // ───────────── 擴展 E3：主人自己走（玩家操控）＋ E4：即時戰鬥礦洞 ─────────────
  const playerSheet = ch.player;
  const playerImg = playerSheet ? pack.images[playerSheet.src] : undefined;
  const player = { on: false, tile: { x: 0, y: 0 } as TilePos, px: 0, py: 0, face: 'down' as Facing, target: null as TilePos | null, clock: 0, hurtUntil: 0 };
  const held = new Set<string>();
  const hpTag = Object.assign(doc.createElement('div'), { className: 'px-hp' });
  hpTag.hidden = true;
  modeHost.append(hpTag);
  const DIRS: Record<Facing, TilePos> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const KEY_DIR: Record<string, Facing> = {
    ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right', s: 'down', w: 'up', a: 'left', d: 'right', S: 'down', W: 'up', A: 'left', D: 'right',
  };
  const same = (a: TilePos, b: TilePos) => a.x === b.x && a.y === b.y;
  const tkey = (t: TilePos) => `${t.x},${t.y}`;
  const front = (t: TilePos, f: Facing) => ({ x: t.x + DIRS[f].x, y: t.y + DIRS[f].y });

  interface Mob { id: number; name: string; emoji: string; hp: number; atk: number; drop?: ItemId; tile: TilePos; px: number; py: number; next: number; cool: number; hitUntil: number; speed: number }
  interface Combat {
    floor: number; hp: number; hpMax: number; power: number; armor: number; maxFloor: number;
    rocks: Set<string>; hiddenLadder: string | null; ladder: TilePos | null; mobs: Mob[]; loot: Record<ItemId, number>; kills: number; swingUntil: number; ending: boolean;
  }
  let combat: Combat | null = null;
  let mobId = 1;

  function setPlayerMode(on: boolean) {
    if (!playerSheet || !playerImg) return void toasts.show('這個角色包沒有主人的圖');
    if (!on && combat) return void toasts.show('在礦洞裡不能切換，先從左上的梯子回地面');
    player.on = on;
    held.clear();
    stage.querySelector('.px-player-btn')?.classList.toggle('on', on);
    stage.dataset.player = on ? '1' : '';
    if (on) {
      placePlayer(away() ? map.spawns.default?.tile ?? pet.tile : pet.tile);
      toasts.show('🕹 自己走：方向鍵／WASD 移動，E 或空白鍵讓她做事、和她說話；走進門口再往前就會出門。P 關閉', 5200);
      canvas.focus({ preventScroll: true });
    }
  }

  /** 把主人放在 near 旁邊能站的格子（沒有就站在 near） */
  function placePlayer(near: TilePos) {
    const cands = [near, ...(['down', 'left', 'right', 'up'] as Facing[]).map((f) => front(near, f))];
    const t = cands.find((c) => !same(c, near) && isWalkable(map, c)) ?? near;
    const f = feet(t);
    Object.assign(player, { tile: { ...t }, px: f.x, py: f.y, target: null, face: 'down' });
  }

  function playerBlocked(t: TilePos): boolean {
    if (!isWalkable(map, t)) return true;
    if (combat && (combat.rocks.has(tkey(t)) || combat.mobs.some((m) => same(m.tile, t)))) return true;
    return false;
  }

  function updatePlayer(dt: number, now: number) {
    if (!player.on || busy || dialog.open || panel.isShown || decorMode) return;
    if (player.target) {
      const f = feet(player.target);
      const dx = f.x - player.px;
      const dy = f.y - player.py;
      const dist = Math.hypot(dx, dy);
      const horse = view?.game?.unlocked.includes('stable') && outdoor.has(sceneId) ? HORSE_SPEED : 1;
      const step = ch.speed * 1.25 * horse * TS * dt;
      player.clock += dt;
      if (dist <= step) {
        player.px = f.x;
        player.py = f.y;
        player.tile = player.target;
        player.target = null;
        onPlayerStep();
      } else {
        player.px += (dx / dist) * step;
        player.py += (dy / dist) * step;
      }
      return;
    }
    const dir = [...held].map((k) => KEY_DIR[k]).filter((x): x is Facing => !!x).at(-1);
    if (!dir) return;
    player.face = dir;
    const next = front(player.tile, dir);
    if (!playerBlocked(next)) {
      player.target = next;
      return;
    }
    // 站在門的範圍裡、往牆（或地圖外）走：出門
    const door = map.doors.find((d) => inRect(player.tile, d.rect));
    if (door && now > player.hurtUntil - 400) useDoor(door);
  }

  function useDoor(door: DoorDef) {
    held.clear();
    if (isLocked(door.unlock)) return openUnlock(door.unlock!);
    if (combat) return void exitMine(false);
    void goto(door.to, door.spawn);
  }

  function onPlayerStep() {
    if (combat?.ladder && same(player.tile, combat.ladder)) void nextFloor();
  }

  /** E／空白鍵：在礦洞裡攻擊；平常是讓她做面前的事、或跟她說話 */
  function playerUse() {
    const f = front(player.tile, player.face);
    if (combat) return attack(f);
    if (!away() && (same(f, pet.tile) || same(player.tile, pet.tile))) return talk();
    const it = gdefs ? interactableAt(f.x, f.y) : undefined;
    if (it) return approach(it);
    const door = map.doors.find((d) => inRect(player.tile, d.rect) || inRect(f, d.rect));
    if (door) return useDoor(door);
  }

  /** 她跟在主人後面（取代作息） */
  function followPlayer() {
    if (away() || fishing) return idle(500);
    const d = Math.abs(pet.tile.x - player.tile.x) + Math.abs(pet.tile.y - player.tile.y);
    if (d <= 2) return idle(300);
    const p = findPath(map, pet.tile, player.tile);
    if (!p || p.length < 2) return idle(500);
    pet.path = p.slice(0, -1);
    pet.goal = { kind: 'tile' };
    pet.walking = true;
    pet.clip = null;
  }

  function drawPlayer(now: number) {
    if (!player.on || !playerSheet || !playerImg) return;
    const sx = ox + Math.round(player.px);
    const sy = oy + Math.round(player.py);
    ctx.fillStyle = 'rgba(20,20,40,0.28)';
    ctx.fillRect(sx - 4, sy - 1, 8, 2);
    if (now < player.hurtUntil && Math.floor(now / 80) % 2 === 0) return; // 受傷閃爍
    const col = player.target ? playerSheet.walk[Math.floor(player.clock * playerSheet.fps) % playerSheet.walk.length]! : playerSheet.idle;
    drawFrame(playerImg, playerSheet, col, playerSheet.rows[player.face], sx, sy, 0);
    if (combat && now < combat.swingUntil) {
      const f = front(player.tile, player.face);
      emojiAt('💥', ox + f.x * TS + TS / 2, oy + f.y * TS + TS / 2, 12);
    }
  }

  // ── E4：即時戰鬥 ──
  async function startDive(floor: number) {
    const mine = gdefs?.file.mine;
    const g = view?.game;
    if (!mine || !g || !pack.maps.mine) return;
    if (!player.on) setPlayerMode(true);
    if (!player.on) return;
    const eq = g.equipment;
    combat = {
      floor, hp: mine.baseHp + eq.armor.power * 2, hpMax: mine.baseHp + eq.armor.power * 2, power: mine.basePower + eq.weapon.power, armor: eq.armor.power,
      maxFloor: Math.min(mineMaxFloor(gdefs!), g.mine.deepest + 3), rocks: new Set(), hiddenLadder: null, ladder: null, mobs: [], loot: {}, kills: 0, swingUntil: 0, ending: false,
    };
    await goto('mine', 'default');
    if (sceneId !== 'mine') {
      combat = null;
      return;
    }
    placePlayer(map.spawns.default!.tile);
    genFloor();
    toasts.show(`🗡️ ${floor} 樓：空白鍵／J 攻擊、敲石頭；找到往下的梯子就能下一層；左上的梯子回地面`, 5200);
  }

  function genFloor() {
    const c = combat!;
    const zone = mineZone(gdefs!, c.floor)!;
    const area = map.areas.find((a) => a.kind === 'area')?.rect ?? { x: 0, y: 0, w: map.width, h: map.height };
    const exits = map.doors.map((d) => d.rect);
    const free: TilePos[] = [];
    for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) {
      const t = { x, y };
      if (!isWalkable(map, t) || exits.some((r) => inRect(t, r))) continue;
      if (Math.abs(x - player.tile.x) + Math.abs(y - player.tile.y) <= 2) continue;
      free.push(t);
    }
    const take = () => free.splice(Math.floor(rng() * free.length), 1)[0];
    c.rocks.clear();
    c.mobs = [];
    c.ladder = null;
    const nRocks = 7 + Math.floor(rng() * 5);
    for (let i = 0; i < nRocks; i++) {
      const t = take();
      if (t) c.rocks.add(tkey(t));
    }
    c.hiddenLadder = [...c.rocks][Math.floor(rng() * c.rocks.size)] ?? null;
    const depth = c.floor - zone.from;
    const n = Math.min(8, 2 + Math.floor(c.floor / 2));
    for (let i = 0; i < n; i++) {
      const t = take();
      if (!t) break;
      const m = zone.monsters[Math.floor(rng() * zone.monsters.length)]!;
      const f = feet(t);
      c.mobs.push({ id: mobId++, name: m.name, emoji: m.emoji, hp: Math.ceil(m.hp * (1 + depth * 0.15)), atk: Math.ceil(m.atk * (1 + depth * 0.1)), drop: m.drop,
        tile: t, px: f.x, py: f.y, next: 0.6 + rng(), cool: 0, hitUntil: 0, speed: m.hp <= 5 ? 0.45 : 0.75 });
    }
    updateHp();
  }

  function addLoot(id: ItemId) {
    combat!.loot[id] = (combat!.loot[id] ?? 0) + 1;
    const it = itemLabel(gdefs!, id);
    toasts.show(`+ ${it.emoji} ${it.name}`, 1200);
  }

  function attack(t: TilePos) {
    const c = combat!;
    const now = performance.now();
    if (now < c.swingUntil + 120) return;
    c.swingUntil = now + 180;
    const mob = c.mobs.find((m) => same(m.tile, t));
    if (mob) {
      mob.hp -= c.power;
      mob.hitUntil = now + 160;
      if (mob.hp <= 0) {
        c.mobs = c.mobs.filter((m) => m !== mob);
        c.kills++;
        if (mob.drop && rng() < 0.5) addLoot(mob.drop);
        if (!c.mobs.length && !c.ladder) revealLadder(mob.tile);
      }
      updateHp();
      return;
    }
    if (c.rocks.has(tkey(t))) {
      c.rocks.delete(tkey(t));
      const zone = mineZone(gdefs!, c.floor)!;
      const it = rngLoot(zone.loot);
      if (it && rng() < 0.7) addLoot(it);
      if (c.hiddenLadder === tkey(t)) revealLadder(t);
      updateHp();
    }
  }

  function rngLoot(entries: { item: ItemId; weight: number }[]): ItemId | null {
    const total = entries.reduce((n, e) => n + e.weight, 0);
    let r = rng() * total;
    for (const e of entries) {
      r -= e.weight;
      if (r < 0) return e.item;
    }
    return null;
  }

  function revealLadder(t: TilePos) {
    const c = combat!;
    if (c.ladder) return;
    if (c.floor >= c.maxFloor) return void toasts.show('再往下太危險了，先回地面休息吧', 3200);
    c.ladder = { ...t };
    toasts.show('🪜 發現往下的梯子！走過去就會下一層', 3200);
  }

  async function nextFloor() {
    const c = combat!;
    const next = c.floor + 1;
    const zone = mineZone(gdefs!, next);
    if (!zone) return;
    if ((view?.game?.equipment.pickaxe.power ?? 0) < zone.needPickaxe) {
      c.ladder = null;
      return void toasts.show(ERROR_TEXT.weak_pickaxe!);
    }
    c.floor = next;
    fade.classList.add('on');
    await wait(FADE_MS);
    placePlayer(map.spawns.default!.tile);
    if (!away()) placeAt(front(player.tile, 'down'), 'down');
    genFloor();
    fade.classList.remove('on');
    toasts.show(`⬇ ${next} 樓（${zone.name}）`);
  }

  function updateCombat(dt: number, now: number) {
    const c = combat;
    if (!c || c.ending || busy || panel.isShown) return;
    for (const m of c.mobs) {
      const f = feet(m.tile);
      m.px += (f.x - m.px) * Math.min(1, dt * 10);
      m.py += (f.y - m.py) * Math.min(1, dt * 10);
      m.cool -= dt;
      m.next -= dt;
      const dist = Math.abs(m.tile.x - player.tile.x) + Math.abs(m.tile.y - player.tile.y);
      if (dist === 1) {
        if (m.cool <= 0) {
          const dmg = Math.max(1, m.atk - c.armor);
          c.hp -= dmg;
          m.cool = 1.1;
          player.hurtUntil = now + 500;
          updateHp();
          if (c.hp <= 0) return void exitMine(true);
        }
        continue;
      }
      if (m.next > 0) continue;
      m.next = m.speed + rng() * 0.3;
      if (dist > 9) continue; // 太遠：還沒發現你
      const opts2 = (['left', 'right', 'up', 'down'] as Facing[]).map((d) => front(m.tile, d))
        .filter((t) => !playerBlocked(t) && !same(t, player.tile) && !(player.target && same(t, player.target)))
        .sort((a, b) => (Math.abs(a.x - player.tile.x) + Math.abs(a.y - player.tile.y)) - (Math.abs(b.x - player.tile.x) + Math.abs(b.y - player.tile.y)));
      const best = opts2[0];
      if (best && Math.abs(best.x - player.tile.x) + Math.abs(best.y - player.tile.y) < dist) m.tile = best;
    }
  }

  function drawCombat(now: number) {
    const c = combat;
    if (!c || sceneId !== 'mine') return;
    // V0.12：素材表有圖就畫圖（石頭、梯子、怪物），沒有照舊畫 emoji
    const sf = pack.sprites?.atlas ? pack.sprites.file : undefined;
    const rockFr = objectFrame(sf, 'mine_rock');
    for (const k of c.rocks) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      if (rockFr) spriteAt(rockFr, ox + x * TS + TS / 2, oy + y * TS + TS / 2, TS - 1, false, true);
      else emojiAt('🪨', ox + x * TS + TS / 2, oy + y * TS + TS / 2, TS - 3);
    }
    if (c.ladder) {
      const fr = objectFrame(sf, 'mine_ladder');
      if (fr) spriteAt(fr, ox + c.ladder.x * TS + TS / 2, oy + c.ladder.y * TS + TS / 2, TS);
      else emojiAt('🕳️', ox + c.ladder.x * TS + TS / 2, oy + c.ladder.y * TS + TS / 2, TS - 2);
    }
    for (const m of c.mobs) {
      const fr = monsterFrame(sf, m.name);
      const bob = fr ? Math.abs(Math.sin(now / 260 + m.id)) * 1.2 : 0;
      if (now < m.hitUntil) {
        ctx.fillStyle = 'rgba(255,80,80,0.55)';
        ctx.fillRect(ox + m.px - 8, oy + m.py - 16, 16, 15);
      }
      shadow(ox + m.px, oy + m.py - 2, 8);
      if (fr) spriteAt(fr, ox + m.px, oy + m.py - 8 - bob, 15, false, true);
      else emojiAt(m.emoji, ox + m.px, oy + m.py - 7, 12);
    }
  }

  function updateHp() {
    const c = combat;
    hpTag.hidden = !c;
    if (!c) return;
    const n = Object.values(c.loot).reduce((a, b) => a + b, 0);
    hpTag.textContent = `❤ ${Math.max(0, c.hp)}/${c.hpMax}｜${c.floor} 樓｜🎒 ${n} 件｜擊倒 ${c.kills}`;
    stage.dataset.combat = `${c.floor}|${c.hp}|${c.kills}|${n}|${c.mobs.length}|${c.rocks.size}|${c.ladder ? 1 : 0}`;
  }

  async function exitMine(died: boolean) {
    const c = combat;
    if (!c || c.ending) return;
    c.ending = true;
    held.clear();
    const res = await act({ type: 'mine_loot', floor: c.floor, items: c.loot, kills: c.kills, died, damage: c.hpMax - Math.max(0, c.hp) });
    combat = null;
    updateHp();
    delete stage.dataset.combat;
    if (died) toasts.show('😵 你倒下了……被她拖回地面。這趟的東西掉了一半，體力也用光了', 5200);
    await goto('town', 'fromMine');
    if (player.on) placePlayer(pet.tile);
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type === 'mine_returned') {
      toasts.show(`⛏️ 這趟打倒 ${c.kills} 隻`, 3200);
      showReport(res.event.report);
    }
  }

  // ───────────── 世界地圖（🗺️）與出口箭頭 ─────────────
  /** 正在前往的地方：她會一張一張地圖走過去；after = 到了之後要做的事 */
  let travel: { to: string; after?: () => void } | null = null;

  /** 從目前的場景走到 to，要經過哪些門（上鎖的門不走；礦洞只能從小鎮的洞口進去） */
  function routeTo(to: string): DoorDef[] | null {
    if (to === sceneId) return [];
    const prev = new Map<string, { from: string; door: DoorDef } | null>([[sceneId, null]]);
    const queue = [sceneId];
    while (queue.length) {
      const s = queue.shift()!;
      const m = s === sceneId ? map : pack.maps[s];
      for (const d of m?.doors ?? []) {
        if (!d.stand || !pack.maps[d.to] || prev.has(d.to) || isLocked(d.unlock) || d.to === 'mine') continue;
        prev.set(d.to, { from: s, door: d });
        if (d.to === to) {
          const path: DoorDef[] = [];
          for (let k = to; prev.get(k); k = prev.get(k)!.from) path.unshift(prev.get(k)!.door);
          return path;
        }
        queue.push(d.to);
      }
    }
    return null;
  }

  /** 往目的地再走一段；回傳有沒有動作 */
  function travelStep(): boolean {
    if (!travel) return false;
    if (travel.to === sceneId) {
      const after = travel.after;
      travel = null;
      delete stage.dataset.travel;
      if (!after) return false;
      // 到了：接著做原本要做的事（例如走去池塘）。回傳 true，這一輪就不要再照作息亂走
      after();
      return true;
    }
    const door = routeTo(travel.to)?.[0];
    if (!door) {
      toasts.show('過不去：路上有還沒解鎖的地方');
      travel = null;
      delete stage.dataset.travel;
      return false;
    }
    // 她不在、或主人自己走：直接換地圖
    if (away() || player.on) {
      void goto(door.to, door.spawn);
      return true;
    }
    return walkTo(door.stand!, { kind: 'door', door });
  }

  /** 換完地圖之後，繼續往目的地走 */
  function continueTravel() {
    if (!travel) return;
    if (away() || player.on) setTimeout(() => void (!busy && travelStep()), 350);
    else pet.idleUntil = Math.min(pet.idleUntil, performance.now() + 400);
  }

  function travelTo(to: string, after?: () => void) {
    panel.close();
    if (to === sceneId) return after?.();
    if (!routeTo(to)) return void toasts.show('過不去：路上有還沒解鎖的地方');
    travel = { to, after };
    stage.dataset.travel = to;
    dialog.close();
    const name = world.scenes.find((s) => s.id === to)?.name ?? to;
    toasts.show(`🗺️ 出發去${name}`);
    if (!away() && !player.on) Object.assign(pet, { path: [], goal: null, walking: false });
    travelStep();
  }

  // V0.12：地圖有兩種模式：走過去（她一張一張地圖走）、一鍵傳送（黑幕一下就到）
  let mapMode: 'walk' | 'teleport' = 'walk';
  function toggleWorldMap(mode: 'walk' | 'teleport' = mapMode) {
    if (panel.kind === 'worldmap' && mode === mapMode) return panel.close();
    mapMode = mode;
    showPanel('worldmap', renderWorldMap);
    hud?.setOpen(hudKind('worldmap'));
  }

  /** V0.12：一鍵傳送。只能去已經解鎖、走得到的地方（不會跳過解鎖進度）；礦洞 = 傳送到小鎮再打開下礦的視窗 */
  async function teleportTo(id: string) {
    if (combat) return void toasts.show('在礦洞裡打怪時不能傳送：先回到地面');
    if (fishing) return void toasts.show('她正在釣魚，等她釣完再走吧');
    if (busy) return;
    const target = id === 'mine' ? 'town' : id;
    if (target !== sceneId && !routeTo(target)) return void toasts.show('還去不了：路上有還沒解鎖的地方');
    panel.close();
    travel = null;
    delete stage.dataset.travel;
    dialog.close();
    Object.assign(pet, { path: [], goal: null, walking: false });
    pendingScene = null; // 作息排好的去處先取消：主人剛把她送過去
    const name = world.scenes.find((x) => x.id === id)?.name ?? id;
    if (target !== sceneId) {
      toasts.show(`🌀 咻——傳送到${name}！`);
      await goto(target);
    }
    stage.dataset.teleported = target;
    if (id === 'mine') openMine();
  }

  function renderWorldMap() {
    const edges: { a: string; b: string; locked: boolean; label?: string }[] = [];
    const seen = new Set<string>();
    for (const s of world.scenes) {
      const m = pack.maps[s.id];
      for (const d of m?.doors ?? []) {
        const k = [s.id, d.to].sort().join('|');
        if (!pack.maps[d.to] || seen.has(k) || d.to === 'mine' || s.id === 'mine') continue;
        seen.add(k);
        edges.push({ a: s.id, b: d.to, locked: isLocked(d.unlock), label: d.unlock ? gdefs?.file.unlocks?.[d.unlock]?.name : undefined });
      }
      if (m?.interactables.some((it) => it.kind === 'mine') && pack.maps.mine) edges.push({ a: s.id, b: 'mine', locked: false });
    }
    const nodes = world.scenes.filter((s) => s.mapPos).map((s) => {
      const lockedBy = edges.find((e) => (e.a === s.id || e.b === s.id) && e.locked)?.label;
      return {
        id: s.id,
        name: s.name,
        icon: s.icon ?? '📍',
        x: s.mapPos!.x,
        y: s.mapPos!.y,
        here: s.id === sceneId,
        reachable: s.id === 'mine' ? !!routeTo('town') : !!routeTo(s.id),
        hint: s.id === 'mine' ? '從小鎮右上的洞口進去' : lockedBy && !routeTo(s.id) ? `要先解鎖「${lockedBy}」` : undefined,
      };
    });
    openPanel('worldmap', mapMode === 'teleport' ? '🌀 一鍵傳送' : '🗺️ 地圖', buildWorldMap(doc, {
      nodes,
      edges,
      herName: ch.name,
      herAway: away(),
      mode: mapMode,
      onMode: (m) => toggleWorldMap(m),
      onGo: (id) => {
        if (mapMode === 'teleport') return void teleportTo(id);
        if (id === 'mine') {
          const it = pack.maps.town?.interactables.find((x) => x.kind === 'mine');
          return travelTo('town', () => (it ? approach(map.interactables.find((x) => x.kind === 'mine') ?? it) : openMine()));
        }
        travelTo(id);
      },
    }));
  }

  /** 地圖邊緣的出口：畫一個會輕輕往外跳的箭頭 */
  function drawExits(now: number) {
    const bob = Math.round((Math.sin(now / 260) + 1) * 1);
    for (const d of map.doors) {
      const r = d.rect;
      const dir: Facing | null = r.x === 0 ? 'left' : r.x + r.w === map.width ? 'right' : r.y === 0 ? 'up' : r.y + r.h === map.height ? 'down' : null;
      if (!dir) continue;
      const v = DIRS_V[dir];
      const cx = ox + Math.round((r.x + r.w / 2) * TS) + v.x * bob;
      const cy = oy + Math.round((r.y + r.h / 2) * TS) + v.y * bob;
      const pts: [number, number][] = [];
      for (let i = 0; i < 4; i++) for (let j = -(3 - i); j <= 3 - i; j++) pts.push([i - 1, j]);
      const rot = ([x, y]: [number, number]): [number, number] => (dir === 'right' ? [x, y] : dir === 'left' ? [-x, y] : dir === 'down' ? [y, x] : [y, -x]);
      ctx.fillStyle = isLocked(d.unlock) ? '#6b5a66' : '#3b2433';
      for (const p of pts) {
        const [a, b] = rot(p);
        ctx.fillRect(cx + a - 1, cy + b - 1, 3, 3);
      }
      ctx.fillStyle = isLocked(d.unlock) ? '#c9bcc4' : '#fff3d6';
      for (const p of pts) {
        const [a, b] = rot(p);
        ctx.fillRect(cx + a, cy + b, 1, 1);
      }
    }
  }

  // ───────────── V0.5：引導任務（頭頂氣泡、當前任務、指引箭頭、催促） ─────────────
  const bubble = Object.assign(doc.createElement('div'), { className: 'px-bubble' });
  bubble.setAttribute('role', 'status');
  bubble.hidden = true;
  const questBox = Object.assign(doc.createElement('button'), { className: 'px-quest', type: 'button' });
  questBox.hidden = true;
  // V0.8：等 AI 時頭上的「思考中…」（跟對話氣泡分開，才不會打亂排隊中的句子）
  const thinkEl = Object.assign(doc.createElement('div'), { className: 'px-bubble px-think' });
  thinkEl.setAttribute('role', 'status');
  thinkEl.setAttribute('aria-label', '思考中');
  thinkEl.hidden = true;
  // V0.20：「思考中」＋三個跳動的小點（等 AI 回話的 1～10 秒，讓玩家知道沒有當機）
  const thinkDots = Object.assign(doc.createElement('span'), { className: 'px-think-dots' });
  thinkDots.append(doc.createElement('i'), doc.createElement('i'), doc.createElement('i'));
  thinkEl.append(Object.assign(doc.createElement('span'), { className: 'px-think-label', textContent: '思考中' }), thinkDots);
  stage.append(bubble, thinkEl);
  modeHost.before(questBox); // 任務框在側邊欄：狀態列、按鈕下面
  let bubbleQueue: string[] = [];
  let bubbleUntil = 0;
  let questKey = '';
  let nagAt = Infinity;
  let nagIdx = 0;
  const LOG_KEY = 'whale-pet:quest-log-seen';
  let logSeen = (() => {
    try {
      return Number(localStorage.getItem(LOG_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  })();
  const nagMs = () => (view?.game?.quest?.nagEverySec ?? 60) * 1000;

  /** 她頭頂冒出的對話氣泡：一句一句輪流說，不會擋住操作 */
  function speak(lines: string[], front = false) {
    if (!lines.length) return;
    bubbleQueue = front ? [...lines, ...bubbleQueue] : [...bubbleQueue, ...lines];
    if (bubble.hidden || front) nextBubble();
    nagAt = performance.now() + nagMs();
  }
  function nextBubble() {
    if (!thinkEl.hidden) return; // 正在想：等想完再說
    const t = bubbleQueue.shift();
    if (!t) {
      bubble.hidden = true;
      delete stage.dataset.bubble;
      return;
    }
    bubble.textContent = t;
    bubble.hidden = false;
    stage.dataset.bubble = t;
    bubbleUntil = performance.now() + 2200 + t.length * 110;
  }
  // 氣泡不擋點擊（pointer-events: none）：點她身後的田、門照樣有效；時間到自己換下一句

  function showThinking(on: boolean) {
    thinkEl.hidden = !on;
    if (on) bubble.hidden = true; // 想的時候先收起排隊的句子，想完再繼續
    else if (bubbleQueue.length) nextBubble();
    if (on) stage.dataset.thinking = '1';
    else delete stage.dataset.thinking;
  }
  /** 把氣泡放在她頭頂 */
  function placeOverHead(el: HTMLElement) {
    const cr = canvas.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const headY = pet.py - ch.world.footY * (ch.world.drawScale ?? 1) * actorScale - 4;
    el.style.left = `${cr.left - sr.left + ((ox + pet.px) / VW) * cr.width}px`;
    el.style.top = `${cr.top - sr.top + ((oy + headY) / VH) * cr.height}px`;
  }

  /** 每一幀：氣泡跟著她的頭、時間到換下一句；太久沒進度就催一下 */
  function updateGuide(now: number) {
    updatePlay(now); // V0.11
    checkAfk(now);
    updateTavern(now); // V0.13
    const q = view?.game?.quest;
    const blocked = dialog.open || busy || away() || !!stage.dataset.goddess;
    if (!thinkEl.hidden) placeOverHead(thinkEl);
    if (!bubble.hidden) {
      bubble.style.visibility = blocked ? 'hidden' : 'visible';
      if (!blocked) {
        placeOverHead(bubble);
        if (now > bubbleUntil) nextBubble();
      } else bubbleUntil = Math.max(bubbleUntil, now + 600);
    }
    if (q && now > nagAt && bubble.hidden && thinkEl.hidden && !blocked && !panel.isShown && !fishing && !decorMode) {
      const lines = q.nag.length ? q.nag : q.say;
      speak([lines[nagIdx++ % lines.length]!]);
    }
  }

  /** 狀態更新時：完成了哪一步、換到哪一步 */
  /** V0.7：數值剛掉到 30% 以下（或歸零）時，她會說一句；之後每 3 分鐘最多提醒一次 */
  let statSeen: { stamina: boolean; satiety: boolean; starving: boolean } | null = null;
  let statSaidAt = 0;
  function onStatView(st: NonNullable<PetView['game']>['stats']) {
    const L = gdefs?.file.stats?.lines;
    const prev = statSeen;
    statSeen = { stamina: st.low.stamina, satiety: st.low.satiety, starving: st.starving };
    stage.dataset.low = [st.low.stamina && 'stamina', st.low.satiety && 'satiety', st.starving && 'starving'].filter(Boolean).join(' ');
    if (!L || away()) return;
    const now = performance.now();
    const fresh = (k: 'stamina' | 'satiety' | 'starving') => statSeen![k] && !(prev?.[k] ?? false);
    const due = now - statSaidAt > 180_000 && prev !== null;
    let line: string | null = null;
    if (fresh('starving') || (st.starving && due)) line = pick(L.starving);
    else if (fresh('satiety') || (st.low.satiety && due)) line = pick(L.hungry);
    else if (fresh('stamina') || (st.low.stamina && due)) line = pick(L.tired);
    if (!line) return;
    statSaidAt = now;
    speak([line]);
  }

  function onQuestView(v: PetView) {
    const g = v.game;
    if (!g) return;
    const last = g.questLast;
    if (last && last.at > logSeen) {
      logSeen = last.at;
      try {
        localStorage.setItem(LOG_KEY, String(logSeen));
      } catch {
        // 存不了：最多重複提示一次
      }
      const reward = Object.entries(last.reward).map(([id, n]) => `${itemLabel(gdefs!, id).emoji}×${n}`).join(' ');
      toasts.show(`✅ 完成：${last.task}${reward ? `　獎勵 ${reward}` : ''}`, 3600);
      if (last.chainDone) {
        const chain = gdefs?.file.quests?.chains.find((c) => c.id === last.chain);
        if (chain?.doneSay) speak(chain.doneSay);
      }
    }
    const q = g.quest;
    const key = q ? `${q.chain}/${q.stepId}` : 'done';
    if (key !== questKey) {
      if (questKey && q) speak(q.say);
      questKey = key;
      nagIdx = 0;
      nagAt = performance.now() + nagMs();
    }
    questBox.hidden = !q;
    if (q) {
      questBox.textContent = `📌 ${q.task}${q.need > 1 ? `（${q.progress}/${q.need}）` : ''}`;
      questBox.title = `${q.chainName} ${q.step + 1}/${q.total}｜點一下：她會走過去`;
      stage.dataset.quest = `${q.chain}:${q.step}`;
    } else delete stage.dataset.quest;
  }

  // ───────────── V0.18：她的小願望 ─────────────
  // 每天早上 host 抽一個願望（wishes.json）。畫面：側邊欄任務下面顯示、她第一次看到會說出來、實現時慶祝。
  const wishBox = Object.assign(doc.createElement('button'), { className: 'px-wish', type: 'button' });
  wishBox.hidden = true;
  questBox.after(wishBox);
  let wishSeen: { key: string; done: boolean } | null = null;
  const WISH_SAID = 'whale-pet:wish-said';
  function onWishView(g: NonNullable<PetView['game']>) {
    const w = g.wish;
    wishBox.hidden = !w;
    if (!w) {
      delete stage.dataset.wish;
      return;
    }
    const key = `${w.day}:${w.id}`;
    wishBox.classList.toggle('done', w.done);
    wishBox.replaceChildren(
      Object.assign(doc.createElement('span'), { className: 'px-wish-label', textContent: '💭 她的小願望' }),
      Object.assign(doc.createElement('span'), {
        className: 'px-wish-text',
        textContent: `${w.emoji} ${w.text}${w.need > 1 && !w.done ? `（${w.progress}/${w.need}）` : ''}`,
      }),
      Object.assign(doc.createElement('span'), { className: 'px-wish-reward', textContent: w.done ? '✅ 實現了！' : `❤ +${w.affection}` }),
    );
    wishBox.title = w.done ? '今天的願望實現了' : `怎麼做：${w.hint}（點一下她會再說一次）`;
    stage.dataset.wish = `${w.id}:${w.done ? 'done' : `${w.progress}/${w.need}`}`;
    const W = gdefs?.file.wishes;
    // 實現了：慶祝（只在畫面開著、看著它完成時）
    if (wishSeen?.key === key && !wishSeen.done && w.done) {
      toasts.show(`💭 願望實現了：${w.text}　❤ +${w.affection}`, 4200);
      burstHearts(14);
      if (W && !away()) speak([pick(W.lines.done)], true);
    }
    // 新的願望：她說出來（每個願望只說一次，重開畫面不會一直說）
    if (!w.done && wishSeen?.key !== key && W) {
      let said = '';
      try {
        said = localStorage.getItem(WISH_SAID) ?? '';
      } catch {
        // 讀不到就每次打開說一次
      }
      if (said !== key) {
        try {
          localStorage.setItem(WISH_SAID, key);
        } catch {
          // 存不了：最多重複說
        }
        setTimeout(() => {
          if (!away()) speak([pick(W.lines.new).replace('{wish}', w.text)]);
        }, wishSeen ? 600 : 3200);
      }
    }
    wishSeen = { key, done: w.done };
  }
  wishBox.addEventListener('click', (e) => {
    e.stopPropagation();
    const w = view?.game?.wish;
    if (!w || away()) return;
    speak([w.done ? '今天的願望已經實現了，謝謝主人～' : `${w.text}　（${w.hint}）`], true);
  });

  // ───────────── V0.18：摸摸頭 ─────────────
  // 1.5 秒內在她身上點 3 下：被摸頭（台詞池＋愛心粒子＋每天前幾次加好感）。單點還是說話，但會等一下，確定不是在連點。
  let taps: number[] = [];
  let talkTimer = 0;
  let headpatAt = 0;
  /** 記一下點擊；湊滿就回傳 true（摸頭） */
  function countTap(): boolean {
    const hp = gdefs?.file.leisure?.headpat;
    if (!hp) return false;
    const t = performance.now();
    taps = [...taps.filter((x) => t - x <= hp.windowMs), t];
    if (taps.length < hp.clicks || t - headpatAt < 800) return false;
    taps = [];
    return true;
  }
  /** 點到她：先等一下（可能還要連點），沒有再點就說話 */
  function petTapped() {
    clearTimeout(talkTimer);
    if (!gdefs?.file.leisure?.headpat) return talk();
    talkTimer = window.setTimeout(() => {
      taps = [];
      talk();
    }, 380);
  }
  async function headpat() {
    const hp = gdefs?.file.leisure?.headpat;
    if (!hp || busy || away()) return;
    clearTimeout(talkTimer);
    headpatAt = performance.now();
    dialog.close();
    Object.assign(pet, { path: [], goal: null, walking: false, face: 'down' as Facing });
    burstHearts(10);
    showLine(pick(hp.lines), 'happy');
    stage.dataset.headpat = String(Number(stage.dataset.headpat ?? 0) + 1);
    const res = await act({ type: 'headpat' });
    if (!res?.ok || res.event.type !== 'headpat') return;
    if (res.event.gain > 0) toasts.show(`🤚 摸摸頭：❤ +${res.event.gain}${res.event.left ? `（今天還能加 ${res.event.left} 次）` : ''}`);
    if (res.event.levelUp) toasts.show(`💖 ${ch.name}對你的感覺變成「${res.event.levelUp}」了`, 3600);
  }

  // 愛心粒子：像素小愛心，從她頭上冒出來往上飄、慢慢變透明
  const HEART = ['.x.x.', 'xxxxx', '.xxx.', '..x..'];
  let hearts: { x: number; y: number; vx: number; vy: number; age: number; life: number; color: string }[] = [];
  function burstHearts(n: number) {
    const head = Math.round(ch.world.footY * (ch.world.drawScale ?? 1) * actorScale);
    for (let i = 0; i < n; i++) {
      hearts.push({
        x: pet.px + (Math.random() - 0.5) * 10,
        y: pet.py - head * (0.7 + Math.random() * 0.3),
        vx: (Math.random() - 0.5) * 22,
        vy: -14 - Math.random() * 16,
        age: -i * 0.05,
        life: 1.1 + Math.random() * 0.6,
        color: ['#ff5d8f', '#ff86a8', '#ff3d6e', '#ffb3c8'][i % 4]!,
      });
    }
  }
  let heartsT = 0;
  function drawHearts(now: number) {
    const dt = heartsT ? Math.min(0.1, (now - heartsT) / 1000) : 0;
    heartsT = now;
    if (!hearts.length) return;
    ctx.save();
    for (const h of hearts) {
      h.age += dt;
      if (h.age < 0) continue;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.vx *= 0.96;
      h.vy *= 0.985;
      const t = h.age / h.life;
      ctx.globalAlpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
      ctx.fillStyle = h.color;
      const x0 = Math.round(ox + h.x - 2);
      const y0 = Math.round(oy + h.y - 2);
      HEART.forEach((row, ry) => [...row].forEach((c, rx) => c === 'x' && ctx.fillRect(x0 + rx, y0 + ry, 1, 1)));
    }
    ctx.restore();
    hearts = hearts.filter((h) => h.age < h.life);
  }

  // ───────────── V0.18：季節粒子 ─────────────
  // 季節粒子＋天氣粒子（V0.19 雪天的雪）放在同一個系統：一次只畫一種
  const fxDefs = {
    ...(world.ambient?.seasons ?? {}),
    ...Object.fromEntries(Object.entries(world.ambient?.weather ?? {}).map(([k, v]) => [`weather:${k}`, v])),
  };
  const seasonFx = Object.keys(fxDefs).length ? new SeasonFx(fxDefs) : null;
  let seasonT = 0;
  function drawSeason(now: number, layer: 'normal' | 'glow') {
    if (!seasonFx || !map) return;
    if (layer === 'normal') {
      const g = view?.game;
      // 天氣有自己的粒子（雪天）就用天氣的；在下雨就什麼都不飄；不然用季節的
      const weatherKey = g ? `weather:${g.weather.id}` : '';
      seasonFx.set(fxDefs[weatherKey] ? weatherKey : g?.season?.id ?? null, {
        outdoor: outdoor.has(sceneId),
        night: view?.phase === 'night' || view?.phase === 'evening',
        rain: !fxDefs[weatherKey] && !!g?.weather.particles,
      });
      const dt = seasonT ? Math.min(0.1, (now - seasonT) / 1000) : 0;
      seasonT = now;
      seasonFx.update(dt, map.width * TS, map.height * TS);
      stage.dataset.seasonFx = `${seasonFx.kind ?? 'none'}:${seasonFx.size}`;
    }
    seasonFx.draw(ctx, ox, oy, layer);
  }

  // ───────────── V0.18：現實時間聯動（太晚了提醒主人去睡覺） ─────────────
  const LATE_KEY = 'whale-pet:late-night';
  function checkLateNight() {
    const def = world.ambient?.lateNight;
    if (!def || disposed) return;
    if (busy || dialog.open || panel.isOpen || away()) return; // 等一下再說，不打斷主人
    let prev = null;
    try {
      prev = parseLateNight(localStorage.getItem(LATE_KEY));
    } catch {
      // 讀不到：當作沒提醒過
    }
    const next = lateNightDue(new Date(), def, prev); // 玩家電腦的時鐘，不是遊戲時間
    if (!next) return;
    try {
      localStorage.setItem(LATE_KEY, JSON.stringify(next));
    } catch {
      // 存不了：最多多提醒幾次
    }
    stage.dataset.lateNight = String(next.count);
    Object.assign(pet, { path: [], goal: null, walking: false, face: 'down' as Facing });
    showLine(pick(def.lines), 'sleepy');
  }
  const lateTimer = window.setInterval(checkLateNight, 30_000);
  window.setTimeout(checkLateNight, 6000);

  /** 打開畫面時：重說一次目前的任務，玩家關掉再回來也知道要幹嘛 */
  function introQuest() {
    const q = view?.game?.quest;
    if (q) speak(q.say);
  }

  questBox.addEventListener('click', (e) => {
    e.stopPropagation();
    const q = view?.game?.quest;
    if (!q?.target) return;
    const t = q.target;
    const go = () => {
      const it = t.object ? map.interactables.find((x) => x.id === t.object) : undefined;
      if (it) approach(it);
    };
    if (t.scene === sceneId) go();
    else travelTo(t.scene, go);
  });

  /** 任務指的地方：同一張地圖 → 目標頭上的金色箭頭；別的地圖 → 往那裡走的出口上 */
  function drawGuide(now: number) {
    const t = view?.game?.quest?.target;
    if (!t || busy) return;
    const bob = Math.round((Math.sin(now / 200) + 1) * 1.5);
    if (t.scene === sceneId) {
      if (!t.object) return;
      const it = map.interactables.find((x) => x.id === t.object);
      const door = map.doors.find((x) => x.id === t.object);
      const spot = map.spots[t.object];
      const r = it?.rect ?? door?.rect ?? (spot ? { x: spot.tile.x, y: spot.tile.y, w: 1, h: 1 } : null);
      if (!r) return;
      const lift = it?.kind === 'npc' ? 2.4 * TS : 0; // 居民的頭比較高
      bigArrow(ox + (r.x + r.w / 2) * TS, oy + r.y * TS - 4 - bob - lift, 'down');
      return;
    }
    const door = routeTo(t.scene)?.[0];
    if (!door) return;
    const r = door.rect;
    const dir: Facing | null = r.x === 0 ? 'left' : r.x + r.w === map.width ? 'right' : r.y === 0 ? 'up' : r.y + r.h === map.height ? 'down' : null;
    if (dir) {
      const v = DIRS_V[dir];
      const cx = ox + (r.x + r.w / 2) * TS - v.x * (TS * 0.9) + v.x * bob;
      const cy = oy + (r.y + r.h / 2) * TS - v.y * (TS * 0.9) + v.y * bob;
      bigArrow(cx, cy, dir);
    } else bigArrow(ox + (r.x + r.w / 2) * TS, oy + r.y * TS - 2 - bob, 'down');
  }

  /** 金色、有黑邊的大箭頭 */
  function bigArrow(cx: number, cy: number, dir: Facing) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 6; i++) for (let j = -(5 - i); j <= 5 - i; j++) pts.push([i, j]);
    for (let i = -5; i < 0; i++) for (let j = -1; j <= 1; j++) pts.push([i, j]);
    const rot = ([x, y]: [number, number]): [number, number] => (dir === 'right' ? [x, y] : dir === 'left' ? [-x, y] : dir === 'down' ? [y, x] : [y, -x]);
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    ctx.fillStyle = '#3b2433';
    for (const p of pts) {
      const [a, b] = rot(p);
      ctx.fillRect(x0 + a - 1, y0 + b - 1, 3, 3);
    }
    ctx.fillStyle = '#ffd25e';
    for (const p of pts) {
      const [a, b] = rot(p);
      ctx.fillRect(x0 + a, y0 + b, 1, 1);
    }
  }

  // ───────────── V0.5：居民的圖（靜態圖＋呼吸、搖擺的微動） ─────────────
  const npcImgs = new Map<string, HTMLImageElement>();
  const imgOf = (path?: string) => {
    if (!path) return undefined;
    let img = npcImgs.get(path);
    if (!img) {
      try {
        img = new Image();
        img.src = pack.asset(path);
        npcImgs.set(path, img);
      } catch {
        return undefined; // 打包時沒放進來：退回 emoji
      }
    }
    return img.complete && img.naturalWidth ? img : undefined;
  };
  const hops = new Map<string, number>();
  const NPC_SCALE = 1 / 3; // 圖存成 3 倍大，跟鯨魚娘一樣

  function drawNpcSprite(it: Interactable, img: HTMLImageElement, now: number) {
    const seed = [...it.id].reduce((n, c) => n + c.charCodeAt(0), 0);
    const t = now / 1000;
    const breath = Math.sin(t * 2.2 + seed);
    const sway = Math.sin(t * 0.8 + seed * 0.7) * 0.022; // 約 ±1.3°
    const hopEnd = hops.get(it.id) ?? 0;
    const hop = hopEnd > now ? Math.sin((1 - (hopEnd - now) / 420) * Math.PI) * 3 : 0;
    const w = img.naturalWidth * NPC_SCALE * actorScale;
    const h = img.naturalHeight * NPC_SCALE * actorScale;
    const { x: fx, y: fy } = npcFoot(it);
    const hide = it.seat?.hideBelow;
    if (hide === undefined) shadow(fx, fy - 1, Math.round(w * 0.55));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (hide !== undefined) {
      // V0.13：站在吧台後面：這條線以下不畫（腳被吧台擋住）
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, Math.round((oy + hide) * scale));
      ctx.clip();
    }
    ctx.translate(Math.round(fx * scale), Math.round((fy - hop) * scale));
    ctx.rotate(sway);
    ctx.scale(1 - 0.012 * breath, 1 + 0.022 * breath); // 吸氣變高一點、變瘦一點
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (-w / 2) * scale, -h * scale, w * scale, h * scale);
    ctx.restore();
  }

  /** 居民的腳在畫面上的位置：酒館裡用 seat（原圖量的位置），其他地圖用格子 */
  function npcFoot(it: Interactable): { x: number; y: number } {
    if (it.seat) return { x: ox + it.seat.x, y: oy + it.seat.y };
    return { x: ox + (it.rect.x + 0.5) * TS, y: oy + (it.rect.y + 1) * TS - 1 };
  }

  /** 居民的圖比一格高：點頭也算點到 */
  function npcAt(tx: number, ty: number): Interactable | undefined {
    return map.interactables.find((it) => it.kind === 'npc' && tx === it.rect.x && ty <= it.rect.y && ty >= it.rect.y - 2
      && !!imgOf(gdefs?.file.npcs?.[it.npc!]?.sprite));
  }

  // ───────────── V0.6：寵物 ─────────────
  const petLayer = gdefs?.file.pets ? createPetLayer({
    ctx, TS, rng,
    map: () => map,
    sceneId: () => sceneId,
    day: () => dayKey(view?.now ?? Date.now()),
    origin: () => ({ ox, oy, scale }),
    game: () => view?.game ?? null,
    defs: () => gdefs,
    leader: () => (player.on ? { tile: player.tile, walking: !!player.target } : away() ? null : { tile: pet.tile, walking: pet.walking }),
    img: (path) => imgOf(path),
    emojiAt, shadow, itemAt,
    dogPickup: (spot, petId) => void forage(spot.scene, spot.slot, petId),
  }) : null;
  let lastPlayerTile: TilePos = { x: -1, y: -1 };
  const assetUrl = (path: string) => {
    try {
      return pack.asset(path);
    } catch {
      return undefined;
    }
  };
  const sceneName = (id: string) => world.scenes.find((x) => x.id === id)?.name ?? id;

  /** 她（或主人）走到掉落物那一格：撿起來 */
  const foraging = new Set<string>();
  function checkForage(tile: TilePos) {
    const spot = petLayer?.forageAt(tile);
    if (spot) void forage(spot.scene, spot.slot);
  }
  async function forage(scene: string, slot: number, by?: number) {
    const key = `${scene}:${slot}`;
    if (foraging.has(key) || scene !== sceneId) return;
    foraging.add(key);
    try {
      const res = await act({ type: 'forage', scene, slot, ...(by !== undefined ? { by } : {}) });
      if (!res?.ok || res.event.type !== 'foraged') return;
      const it = itemLabel(gdefs!, res.event.item);
      const who = by !== undefined ? view?.game?.pets.find((p) => p.id === by) : undefined;
      toasts.show(who ? `${who.emoji} ${who.name}撿回來 ${it.emoji} ${it.name}！` : `撿到了 ${it.emoji} ${it.name}`);
      if (who) petLayer?.hop(who.id, '✨');
      else if (!away()) showEmote('note');
    } finally {
      foraging.delete(key);
    }
  }

  /** 點自己的寵物：今天還沒摸就摸摸，摸過了就打開寵物面板 */
  async function petClick(id: number) {
    const p = view?.game?.pets.find((x) => x.id === id);
    if (!p) return;
    if (p.pettedToday) {
      petLayer?.hop(id, '❤');
      return void showPanel('pets', renderPets);
    }
    const res = await act({ type: 'pet_pet', pet: id });
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    petLayer?.hop(id, '❤');
    toasts.show(`🤚 摸摸 ${p.name}：好感 +${gdefs!.file.pets!.affection.petGain} ❤`);
  }

  function togglePets() {
    if (panel.kind === 'pets') panel.close();
    else showPanel('pets', renderPets);
  }
  function renderPets() {
    if (!gdefs?.file.pets || !view?.game) return;
    const content = buildPets(doc, {
      game: view.game, defs: gdefs, src: assetUrl, sceneName,
      onPet: (id) => void petClick(id),
      onFeed: (id, item) => void petAct({ type: 'feed_pet', pet: id, item }),
      onCompanion: (id) => void petAct({ type: 'set_companion', pet: id }),
      onRelease: (id) => void petAct({ type: 'release_pet', pet: id }),
    });
    // V0.22：送養（領養碼）、領養（在朋友家不行）
    const soc = view.game.social;
    if (soc && !visiting) {
      content.append(buildAdoption(doc, {
        pets: view.game.pets.map((p) => ({ id: p.id, name: p.name, emoji: gdefs!.file.pets?.species[p.kind]?.emoji ?? '🐾' })),
        readyAt: soc.adoptReadyAt, now: view.now, lastCode: lastAdoptCode?.code ?? null, lastName: lastAdoptCode?.name ?? '',
        onGive: (id) => void socialAct({ type: 'pet_adopt_out', pet: id }),
        onAdopt: (code) => void socialAct({ type: 'pet_adopt_in', code }),
      }));
    }
    openPanel('pets', '🐾 我的寵物', content);
  }
  async function petAct(a: GameAction) {
    const res = await act(a);
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    const e = res.event;
    const name = (id: number) => view?.game?.pets.find((p) => p.id === id)?.name ?? '';
    if (e.type === 'pet_fed') {
      const it = itemLabel(gdefs!, e.item);
      toasts.show(`${it.emoji} ${name(e.pet)}吃得好開心：飽食度 ${Math.round(e.satiety)}`);
      petLayer?.hop(e.pet, '❤');
    } else if (e.type === 'companion_set') {
      toasts.show(e.pet === null ? '大家都回家閒逛了' : `⭐ ${name(e.pet)}會跟著她走了`);
    } else if (e.type === 'pet_released') {
      toasts.show(`👋 ${e.name}回到大自然了`);
    } else if (e.type === 'pet_bought') {
      toasts.show(`🎉 ${e.name}來到家裡了！在 🐾 寵物裡照顧牠`, 3600);
      speak([`${e.name}！以後我們就是一家人了～`], true);
    }
  }

  // 寵物店（小葵兼任）：上面是寵物，下面是飼料、捕捉網
  function openPetShop(id: string) {
    openShopId = id;
    showPanel('shop', renderPetShop, () => (openShopId = null));
  }
  function renderPetShop() {
    const shop = openShopId ? gdefs?.file.shops[openShopId] : undefined;
    if (!shop || !gdefs || !view?.game) return;
    const trades = buildShop(doc, {
      shop, defs: gdefs, inventory: view.game.inventory, season: view.game.season?.id, festival: view.game.festival?.id,
      shopId: openShopId!, bought: view.game.shopToday,
      onTrade: (t) => void trade(t),
    });
    openPanel('shop', `${shop.emoji} ${shop.name}`, buildPetShop(doc, {
      game: view.game, defs: gdefs, src: assetUrl, trades, onBuy: (kind) => void petAct({ type: 'buy_pet', kind }),
    }));
  }

  // 野生寵物：選網子 → 丟出去（網子晃一晃）→ host 判定
  let catchId: string | null = null;
  function openCatch(id: string) {
    catchId = id;
    showPanel('catch', renderCatch, () => (catchId = null));
  }
  function renderCatch() {
    const spawn = view?.game?.wild.find((w) => w.id === catchId);
    if (!spawn || !gdefs) return void panel.close();
    const sp = gdefs.file.pets!.species[spawn.kind]!;
    openPanel('catch', `✨ 野生的${sp.name}`, buildCatch(doc, {
      spawn, defs: gdefs, game: view!.game!, src: assetUrl, now: view!.now,
      chance: (net) => catchChance(spawn.kind, net, gdefs),
      onThrow: (net) => void throwNet(spawn.id, net),
    }));
  }
  let throwingNet = false;
  async function throwNet(id: string, net: ItemId) {
    if (throwingNet) return;
    throwingNet = true;
    try {
      panel.close();
      petLayer?.throwNet(id);
      if (!away()) {
        const t = petLayer?.wildTile(id);
        if (t) stop(faceToward(pet.tile, { x: t.x, y: t.y, w: 1, h: 1 }));
      }
      await wait(1100);
      const res = await act({ type: 'catch_pet', scene: sceneId, spawn: id, net });
      if (!res) return;
      if (!res.ok) return sayError(res.error);
      const e = res.event;
      if (e.type === 'pet_caught') {
        toasts.show(`🎉 抓到了${e.name}！（成功率 ${Math.round(e.chance * 100)}%）`, 3600);
        speak([`好可愛！${e.name}，以後就跟我們住在一起吧～`], true);
        if (!away()) showEmote('heart');
      } else if (e.type === 'pet_escaped') {
        const sp = gdefs!.file.pets!.species[e.kind];
        if (e.fled) {
          toasts.show(`💨 ${sp?.name ?? ''}跑掉了……`);
          if (!away()) showEmote('dots');
        } else {
          toasts.show(`差一點！${sp?.name ?? ''}還在，要再丟一次嗎？`);
          openCatch(id);
        }
      }
    } finally {
      throwingNet = false;
    }
  }

  /** 每天第一次看到早上的農場事件：一則提示 */
  const REPORT_KEY = 'whale-pet:farm-report-seen';
  function showFarmReport(r: NonNullable<NonNullable<PetView['game']>['farmReport']>) {
    let seen = '';
    try {
      seen = localStorage.getItem(REPORT_KEY) ?? '';
    } catch {
      // 存不了：每次打開都提示也沒關係
    }
    const sig = `${r.day}:${r.pecked.length}:${r.scared}:${r.watered}:${Object.values(r.picked).reduce((a, b) => a + b, 0)}`;
    if (seen === sig) return;
    const bits: string[] = [];
    if (r.watered) bits.push(`💧 寵物幫忙澆了 ${r.watered} 塊田`);
    const picked = Object.entries(r.picked).map(([id, n]) => `${itemLabel(gdefs!, id).emoji}×${n}`).join(' ');
    if (picked) bits.push(`🦴 狗狗撿回來 ${picked}`);
    if (r.scared) bits.push(`🐈 貓咪趕走了 ${r.scared} 隻烏鴉`);
    if (r.pecked.length) bits.push(`🐦‍⬛ 烏鴉啄了 ${r.pecked.length} 塊田（作物倒退了一些）`);
    if (!bits.length) return;
    try {
      localStorage.setItem(REPORT_KEY, sig);
    } catch {
      // 同上
    }
    toasts.show(`🌅 今天早上：${bits.join('；')}`, 5200);
  }

  // ───────────── V0.5：湖中女神 ─────────────
  function showGoddess(until: number): Promise<void> {
    const gd = gdefs?.file.fishing.goddess;
    if (!gd) return Promise.resolve();
    return new Promise((resolve) => {
      const box = doc.createElement('div');
      box.className = 'px-goddess';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', gd.name);
      const glow = doc.createElement('div');
      glow.className = 'px-goddess-glow';
      const img = doc.createElement('img');
      img.className = 'px-goddess-img';
      img.alt = gd.name;
      try {
        if (gd.image) img.src = pack.asset(gd.image);
      } catch {
        img.hidden = true;
      }
      const card = doc.createElement('div');
      card.className = 'px-goddess-card';
      const name = doc.createElement('div');
      name.className = 'px-goddess-name';
      name.textContent = `✨ ${gd.name} ✨`;
      const text = doc.createElement('div');
      text.className = 'px-goddess-text';
      const hint = doc.createElement('div');
      hint.className = 'px-goddess-hint';
      hint.textContent = '點一下繼續 ▼';
      card.append(name, text, hint);
      box.append(glow, img, card);
      stage.append(box);
      stage.dataset.goddess = '1';
      pet.idleUntil = Infinity;
      const end = new Date(until);
      const lines = [...gd.lines, `🍀 獲得「好運」：稀有的魚、礦石、動物產品都更容易出現，持續到明天早上 ${end.getHours()} 點。`];
      let i = 0;
      const show = () => (text.textContent = lines[i]!);
      show();
      box.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        i++;
        if (i < lines.length) return show();
        box.remove();
        delete stage.dataset.goddess;
        idle(800);
        resolve();
      });
    });
  }

  // ───────────── V0.5：天氣（weather.json 的粒子、閃電、色調） ─────────────
  let lastWeatherT = 0;
  let flashA = 0;
  function drawWeather(now: number) {
    const w = view?.game?.weather;
    if (!w) return;
    const dt = lastWeatherT ? Math.min(0.1, (now - lastWeatherT) / 1000) : 0;
    lastWeatherT = now;
    const out = outdoor.has(sceneId);
    const W = map.width * TS;
    const H = map.height * TS;
    const p = w.particles;
    if (p && out) {
      const t = now / 1000;
      const slant = Math.tan((p.slant * Math.PI) / 180);
      ctx.fillStyle = p.color;
      for (let i = 0; i < p.count; i++) {
        const y = (i * 97 + t * p.speed + (i % 7) * 13) % H;
        const x = (((i * 53 + y * slant * 0.3 + t * p.speed * slant * 0.3) % W) + W) % W;
        ctx.fillRect(ox + Math.floor(x), oy + Math.floor(y), 1, p.length);
      }
    }
    if (w.tint) {
      ctx.fillStyle = w.tint;
      ctx.globalAlpha = out ? 1 : 0.5;
      ctx.fillRect(ox, oy, W, H);
      ctx.globalAlpha = 1;
    }
    if (w.flash && dt) {
      if (Math.random() < (w.flash.perMinute / 60) * dt) flashA = out ? 0.75 : 0.3;
      if (flashA > 0.01) {
        ctx.fillStyle = `rgba(255,255,255,${flashA.toFixed(3)})`;
        ctx.fillRect(ox, oy, W, H);
        stage.dataset.flash = '1';
      }
      flashA *= Math.pow(0.02, dt); // 0.2 秒內暗下來
    }
  }

  // ───────────── V0.5：睡覺（快轉到隔天早上） ─────────────
  function openSleep() {
    const g = view?.game;
    if (!g || !view) return;
    const wake = gdefs?.file.sleep?.wakeHour ?? 6;
    showPanel('sleep', () => {
      const box = uiEl(doc, 'div', 'px-shop');
      box.append(uiEl(doc, 'div', 'px-greeting', `要睡到明天早上 ${wake} 點嗎？睡覺的時候時間會快轉：作物會長、動物會產出，體力也會回滿。`));
      const plots = Object.values(g.plots).filter((p) => p && !p.ready && !p.watered).length;
      if (plots) box.append(uiEl(doc, 'div', 'px-hint', `💧 還有 ${plots} 塊田沒澆水（如果明天早上下雨，會自動澆好）`));
      const bar = uiEl(doc, 'div', 'px-row-btns');
      bar.append(button(doc, '😴 睡覺', () => void doSleep()), button(doc, '還不睏', () => panel.close()));
      box.append(bar);
      openPanel('sleep', '🛏️ 睡覺', box);
    });
  }

  async function doSleep() {
    panel.close();
    if (playingNow()) await stopPlay(true); // V0.11：先結算玩遊戲的好感、體力
    busy = true;
    fade.classList.add('on', 'sleep');
    await wait(900);
    const res = await act({ type: 'sleep' });
    await wait(500);
    fade.classList.remove('on', 'sleep');
    busy = false;
    if (!res) return;
    if (!res.ok) return sayError(res.error);
    if (res.event.type !== 'slept') return;
    const w = res.view.game!.weather;
    const rain = res.event.watered ? `下雨了，${res.event.watered} 塊田都自動澆好囉！` : '';
    toasts.show(`🌅 早安！今天是 ${w.emoji} ${w.name}${rain ? `，${rain}` : ''}`, 4200);
    const morning = () => speak([`早安～今天是${w.name}！${rain}`], true);
    // V0.17：她昨晚寫了日記：先翻開給主人看，收好之後才說早安
    if (res.event.diary && gdefs?.file.diary) openDiary(res.event.diary, morning);
    else morning();
  }

  // ───────────── V0.17：鯨魚娘的像素日記 ─────────────
  // 睡覺時規則層先拼一篇；DSH 的 host 再請 AI 重寫（entry.pending = 還在寫）。日記開著時每 1.5 秒問一次 host，寫好了就一個字一個字寫出來。
  let diaryIndex = 0;
  /** 已經用打字效果寫過的（id:source），之後重畫就直接顯示全文 */
  const diaryTyped = new Set<string>();
  let diaryPoll = 0;
  let diaryPolls = 0;
  let diaryAutoChecked = false;

  function toggleDiary() {
    if (panel.kind === 'diary') return panel.close();
    openDiary();
  }
  function openDiary(id?: string, after?: () => void) {
    const entries = view?.game?.diary.entries ?? [];
    diaryIndex = Math.max(0, id ? entries.findIndex((e) => e.id === id) : 0);
    diaryPolls = 0;
    showPanel('diary', renderDiary, () => {
      clearTimeout(diaryPoll);
      const unread = view?.game?.diary.unread;
      if (unread) void act({ type: 'diary_read', id: unread }); // 收好了：之後不再自動打開
      after?.();
    });
  }
  function renderDiary() {
    const entries = view?.game?.diary.entries ?? [];
    const e = entries[diaryIndex];
    const key = e ? `${e.id}:${e.source}` : '';
    // 最新那篇第一次看、或 AI 剛寫好：一個字一個字寫出來
    const typewriter = !!e && !e.pending && !diaryTyped.has(key) && (diaryIndex === 0 || !e.read);
    if (e && !e.pending) diaryTyped.add(key);
    openPanel('diary', '📔 鯨魚娘的像素日記', buildDiary(doc, {
      herName: ch.name,
      entries,
      index: diaryIndex,
      typewriter,
      onPage: (i) => {
        diaryIndex = Math.max(0, Math.min(entries.length - 1, i));
        renderDiary();
      },
      onClose: () => panel.close(),
    }));
    stage.dataset.diary = e ? `${e.id}:${e.pending ? 'pending' : e.source}` : 'none';
    // 還在寫：過一下再問 host（最多問 40 次，約一分鐘）
    clearTimeout(diaryPoll);
    if (e?.pending && diaryPolls < 40) {
      diaryPoll = window.setTimeout(() => {
        diaryPolls += 1;
        if (panel.kind === 'diary') void refresh().catch(warn('diary'));
      }, 1500);
    }
  }
  // ── V0.20：🔑 AI 對話設定（玩家自己的 DeepSeek API Key，存在這台電腦的瀏覽器） ──
  let aiStatus: { ok: boolean; text: string } | null = null;
  let aiBusy = false;
  let aiDraft = '';
  // ───────────── V0.22：社交（交易所、信箱、設定、聊天室、串門、領養） ─────────────
  const social = gameplayFile?.social ?? null;
  let lastAdoptCode: { code: string; name: string } | null = null;
  let lastStallCode: string | null = null;
  let lastReceipt: string | null = null;
  let lastInvite: string | null = null;
  let inviteBusy = false;
  let inviteFresh = false;
  let visitTab: VisitTab = 'make';
  let visitDraft = '';
  let visitError: string | null = null;
  let visitGoing = false;
  let lastLetterCode: string | null = null;
  let marketTab: MarketTab = 'market';
  const itemText = (id: ItemId) => {
    const it = itemLabel(gdefs!, id);
    return `${it.emoji} ${it.name}`;
  };
  const rerender = () => {
    if (sidePanel.isOpen) panelRender?.();
    if (modal.isOpen) modalRender?.();
  };

  async function socialAct(a: GameAction) {
    const res = await act(a);
    if (!res) return;
    if (!res.ok) return void socialError(res.error);
    const e = res.event;
    if (e.type === 'market_bought') toasts.show(t('toast.bought', { item: itemText(e.item), n: e.qty, cost: e.cost }));
    else if (e.type === 'stall_listed') { lastStallCode = e.code; toasts.show(t('toast.listed'), 4200); }
    else if (e.type === 'stall_cancelled') toasts.show(t('toast.cancelled', { item: itemText(e.item), n: e.qty }));
    else if (e.type === 'trade_bought') { lastReceipt = e.receipt; toasts.show(t('toast.tradeBought', { item: itemText(e.item), n: e.qty, total: e.total, who: e.seller }), 5200); }
    else if (e.type === 'trade_collected') toasts.show(t('toast.collected', { n: e.total, who: e.buyer }), 4200);
    else if (e.type === 'pet_adopt_code') { lastAdoptCode = { code: e.code, name: e.name }; toasts.show(t('toast.adoptCode', { name: e.name }), 4200); }
    else if (e.type === 'pet_adopted') {
      toasts.show(e.from ? t('toast.adopted', { name: e.name, who: e.from }) : t('toast.adoptedBack', { name: e.name }), 5200);
      if (!away()) speak([t('line.newPet', { name: e.name })], true);
    } else if (e.type === 'letter_received') toasts.show(e.watered ? t('toast.letterWatered', { who: e.letter.nick, n: e.watered }) : t('toast.letter', { who: e.letter.nick }), 4200);
    else if (e.type === 'nick_set') toasts.show(t('toast.nick', { nick: e.nick }));
    rerender();
  }

  // 🏪 交易所
  function toggleMarket() {
    if (panel.kind === 'market') return panel.close();
    showPanel('market', renderMarket, () => { lastStallCode = null; lastReceipt = null; });
  }
  function renderMarket() {
    if (!gdefs || !social || !view?.game?.social) return;
    openPanel('market', t('market.title'), buildMarket(doc, {
      tab: marketTab, game: view.game, defs: gdefs, maxListings: social.stall.maxListings, maxQty: social.stall.maxQty,
      lastStallCode, lastReceipt,
      onTab: (tab) => { marketTab = tab; renderMarket(); },
      onBuyOffer: (item, qty) => void socialAct({ type: 'market_buy', item, qty }),
      onList: (item, qty, price) => void socialAct({ type: 'stall_list', item, qty, price }),
      onCancel: (id) => void socialAct({ type: 'stall_cancel', id }),
      onBuyCode: (code) => void socialAct({ type: 'trade_buy', code }),
      onCollect: (code) => void socialAct({ type: 'trade_receipt', code }),
    }));
  }

  // 📮 信箱
  function toggleMail() {
    if (panel.kind === 'mail') return panel.close();
    showPanel('mail', renderMail);
    if (view?.game?.social?.unread) setTimeout(() => void act({ type: 'mail_read' }), 1500); // 看一下再標成已讀
  }
  function renderMail() {
    if (!view?.game?.social) return;
    openPanel('mail', t('mail.title'), buildMailbox(doc, {
      letters: view.game.social.mailbox,
      onReply: (code) => void socialAct({ type: 'visit_reply', code }),
    }));
  }

  // ⚙️ 設定（語言、暱稱；串門的兩顆按鈕打開畫面中央的串門視窗）
  function toggleSettings() {
    if (panel.kind === 'settings') return panel.close();
    showPanel('settings', renderSettings);
  }
  function renderSettings() {
    if (!social || !view?.game?.social) return;
    openPanel('settings', t('settings.title'), buildSettings(doc, {
      locale: i18n().locale, nick: view.game.social.nick, nickMax: social.nick.maxLength,
      onLocale: (l: Locale) => {
        I18nManager.save(l);
        toasts.show(t('settings.reloading'));
        setTimeout(() => win.location.reload(), 300); // 存檔每個動作都存好了，重新整理不會掉進度
      },
      onNick: (nick) => void socialAct({ type: 'set_nick', nick }),
      onOpenVisit: (tab) => openVisit(tab),
    }));
  }

  // 🏡 串門視窗（畫面正中央，半透明黑幕）：生成我的邀請碼／輸入朋友的邀請碼
  function openVisit(tab: VisitTab) {
    if (!social || visiting) return;
    visitTab = tab;
    visitError = null;
    showPanel('visit', renderVisit, () => { visitError = null; });
    if (tab === 'make' && !lastInvite) void makeInvite();
  }
  function renderVisit() {
    if (!social || !view?.game?.social) return;
    // 畫面每次更新都會重畫：記住打到一半的字和游標
    const prev = doc.activeElement as HTMLTextAreaElement | null;
    const keep = prev?.classList?.contains('px-visit-code') && !prev.readOnly ? [prev.selectionStart, prev.selectionEnd] as const : null;
    const content = buildVisitModal(doc, {
      tab: visitTab, invite: lastInvite, busy: visitTab === 'make' ? inviteBusy : visitGoing, draft: visitDraft, error: visitError,
      days: social.visit.codeDays,
      onTab: (next) => { visitTab = next; visitError = null; renderVisit(); if (next === 'make' && !lastInvite) void makeInvite(); },
      onMake: () => void makeInvite(),
      onDraft: (text) => { visitDraft = text; },
      onGo: (code) => void goVisit(code),
      onClose: () => modal.close(),
    });
    openPanel('visit', t('visit.modalTitle'), content);
    const area = content.querySelector<HTMLTextAreaElement>('.px-visit-code');
    if (!area) return;
    if (keep) { area.focus(); area.setSelectionRange(keep[0], keep[1]); }
    else if (visitTab === 'go' && !visitDraft) area.focus();
    // 剛生成的邀請碼：亮一下、選起來，能自動複製就直接複製
    if (inviteFresh && lastInvite && visitTab === 'make') {
      inviteFresh = false;
      area.classList.add('px-flash');
      area.select();
      void copyToClipboard(doc, lastInvite).then((ok) => { if (ok && content.isConnected) modalToast(content, t('visit.copied')); });
    }
  }
  async function makeInvite() {
    if (!social || inviteBusy) return;
    inviteBusy = true;
    rerender();
    try {
      const res = await act({ type: 'visit_snapshot' });
      if (res?.ok && res.event.type === 'visit_snapshot') {
        lastInvite = await encodeInvite(res.event.payload, social.salt);
        inviteFresh = true;
      } else if (res && !res.ok) socialError(res.error);
    } catch (err) {
      warn('invite')(err);
      toasts.show(t('err.generic'));
    } finally {
      inviteBusy = false;
      rerender();
    }
  }
  async function goVisit(code: string) {
    const me = view?.game?.social;
    if (!opts.shell || !me || visitGoing) return;
    visitGoing = true;
    visitError = null;
    rerender();
    const r = await opts.shell.visit(code, { id: me.id, nick: me.nick }).catch(() => ({ ok: false as const, message: t('invite.bad') }));
    if (disposed) return; // 成功的話這個畫面已經換成朋友家了
    visitGoing = false;
    if (!r.ok) visitError = r.message;
    rerender();
  }

  // ✉️ 在朋友家留信、🏠 回家
  function toggleLetter() {
    if (panel.kind === 'letter') return panel.close();
    showPanel('letter', renderLetter);
  }
  function renderLetter() {
    if (!visiting || !social) return;
    openPanel('letter', t('letter.title'), buildLetterComposer(doc, {
      host: visiting.visiting.nick, watered: visiting.wateredCount, max: social.visit.letterMax, code: lastLetterCode,
      onMake: (text) => {
        lastLetterCode = visiting.makeReply(text);
        renderLetter();
      },
      onHome: () => void opts.shell?.goHome(),
    }));
  }
  if (visiting) {
    const bar = doc.createElement('div');
    bar.className = 'px-visit-bar';
    bar.setAttribute('role', 'status');
    const label = doc.createElement('span');
    label.textContent = t('visit.banner', { host: visiting.visiting.nick });
    const mk = (text: string, fn: () => void, cls: string) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = `px-trade-btn ${cls}`;
      b.textContent = text;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      return b;
    };
    bar.append(label, mk(t('hud.letter'), () => toggleLetter(), 'px-visit-letter'), mk(t('visit.home'), () => void opts.shell?.goHome(), 'px-visit-home'));
    stage.append(bar);
  }

  // 💬 聊天室
  let chatOff: (() => void) | null = null;
  function toggleChat() {
    const chat = opts.shell?.chat;
    if (!chat) return;
    if (panel.kind === 'chat') return panel.close();
    chatOff?.();
    chatOff = chat.onChange(() => { if (panel.kind === 'chat') renderChat(); });
    chat.startAmbient();
    showPanel('chat', renderChat, () => { chat.stopAmbient(); chatOff?.(); chatOff = null; });
  }
  let chatSending = false;
  function renderChat() {
    const chat = opts.shell?.chat;
    if (!chat || !social) return;
    // 重畫時保留還沒送出的字和游標
    const old = doc.querySelector<HTMLInputElement>('.px-chat-input input');
    const draft = chatSending ? '' : old?.value ?? ''; // 剛送出的那句不要又填回輸入框
    const focused = !!old && doc.activeElement === old;
    openPanel('chat', t('chat.title'), buildChat(doc, {
      messages: chat.messages(), mode: chat.mode, banner: t('chat.banner'),
      nick: view?.game?.social?.nick ?? visiting?.visiting.me.nick ?? '', maxLength: social.chat.maxLength, dev: isDevMode(),
      onSend: (text) => {
        chatSending = true;
        let r: ReturnType<typeof chat.send>;
        try { r = chat.send(text); } finally { chatSending = false; }
        if (!r.ok && r.reason !== 'empty') toasts.show(t(`chat.${r.reason}`));
        return r.ok; // 沒送出（太快、重複）就把字留在輸入框
      },
      onConnect: (url) => void chat.connectToServer(url),
    }));
    const inp = doc.querySelector<HTMLInputElement>('.px-chat-input input');
    if (inp) {
      inp.value = draft;
      if (focused) inp.focus();
    }
  }

  function toggleAiSettings() {
    if (panel.kind === 'aikey') return panel.close();
    aiStatus = null;
    aiDraft = '';
    showPanel('aikey', renderAiSettings);
  }
  function renderAiSettings() {
    const s = bridge.aiSettings;
    if (!s) return;
    stage.dataset.aiKey = s.hasKey ? 'set' : 'none';
    openPanel('aikey', '🔑 AI 對話設定', buildAiSettings(doc, { hasKey: s.hasKey, masked: s.masked(), status: aiStatus, busy: aiBusy, draft: aiDraft }, {
      onDraft: (text) => { aiDraft = text; },
      onSave: (key) => {
        if (!key.trim()) { aiStatus = { ok: false, text: '先把 Key 貼進框框裡。' }; return renderAiSettings(); }
        s.save(key);
        aiDraft = '';
        aiOff = false; // 之前因為沒有 Key 關掉了：重新打開
        aiStatus = { ok: true, text: /^sk-[A-Za-z0-9_-]{20,}$/.test(key.trim()) ? '💾 存好了！點她說話試試看～' : '💾 存好了。不過這個 Key 看起來不像 sk- 開頭的 DeepSeek Key，可以按「測試連線」確認。' };
        renderAiSettings();
      },
      onTest: (key) => {
        aiBusy = true;
        renderAiSettings();
        const typed = key.trim();
        void s.test(typed || undefined).then((r) => {
          aiBusy = false;
          if (r.ok && typed) {
            // 測試成功就直接存起來，玩家不用再按一次儲存
            s.save(typed);
            aiOff = false;
            aiDraft = '';
          }
          aiStatus = r.ok ? { ok: true, text: typed ? '✅ 連線成功，Key 已經存好了！點她說話試試看～' : '✅ 連線成功！' } : { ok: false, text: `❌ ${r.message}` };
          if (panel.kind === 'aikey') renderAiSettings();
        });
      },
      onClear: () => {
        s.clear();
        aiDraft = '';
        aiStatus = { ok: true, text: '🗑 已經清除 Key 和她的對話記憶，之後用內建的台詞。' };
        renderAiSettings();
      },
      onClose: () => panel.close(),
    }));
  }

  /** 打開畫面時：有還沒看的日記（例如用 tool 讓她睡、或在別台電腦睡的）就翻開 */
  function maybeOpenDiary(tries = 0) {
    const unread = view?.game?.diary.unread;
    if (!unread || panel.kind === 'diary') return;
    if (busy || dialog.open || panel.isOpen) {
      if (tries < 20) setTimeout(() => maybeOpenDiary(tries + 1), 3000);
      return;
    }
    openDiary(unread);
  }

  /** 畫面開著時，算好下一次作物長大的時間點再跟 host 同步一次（不用每秒輪詢） */
  function scheduleGrowth() {
    clearTimeout(growthTimer);
    const g = view?.game;
    if (!g || !view) return;
    const next = Math.min(...Object.values(g.plots).map((p) => p?.nextAt ?? Infinity));
    if (!Number.isFinite(next)) return;
    const delay = Math.min(Math.max(next - view.now + 300, 5000), 6 * 3_600_000);
    growthTimer = setTimeout(() => void refresh().catch(warn('grow')), delay);
  }

  // ── 8. 點擊：她 → 說話；門 → 走去門口再出門；地面 → 走過去 ──
  function toMap(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    return { lx: ((e.clientX - r.left) / r.width) * VW - ox, ly: ((e.clientY - r.top) / r.height) * VH - oy };
  }
  function hitPet(lx: number, ly: number) {
    const w = ch.world;
    const ds = (w.drawScale ?? 1) * actorScale;
    const half = ds === 1 ? w.frameWidth / 2 + 1 : (w.frameWidth * ds) * 0.3; // 細緻圖的左右有頭髮、尾巴留白，點擊範圍收窄一點
    return Math.abs(lx - pet.px) <= half && ly >= pet.py - w.footY * ds - 1 && ly <= pet.py + 3;
  }
  function doorAt(tx: number, ty: number) {
    return map.doors.find((d) => tx >= d.rect.x && tx < d.rect.x + d.rect.w && ty >= d.rect.y && ty < d.rect.y + d.rect.h);
  }

  function onPointerDown(e: PointerEvent) {
    if (busy || !map) return;
    if (fishing) return fishing.skip(); // 等魚上鉤時點一下：直接揭曉
    const { lx, ly } = toMap(e);
    // V0.18：1.5 秒內點她 3 下 = 摸摸頭（對話框開著也算）
    if (!decorMode && !swim && !away() && hitPet(lx, ly) && countTap()) return void headpat();
    if (dialog.open) {
      dialog.close();
      return;
    }
    const t = { x: Math.floor(lx / TS), y: Math.floor(ly / TS) };
    if (decorMode) return void onDecorClick(t);
    // V0.11：她在玩遊戲：點哪裡都先叫她停下來（結算），再點一次才做別的事
    if (playingNow() && !away()) return void stopPlay();
    if (swim) return void endSwim(true); // V0.15：在游泳：點哪裡都先叫她上岸
    // V0.6：野生寵物、自己的寵物
    const wild = petLayer?.wildAtTile(t.x, t.y);
    if (wild) return openCatch(wild.id);
    const mine = petLayer?.petAt(lx, ly);
    if (mine) return void petClick(mine.id);
    if (travel) {
      travel = null; // 自己點了別的地方：取消前往
      delete stage.dataset.travel;
    }
    if (map.background) {
      // V0.9：背景圖場景：點她 → 說話；點家具（原圖像素判定）→ 走過去做那件事；點地板 → 走過去
      if (!away() && hitPet(lx, ly)) return petTapped();
      const hs = hotspotHit(lx, ly);
      if (hs?.doors && hs.doors.length > 1) return chooseDoor(hs.doors);
      if (hs?.door) return clickDoor(hs.door);
      if (hs?.it) return approach(hs.it);
      if (isWalkable(map, t) && walkTo(t, { kind: 'tile' })) marker = { tile: t, until: performance.now() + 700 };
      return;
    }
    const target = gdefs ? interactableAt(t.x, t.y) : undefined;
    if (target) return approach(target); // 農田就在她頭頂時，點農田優先
    if (!away() && hitPet(lx, ly)) return petTapped();
    const door = doorAt(t.x, t.y);
    if (door && isLocked(door.unlock)) return openUnlock(door.unlock!);
    if (door && away()) return void goto(door.to, door.spawn); // 她不在：主人自己過去
    if (door?.stand) {
      marker = { tile: door.stand, until: performance.now() + 700 };
      walkTo(door.stand, { kind: 'door', door });
    } else if (isWalkable(map, t)) {
      if (walkTo(t, { kind: 'tile' })) marker = { tile: t, until: performance.now() + 700 };
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!map) return;
    const { lx, ly } = toMap(e);
    const tx = Math.floor(lx / TS);
    const ty = Math.floor(ly / TS);
    if (decorMode) {
      tip.classList.remove('show');
      canvas.style.cursor = 'crosshair';
      decorHover = { x: tx, y: ty };
      return;
    }
    const wildHover = petLayer?.wildAtTile(tx, ty);
    const petHover = petLayer?.petAt(lx, ly);
    if (wildHover || petHover) {
      canvas.style.cursor = 'pointer';
      const sp = gdefs?.file.pets?.species[wildHover?.kind ?? petHover!.kind];
      const cr = canvas.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      tip.textContent = wildHover ? `野生的${sp?.name ?? ''}（點一下用捕捉網抓）` : `${petHover!.name}（點一下摸摸）`;
      placeTip(cr.left - sr.left + ((ox + (tx + 0.5) * TS) / VW) * cr.width, cr.top - sr.top + ((oy + (ty - 0.5) * TS) / VH) * cr.height);
      return;
    }
    if (map.background) {
      // V0.9：停在熱區上：小手游標＋發光框＋提示文字
      const hs = busy ? null : hotspotHit(lx, ly);
      hoverHs = hs ? { rect: hs.rect, locked: hs.locked } : null;
      canvas.style.cursor = hs || hitPet(lx, ly) ? 'pointer' : 'default';
      if (!hs) return void tip.classList.remove('show');
      const label = hs.it ? hs.it.label : hs.door!.label;
      const cr = canvas.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      tip.textContent = hs.locked ? `🔒 ${label}（點一下看解鎖條件）` : label;
      placeTip(cr.left - sr.left + ((ox + hs.rect.x + hs.rect.w / 2) / VW) * cr.width, cr.top - sr.top + ((oy + hs.rect.y) / VH) * cr.height);
      return;
    }
    const thing = (gdefs ? interactableAt(tx, ty) : undefined) ?? doorAt(tx, ty);
    canvas.style.cursor = hitPet(lx, ly) || thing ? 'pointer' : 'default';
    if (thing && !busy) {
      const cr = canvas.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      tip.textContent = 'kind' in thing ? describe(thing) : isLocked(thing.unlock) ? `🔒 ${thing.label}（點一下看解鎖條件）` : thing.label;
      placeTip(cr.left - sr.left + ((ox + (thing.rect.x + thing.rect.w / 2) * TS) / VW) * cr.width, cr.top - sr.top + ((oy + thing.rect.y * TS) / VH) * cr.height);
    } else tip.classList.remove('show');
  }
  /**
   * 提示框置中在 x 上方；畫面很窄時不要超出左右邊（V0.10，DSH 回報：280px 寬時左邊會被切掉）。
   * 提示框用 translateX(-50%) 置中，所以把「中心點」夾在 [半寬, 舞台寬 − 半寬] 之間。
   */
  function placeTip(x: number, y: number) {
    tip.classList.add('show');
    const half = tip.offsetWidth / 2;
    const max = stage.clientWidth - half - 4;
    tip.style.left = `${Math.max(half + 4, Math.min(x, max))}px`;
    tip.style.top = `${y}px`;
  }

  const onPointerLeave = () => {
    tip.classList.remove('show');
    hoverHs = null;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // V0.6：面板改成側邊抽屜，焦點在面板上時快捷鍵也要能用；但在輸入框打字時不要搶
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
    if (tgt?.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return; // 讓按鈕自己處理
    if (player.on && !panel.isShown && !decorMode) {
      if (KEY_DIR[e.key]) {
        e.preventDefault();
        held.delete(e.key);
        held.add(e.key);
        return;
      }
      if (e.key === 'e' || e.key === 'E' || e.key === 'j' || e.key === 'J' || (e.key === ' ' && !dialog.open)) {
        e.preventDefault();
        if (!e.repeat || combat) playerUse();
        return;
      }
    }
    if (e.key === 'p' || e.key === 'P') return void setPlayerMode(!player.on);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (dialog.open) dialog.close();
      else talk();
    } else if (e.key === 'Escape') {
      if (panel.isOpen) panel.close();
      else if (decorMode) setDecorMode(false);
      else dialog.close();
    } else if ((e.key === 'b' || e.key === 'B') && gdefs) toggleBag();
    else if ((e.key === 'c' || e.key === 'C') && gdefs) toggleCodex();
    else if ((e.key === 'r' || e.key === 'R') && gdefs) toggleDecorMode();
    else if ((e.key === 'g' || e.key === 'G') && gdefs) openGifts();
    else if (e.key === 'm' || e.key === 'M') toggleWorldMap('walk');
    else if (e.key === 't' || e.key === 'T') toggleWorldMap('teleport');
    else if ((e.key === 'n' || e.key === 'N') && music) toggleMusic();
    else if ((e.key === 'f' || e.key === 'F') && gdefs?.file.furniture) toggleCatalog();
    else if ((e.key === 'k' || e.key === 'K') && gdefs?.file.pets) togglePets();
    else if ((e.key === 'l' || e.key === 'L') && gdefs?.file.diary) toggleDiary();
    else if ((e.key === 'i' || e.key === 'I') && bridge.aiSettings) toggleAiSettings();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  shell.addEventListener('keydown', onKeyDown); // 焦點在側邊欄時快捷鍵也能用
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.key);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', () => held.clear());

  // ── 9. 換場景：黑幕 → host 存檔成功才換 → 從對應的出生點出現 → 說進場台詞 ──
  async function goto(id: string, spawn?: string) {
    if (busy || disposed || id === sceneId) return;
    if (playingNow()) await stopPlay(true); // V0.11：離開遊戲室就不玩了
    if (swim) endSwim(); // V0.15
    busy = true;
    dialog.close();
    tip.classList.remove('show');
    fade.classList.add('on');
    await wait(FADE_MS);
    try {
      setView(await bridge.setScene(id));
      applyScene(view!.sceneId, spawn);
      if (player.on) placePlayer(pet.tile);
    } catch (err) {
      warn('setScene')(err);
      idle();
    }
    fade.classList.remove('on');
    await wait(FADE_MS);
    busy = false;
    if (sceneId === id && !travel) say('enter'); // 趕路中不停下來說話
    continueTravel();
  }

  // ── 10. 跟 host 同步與作息 ──
  function setView(v: PetView) {
    const prev = view?.phase;
    const prevWeather = view?.game?.weather?.id;
    view = v;
    // V0.8：天氣變了（畫面開著時跨過換天氣的時間點）：她用頭上的小氣泡說一句感想。睡覺時有自己的早安，不重複
    const newWeather = v.game?.weather?.id;
    if (prevWeather && newWeather && prevWeather !== newWeather && !busy) {
      void aiSay('weather', { weather: newWeather }, () => {}, 'bubble');
    }
    opts.onView?.(v);
    if (hud && v.game) hud.update(v.game, v.now);
    clockHud?.bind(v.game ? { now: v.now, season: v.game.season, weather: v.game.weather } : null); // V0.16
    if (v.game && gdefs?.file.diary) {
      hud?.setBadge('diary', !!v.game.diary.unread); // V0.17：有新日記，📔 按鈕亮小紅點
      hud?.setBadge('mail', !!v.game.social?.unread); // V0.22：有新信
      if (!diaryAutoChecked) {
        diaryAutoChecked = true;
        if (v.game.diary.unread) setTimeout(() => maybeOpenDiary(), 2500);
      }
    }
    if (gdefs) onQuestView(v);
    const notice = bridge.takeNotice?.(); // V0.21：存檔壞掉自動重開時，跟玩家說一聲
    if (notice) toasts.show(notice, 8000);
    if (gdefs && v.game) onWishView(v.game); // V0.18
    if (v.game) onStatView(v.game.stats);
    if (v.game?.farmReport) showFarmReport(v.game.farmReport);
    if (baseMap) deriveMap();
    if (sidePanel.isOpen) panelRender?.();
    if (modal.isOpen) modalRender?.();
    scheduleGrowth();
    scheduleSocial();
    updateMusic();
    if (prev && prev !== v.phase) {
      const target = scheduledScene(ch, v.phase);
      // 時段變了：新的安排蓋掉舊的（例如下午要出門、還沒出門就到了晚上 → 改成留在家）
      pendingScene = target && target !== sceneId && pack.maps[target] ? target : null;
      if (pet.goal?.kind === 'door' && pet.goal.door.to !== pendingScene) {
        Object.assign(pet, { path: [], goal: null, walking: false }); // 正在走去的門已經不需要了
        idle(600);
      }
      if (pendingScene && !pet.walking && !dialog.open && !fishing && !panel.isOpen && !away()) {
        pet.idleUntil = Math.min(pet.idleUntil, performance.now() + 600);
      }
    }
  }

  async function visit() {
    const v = await bridge.visit();
    setView(v);
    let id = v.sceneId;
    const target = scheduledScene(ch, v.phase);
    // 你不在的時候，她照作息生活：回來時她已經在該在的地方
    if (v.awayMinutes >= WELCOME_AFTER_MIN && target && target !== id && pack.maps[target]) {
      const moved = await bridge.setScene(target);
      setView(moved);
      id = moved.sceneId;
    }
    if (!map || id !== sceneId) applyScene(id);
    const greet = () => {
      greetToday();
      introQuest(); // 關掉再回來：她再說一次現在要做什麼
    };
    if (v.awayMinutes >= WELCOME_AFTER_MIN && !away()) {
      Object.assign(pet, { path: [], goal: null, walking: false, face: 'down' as Facing });
      const r = say('welcome', {}, greet);
      if (!r.played) showEmote('exclaim');
    } else greet();
  }

  /** 每天第一次見面：節慶打招呼、婚後她說今天幫了什麼 */
  function greetToday() {
    const g = view?.game;
    if (!g || away() || dialog.open) return;
    const day = new Date(view!.now).toDateString();
    const once = (key: string) => {
      try {
        const k = `whale-pet:greet:${key}`;
        if (localStorage.getItem(k) === day) return false;
        localStorage.setItem(k, day);
      } catch {
        // 存不了就每次打開都說
      }
      return true;
    };
    const help = g.help;
    const fest = g.festival;
    const sayHelp = () => {
      if (help && once('help')) {
        toasts.show(`💍 她早上幫你澆了 ${help.watered} 塊田、摸了 ${help.petted} 隻動物`, 4200);
        say('help', { vars: { watered: String(help.watered), petted: String(help.petted) } });
      }
    };
    if (fest && once(`festival-${fest.id}`)) {
      toasts.show(`${fest.emoji} 今天是${fest.name}！${fest.description ?? ''}`, 4200);
      if (!say('festival', { vars: { festival: fest.name } }, sayHelp).shown) sayHelp();
    } else sayHelp();
  }

  async function refresh() {
    if (busy || disposed || doc.visibilityState !== 'visible') return;
    // 用 visit 而不是 getView：畫面開著就代表主人在，順便更新「上次見面」時間；
    // 否則畫面開一整天後關掉、五分鐘後再開，也會被當成離開很久
    const v = await bridge.visit();
    setView({ ...v, awayMinutes: 0 });
    // 例如模型用 tool 把她帶去花園：畫面直接跟上，不再寫回 host
    if (v.sceneId !== sceneId && !busy) applyScene(v.sceneId);
  }

  // 給自動測試用的唯讀快照（不影響遊戲）
  Object.defineProperty(stage, '__pxDebug', {
    value: () => ({
      scene: sceneId, pet: { ...pet.tile }, petPx: { x: pet.px, y: pet.py, ox, oy, vw: VW, vh: VH }, away: away(), player: player.on ? { ...player.tile, face: player.face } : null,
      width: map.width, height: map.height, blocked: map.blocked, pets: petLayer?.debug() ?? null,
      combat: combat && { floor: combat.floor, hp: combat.hp, kills: combat.kills, rocks: [...combat.rocks], ladder: combat.ladder, mobs: combat.mobs.map((m) => ({ ...m.tile, hp: m.hp })), loot: { ...combat.loot } },
    }),
  });

  const pollTimer = setInterval(() => void refresh().catch(warn('poll')), opts.pollMs ?? 60_000);
  const onVisible = () => {
    if (doc.visibilityState === 'visible') void visit().catch(warn('visit'));
  };
  doc.addEventListener('visibilitychange', onVisible);

  await visit();
  resize();
  let last = performance.now();
  const frame = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000); // 分頁切回來時不要瞬移
    last = t;
    update(t, dt);
    draw(t);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    goto,
    say: (trigger) => void say(trigger),
    visit,
    refresh,
    dispose() {
      disposed = true;
      clearInterval(lateTimer);
      clearTimeout(talkTimer);
      music?.dispose();
      clockHud?.dispose();
      cancelAnimationFrame(raf);
      clearInterval(pollTimer);
      clearTimeout(growthTimer);
      ro.disconnect();
      toasts.dispose();
      panel.dispose();
      modeTag.remove();
      hpTag.remove();
      bubble.remove();
      questBox.remove();
      doc.removeEventListener('visibilitychange', onVisible);
      dialog.dispose();
      app.remove();
    },
  };
}

function firstWalkable(m: MapModel): TilePos {
  const i = m.blocked.findIndex((b) => !b);
  return { x: Math.max(0, i) % m.width, y: Math.floor(Math.max(0, i) / m.width) };
}
