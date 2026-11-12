// V0.2 玩法 UI：系統提示、狀態列、揹包、商人。純 DOM，疊在畫面上；不碰宿主 DOM。
// 這裡只負責「長什麼樣子、點了呼叫誰」，規則都在 host（act）那邊。
import type { CollectionDef, GameplayDefs, GameView, ItemDef, ItemId, LootEntry, ShopDef, TradeDef } from '../../shared/gameplay-types.ts';
import { itemFrame, type SpritesFile } from '../../shared/sprites.ts';

const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = '', text?: string) => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ───────────── V0.10：揹包、圖鑑、送禮的物品圖示（有圖用圖，沒有用 emoji） ─────────────
// 圖集網址只設一次在 .px-app 的 CSS 變數 --px-atlas（打包版是 data URL，每格都寫一次太大）
let ICONS: { file: SpritesFile; w: number; h: number } | null = null;
export function setItemIcons(icons: { file: SpritesFile; w: number; h: number } | null) {
  ICONS = icons;
}
/** 格子裡的圖示：有圖畫圖（背景圖切一塊），沒有就放 emoji 文字 */
export function slotIcon(doc: Document, itemId: ItemId, emoji: string, size = 30): HTMLElement {
  const box = el(doc, 'span', 'px-slot-emoji');
  const fr = ICONS ? itemFrame(ICONS.file, itemId) : null;
  if (!fr || !ICONS) {
    box.textContent = emoji;
    return box;
  }
  const k = size / Math.max(fr.w, fr.h);
  const i = el(doc, 'span', 'px-icon');
  i.setAttribute('role', 'img');
  i.setAttribute('aria-label', emoji);
  Object.assign(i.style, {
    width: `${Math.round(fr.w * k)}px`,
    height: `${Math.round(fr.h * k)}px`,
    backgroundSize: `${ICONS.w * k}px ${ICONS.h * k}px`,
    backgroundPosition: `${-fr.x * k}px ${-fr.y * k}px`,
  });
  box.classList.add('has-icon');
  box.style.height = `${size}px`;
  box.append(i);
  return box;
}

export function itemLabel(defs: GameplayDefs, id: ItemId): { emoji: string; name: string; def?: ItemDef } {
  const def = defs.items.get(id);
  return def ? { emoji: def.emoji, name: def.name, def } : { emoji: '❓', name: '未知物品' };
}

// ───────────── 系統提示（右上方小卡片，幾秒後消失） ─────────────
export class Toasts {
  private readonly box: HTMLDivElement;
  constructor(parent: HTMLElement) {
    this.box = el(parent.ownerDocument, 'div', 'px-toasts');
    this.box.setAttribute('aria-live', 'polite');
    parent.append(this.box);
  }
  show(text: string, ms = 2400): void {
    // 同一句還在畫面上：不要再疊一則（例如連點同一個按鈕）
    for (const old of [...this.box.children]) if (old.textContent === text) old.remove();
    const t = el(this.box.ownerDocument, 'div', 'px-toast', text);
    this.box.append(t);
    while (this.box.children.length > 3) this.box.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }
  dispose(): void {
    this.box.remove();
  }
}

// ───────────── 狀態列：體力、飽食、好感＋揹包按鈕 ─────────────
export class Hud {
  private readonly box: HTMLDivElement;
  private readonly rows: Record<'stamina' | 'satiety' | 'affection', { fill: HTMLDivElement; text: HTMLSpanElement }>;
  private readonly cal: HTMLDivElement;
  private readonly btns = new Map<string, HTMLButtonElement>();
  constructor(parent: HTMLElement, buttons: { icon: string; title: string; label: string; onClick: () => void; cls?: string; key?: string }[]) {
    const doc = parent.ownerDocument;
    this.box = el(doc, 'div', 'px-hud');
    const row = (icon: string, cls: string) => {
      const r = el(doc, 'div', `px-hud-row ${cls}`);
      const bar = el(doc, 'div', 'px-hud-bar');
      const fill = el(doc, 'div', 'px-hud-fill');
      const text = el(doc, 'span', 'px-hud-text');
      bar.append(fill);
      r.append(el(doc, 'span', 'px-hud-icon', icon), bar, text);
      this.box.append(r);
      return { fill, text };
    };
    this.rows = { stamina: row('⚡', 'stamina'), satiety: row('🍙', 'satiety'), affection: row('❤', 'affection') };
    this.cal = el(doc, 'div', 'px-hud-cal');
    this.box.append(this.cal);
    // 右上角一排按鈕：揹包、圖鑑、裝修、禮物…
    const bar = el(doc, 'div', 'px-hud-btns');
    for (const o of buttons) {
      const b = el(doc, 'button', `px-bag-btn ${o.cls ?? ''}`.trim(), o.icon);
      b.type = 'button';
      b.title = o.title;
      b.setAttribute('aria-label', o.label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        o.onClick();
      });
      if (o.key) {
        b.dataset.panel = o.key;
        b.setAttribute('aria-pressed', 'false');
        this.btns.set(o.key, b);
      }
      bar.append(b);
    }
    parent.append(this.box, bar);
  }
  /** V0.17：按鈕上的小紅點（例如有新日記） */
  setBadge(key: string, on: boolean): void {
    this.btns.get(key)?.classList.toggle('has-new', on);
  }
  /** V0.6.2：面板開著時，對應的按鈕保持「按下去」的樣子 */
  setOpen(kind: string | null): void {
    for (const [k, b] of this.btns) {
      b.classList.toggle('open', k === kind);
      b.setAttribute('aria-pressed', String(k === kind));
    }
  }
  update(g: GameView, now = 0): void {
    const set = (k: keyof Hud['rows'], v: number, max: number, text: string) => {
      this.rows[k].fill.style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
      this.rows[k].text.textContent = text;
    };
    // V0.7：體力條的長度以「沒餓時的上限」為準；餓到歸零時上限減半，數字會寫成 12/50
    const st = g.stats;
    set('stamina', g.stamina, st.staminaBase, st.starving ? `${g.stamina}/${g.staminaMax}` : `${g.stamina}`);
    set('satiety', g.satiety, g.satietyMax, `${g.satiety}`);
    const mark = (k: keyof Hud['rows'], low: boolean, title: string) => {
      const row = this.rows[k].fill.parentElement!.parentElement!;
      row.classList.toggle('low', low);
      row.title = title;
    };
    const pct = Math.round(st.lowRatio * 100);
    mark('stamina', st.low.stamina, st.starving ? '體力（餓過頭了：上限減半，吃點東西就恢復）' : st.low.stamina ? `體力低於 ${pct}%：吃東西，或回房間睡覺` : '體力：釣魚、種田、澆水會用到；睡覺或吃東西恢復');
    mark('satiety', st.low.satiety, st.starving ? '飽食／水分歸零：體力上限減半，好感每天下降。快餵她吃東西或去池塘喝水' : st.low.satiety ? `飽食／水分低於 ${pct}%：餵她吃東西，或點池塘喝水` : '飽食／水分：會隨時間減少；吃東西或到池塘喝水恢復');
    mark('affection', st.starving, st.starving ? '她餓著肚子：好感每天下降' : '好感');
    // 好感條：距離下一個等級的進度；已經最高級就是滿的
    set('affection', g.nextLevelAt ? g.affection : 1, g.nextLevelAt ?? 1, `${g.level} ${g.affection}`);
    // 季節第幾天＋今天的天氣
    const cal = g.season ? `${g.season.emoji} ${g.season.name} ${g.season.day}/${g.season.days} · ${g.weather.emoji} ${g.weather.name}` : '';
    const fest = g.festival ? ` · ${g.festival.emoji} ${g.festival.name}` : '';
    const luck = g.luckUntil > now ? ' · 🍀 好運' : '';
    this.cal.textContent = `🪙 ${g.coins}${cal ? ` · ${cal}` : ''}${fest}${luck}`;
    this.cal.title = g.luckUntil > now ? '湖中女神的祝福：稀有的魚、礦石、動物產品都更容易出現（到明天早上）' : '';
  }
}

// ───────────── 面板（揹包、商人、圖鑑共用）：放在地圖旁邊的側邊欄裡 ─────────────
// V0.6：面板不再蓋在地圖上。開著面板也能繼續點地圖；按「－」收成一行標籤，點標籤再展開。
export type PanelKind = string;
export class Panel {
  private readonly backdrop: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly tab: HTMLButtonElement;
  private readonly stage: HTMLElement;
  private onClose?: () => void;
  private returnFocus: Element | null = null;
  kind: PanelKind | null = null;
  collapsed = false;
  /** 面板打開（或展開）時呼叫：側邊欄收起來的話要先打開 */
  onShow?: () => void;
  /** 換面板、關面板時呼叫（按鈕的「按下」狀態用） */
  onChange?: (kind: PanelKind | null) => void;

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;
    this.stage = parent;
    this.backdrop = el(doc, 'div', 'px-backdrop');
    const panel = (this.panel = el(doc, 'div', 'px-panel'));
    panel.setAttribute('role', 'dialog');
    panel.tabIndex = -1; // 讓面板本身可以拿焦點：Esc 才收得到
    const head = el(doc, 'div', 'px-panel-head');
    const fold = el(doc, 'button', 'px-panel-fold', '－');
    fold.type = 'button';
    fold.title = '收起來（點標籤再展開）';
    fold.setAttribute('aria-label', '收合');
    fold.addEventListener('click', () => this.setCollapsed(true));
    this.title = el(doc, 'div', 'px-panel-title');
    const close = el(doc, 'button', 'px-panel-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉');
    close.addEventListener('click', () => this.close());
    head.append(fold, this.title, close);
    this.body = el(doc, 'div', 'px-panel-body');
    panel.append(head, this.body);
    this.backdrop.append(panel);
    // 收合後留在右邊的小標籤
    this.tab = el(doc, 'button', 'px-drawer-tab');
    this.tab.type = 'button';
    this.tab.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setCollapsed(false);
    });
    this.tab.addEventListener('pointerdown', (e) => e.stopPropagation());
    // 點在面板上的事件不要傳到地圖
    this.backdrop.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.backdrop.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.close();
    });
    parent.append(this.backdrop, this.tab);
  }
  get isOpen(): boolean {
    return this.kind !== null;
  }
  /** 抽屜拉出來、而且沒收起來 */
  get isShown(): boolean {
    return this.kind !== null && !this.collapsed;
  }
  setCollapsed(on: boolean): void {
    if (!this.kind) on = false;
    this.collapsed = on;
    const wasShown = this.backdrop.classList.contains('show');
    this.backdrop.classList.toggle('show', !!this.kind && !on);
    this.tab.classList.toggle('show', !!this.kind && on);
    this.stage.classList.toggle('px-drawer-open', !!this.kind && !on);
    if (!on && this.kind) {
      this.onShow?.();
      // 只有「剛拉出來」才搶焦點；同一個面板重畫時不要把焦點從別的地方（例如置中視窗的輸入框）搶過來
      if (!wasShown) this.panel.focus({ preventScroll: true });
    }
  }
  open(kind: PanelKind, title: string, content: HTMLElement, onClose?: () => void): void {
    if (this.kind !== kind) {
      const prev = this.onClose;
      this.onClose = undefined;
      prev?.();
    }
    const doc = this.backdrop.ownerDocument;
    if (!this.kind) this.returnFocus = doc.activeElement;
    // 重畫內容時，焦點如果在舊按鈕上會掉到 body（Esc 就失效了），所以先記下來
    const hadFocus = !this.kind || this.backdrop.contains(doc.activeElement);
    const fresh = this.kind !== kind;
    this.kind = kind;
    this.onClose = onClose ?? this.onClose;
    this.title.textContent = title;
    this.tab.textContent = `▸ ${title}`;
    this.tab.title = `展開「${title}」`;
    const keep = this.body.scrollTop;
    this.body.replaceChildren(content);
    if (!fresh) this.body.scrollTop = keep; // 狀態更新重畫時，捲動位置不要跳回最上面
    // 換一個面板就拉出來；同一個面板重畫時維持收合狀態
    this.setCollapsed(fresh ? false : this.collapsed);
    if (fresh) this.onChange?.(kind);
    if (hadFocus && !this.collapsed && !this.backdrop.contains(doc.activeElement)) this.panel.focus({ preventScroll: true });
  }
  close(): void {
    if (!this.kind) return;
    this.kind = null;
    this.setCollapsed(false);
    const doc = this.backdrop.ownerDocument;
    if (this.backdrop.contains(doc.activeElement) || doc.activeElement === doc.body) {
      (this.returnFocus as HTMLElement | null)?.focus?.({ preventScroll: true });
    }
    this.returnFocus = null;
    const cb = this.onClose;
    this.onClose = undefined;
    cb?.();
    this.onChange?.(null);
  }
  dispose(): void {
    this.backdrop.remove();
    this.tab.remove();
  }
}

// ───────────── V0.6.2：獨立的模態視窗（商店、機器、動物、礦洞、送禮…） ─────────────
// 背後一層半透明黑幕蓋住整個遊戲（地圖＋側邊欄），表示「現在在交易」；關掉才回到遊戲。
// 介面跟 Panel 一樣（open / close / kind），呼叫端不用分兩套。
export class Modal {
  private readonly backdrop: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly info: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private onClose?: () => void;
  private returnFocus: Element | null = null;
  kind: PanelKind | null = null;
  onChange?: (kind: PanelKind | null) => void;

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;
    this.backdrop = el(doc, 'div', 'px-modal-backdrop');
    const box = (this.box = el(doc, 'div', 'px-panel px-modal'));
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.tabIndex = -1;
    const head = el(doc, 'div', 'px-panel-head');
    this.title = el(doc, 'div', 'px-panel-title');
    this.info = el(doc, 'div', 'px-modal-info');
    const close = el(doc, 'button', 'px-panel-close px-modal-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉');
    close.addEventListener('click', () => this.close());
    head.append(this.title, this.info, close);
    this.body = el(doc, 'div', 'px-panel-body');
    box.append(head, this.body);
    this.backdrop.append(box);
    // 點黑幕（視窗外面）關掉；點視窗裡面不要傳到地圖
    this.backdrop.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === this.backdrop) this.close();
    });
    this.backdrop.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.close();
    });
    parent.append(this.backdrop);
  }
  get isOpen(): boolean {
    return this.kind !== null;
  }
  /** V0.16：靠左或靠右停（黑幕變淡，看得到另一邊的遊戲畫面，例如她坐著吃東西）；null = 置中 */
  dock(side: 'left' | 'right' | null): void {
    if (side) this.backdrop.dataset.dock = side;
    else delete this.backdrop.dataset.dock;
  }
  /** 標題右邊的資訊（例如「🪙 3000」） */
  setInfo(text: string): void {
    this.info.textContent = text;
    this.info.hidden = !text;
  }
  open(kind: PanelKind, title: string, content: HTMLElement, onClose?: () => void): void {
    if (this.kind !== kind) {
      const prev = this.onClose;
      this.onClose = undefined;
      prev?.();
    }
    const doc = this.backdrop.ownerDocument;
    const fresh = this.kind !== kind;
    if (!this.kind) this.returnFocus = doc.activeElement;
    const hadFocus = !this.kind || this.backdrop.contains(doc.activeElement);
    this.kind = kind;
    this.onClose = onClose ?? this.onClose;
    this.title.textContent = title;
    this.box.dataset.kind = kind;
    this.backdrop.dataset.kind = kind;
    const keep = this.body.scrollTop;
    this.body.replaceChildren(content);
    if (!fresh) this.body.scrollTop = keep;
    this.backdrop.classList.add('show');
    if (hadFocus && !this.backdrop.contains(doc.activeElement)) this.box.focus({ preventScroll: true });
    if (fresh) this.onChange?.(kind);
  }
  close(): void {
    if (!this.kind) return;
    this.kind = null;
    this.dock(null);
    this.backdrop.classList.remove('show');
    this.body.replaceChildren(); // 關掉就清空，舊的按鈕不要留著
    const doc = this.backdrop.ownerDocument;
    if (this.backdrop.contains(doc.activeElement) || doc.activeElement === doc.body) {
      (this.returnFocus as HTMLElement | null)?.focus?.({ preventScroll: true });
    }
    this.returnFocus = null;
    const cb = this.onClose;
    this.onClose = undefined;
    cb?.();
    this.onChange?.(null);
  }
  dispose(): void {
    this.backdrop.remove();
  }
}

// ───────────── 揹包內容 ─────────────
export type BagTab = 'all' | 'food' | 'fish' | 'crop' | 'dish' | 'seed' | 'gear' | 'furniture' | 'other';
const TABS: [BagTab, string][] = [['all', '全部'], ['food', '吃的'], ['fish', '魚'], ['crop', '作物'], ['dish', '料理'], ['seed', '種子'], ['gear', '釣具'], ['furniture', '家具'], ['other', '其他']];
const CATEGORY_ORDER = ['dish', 'fish', 'crop', 'animal', 'seed', 'furniture', 'decor', 'equip', 'tool', 'feed', 'ore', 'gem', 'gift', 'monster', 'junk'];
const MAIN_TABS = ['fish', 'crop', 'seed', 'dish', 'furniture', 'decor', 'coin', 'gear', 'bait'];

export interface BagOptions {
  game: GameView;
  defs: GameplayDefs;
  tab: BagTab;
  selectedSeed?: ItemId;
  /** 正拿在手上、等著點田安裝的工具（灑水器） */
  heldTool?: ItemId;
  /** 使用中的魚竿、魚餌 */
  gear?: { rod: ItemId | null; bait: ItemId | null };
  /** 面板最下面的額外內容（設定、告白按鈕…） */
  footer?: HTMLElement;
  /** V0.7：選起來的食物：下面出現「餵她吃」按鈕 */
  selectedFood?: ItemId;
  onEat?(id: ItemId): void;
  onTab(tab: BagTab): void;
  onSlot(id: ItemId): void;
}

export function buildBag(doc: Document, o: BagOptions): HTMLElement {
  const root = el(doc, 'div', 'px-bag');
  const tabs = el(doc, 'div', 'px-tabs');
  for (const [t, name] of TABS) {
    const b = el(doc, 'button', `px-tab${t === o.tab ? ' on' : ''}`, name);
    b.type = 'button';
    b.addEventListener('click', () => o.onTab(t));
    tabs.append(b);
  }
  const slots = Object.entries(o.game.inventory)
    .filter(([id, n]) => n > 0 && id !== 'coin')
    .map(([id, n]) => ({ id, n, ...itemLabel(o.defs, id) }))
    .filter((s) => {
      const c = s.def?.category ?? 'other';
      if (o.tab === 'food') return !!s.def?.food; // V0.9：能餵她吃的（魚、作物、料理…）
      if (o.tab === 'furniture') return c === 'furniture' || c === 'decor';
      if (o.tab === 'gear') return c === 'gear' || c === 'bait';
      return o.tab === 'all' || (o.tab === 'other' ? !MAIN_TABS.includes(c) : c === o.tab);
    })
    .sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.def?.category ?? 'zzz');
      const cb = CATEGORY_ORDER.indexOf(b.def?.category ?? 'zzz');
      return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb) || a.name.localeCompare(b.name, 'zh-Hant');
    });
  const grid = el(doc, 'div', 'px-grid');
  for (const s of slots) {
    const picked = s.id === o.selectedSeed || s.id === o.heldTool || s.id === o.selectedFood;
    const b = el(doc, 'button', `px-slot${picked ? ' selected' : ''}`);
    b.type = 'button';
    const hint = s.def?.food ? '點一下選起來，再按下面的「餵她吃」' : s.def?.category === 'seed' ? `點一下選擇要種的種子。${s.def.description ?? ''}`
      : s.def?.place ? `點一下拿著，再點地圖擺放。${s.def.description ?? ''}` : s.def?.decor ? `點一下換掉這個房間的${s.def.decor.kind === 'floor' ? '地板' : '壁紙'}`
      : s.def?.equip ? `${s.def.description ?? ''}（揹包裡同類最強的會自動裝備）` : s.def?.description ?? '';
    b.title = `${s.name}${hint ? `：${hint}` : ''}`;
    b.append(slotIcon(doc, s.id, s.emoji), el(doc, 'span', 'px-slot-count', `×${s.n}`), el(doc, 'span', 'px-slot-name', s.name));
    if (s.id === o.selectedSeed) b.append(el(doc, 'span', 'px-slot-tag', '播種用'));
    if (s.id === o.heldTool) b.append(el(doc, 'span', 'px-slot-tag', '拿著'));
    if (s.id === o.gear?.rod || s.id === o.gear?.bait) {
      b.classList.add('selected');
      b.append(el(doc, 'span', 'px-slot-tag', '使用中'));
    }
    const r = s.def?.rarity;
    if (r && r !== 'common') b.classList.add(`rare-${r}`);
    b.addEventListener('click', () => o.onSlot(s.id));
    grid.append(b);
  }
  const empty = el(doc, 'div', 'px-empty', o.tab === 'seed' ? '沒有種子：去找池塘邊的旅行商人換吧！' : o.tab === 'food' ? '沒有能吃的東西：去釣魚或收成吧！' : '這裡空空的。去池塘釣魚吧！');
  // V0.7：選了食物 → 顯示它能恢復多少，和「餵她吃」按鈕
  const food = o.selectedFood ? o.defs.items.get(o.selectedFood) : undefined;
  let eatBar: HTMLElement | null = null;
  if (food?.food && (o.game.inventory[food.id] ?? 0) > 0) {
    const g = o.game;
    const stGain = food.food.stamina ?? Math.round(food.food.satiety * (o.defs.file.stats?.eat.staminaPerSatiety ?? 0));
    const full = g.satiety >= g.satietyMax && (g.stamina >= g.stats.staminaBase || stGain <= 0);
    eatBar = el(doc, 'div', 'px-eat');
    const info = el(doc, 'div', 'px-eat-info');
    info.append(el(doc, 'span', 'px-eat-name', `${food.emoji} ${food.name}`),
      el(doc, 'span', 'px-eat-gain', `🍙 +${food.food.satiety}${stGain > 0 ? `　⚡ +${stGain}` : ''}${food.food.affection > 0 ? `　❤ +${food.food.affection}` : ''}`));
    const b = el(doc, 'button', 'px-trade-btn px-eat-btn', full ? '她吃不下了' : '🍴 餵她吃');
    b.type = 'button';
    b.disabled = full;
    b.addEventListener('click', () => o.onEat?.(food.id));
    eatBar.append(info, b);
  }
  const hint = el(doc, 'div', 'px-hint', '點魚、作物、料理：選起來，再按「餵她吃」｜點種子：選擇要種的種子｜點魚竿、魚餌：換釣具｜點家具、灑水器：拿著，再點地圖');
  root.append(tabs, slots.length ? grid : empty);
  if (eatBar) root.append(eatBar);
  root.append(hint);
  if (o.footer) root.append(o.footer);
  return root;
}

// ───────────── 商人內容 ─────────────
export interface ShopOptions {
  shop: ShopDef;
  defs: GameplayDefs;
  inventory: Record<ItemId, number>;
  /** 現在的季節：換到的種子不是當季時會標出來 */
  season?: string;
  /** 今天的節慶：限定商品只在當天出現 */
  festival?: string;
  /** V0.6.2：商人 id 與今天每筆交換換了幾次（限量的會顯示「已售罄」） */
  shopId?: string;
  bought?: Record<string, number>;
  onTrade(trade: TradeDef): void;
}

export function buildShop(doc: Document, o: ShopOptions): HTMLElement {
  const root = el(doc, 'div', 'px-shop');
  if (o.shop.greeting) root.append(el(doc, 'div', 'px-greeting', o.shop.greeting));
  const list = el(doc, 'div', 'px-trades');
  const fmt = (m: Record<ItemId, number>, showOwned: boolean) =>
    Object.entries(m).map(([id, n]) => {
      const it = itemLabel(o.defs, id);
      const owned = o.inventory[id] ?? 0;
      const crop = o.defs.cropBySeed.get(id);
      const off = !showOwned && crop?.seasons && o.season && !crop.seasons.includes(o.season);
      const when = off ? `（${crop.seasons!.map((s) => o.defs.file.calendar?.seasons.find((x) => x.id === s)?.name ?? s).join('、')}季才能種）` : '';
      return `${it.emoji} ${it.name} ×${n}${showOwned ? `（有 ${owned}）` : ''}${when}`;
    }).join('、');
  for (const t of o.shop.trades) {
    if (t.festival && t.festival !== o.festival) continue;
    if (t.seasons && o.season && !t.seasons.includes(o.season)) continue; // 只賣當季
    // 按鈕的狀態：已售罄 > 金幣不足 > 材料不足 > 可以換
    const used = o.bought?.[`${o.shopId}:${t.id}`] ?? 0;
    const soldOut = t.dailyLimit !== undefined && used >= t.dailyLimit;
    const short = Object.entries(t.give).filter(([id, n]) => (o.inventory[id] ?? 0) < n).map(([id]) => id);
    const can = !soldOut && !short.length;
    const label = soldOut ? '已售罄' : short.includes('coin') ? '金幣不足' : short.length ? '材料不足' : (o.shop.verb ?? '交換');
    const row = el(doc, 'div', `px-trade${can ? '' : ' disabled'}${soldOut ? ' sold-out' : ''}`);
    row.append(el(doc, 'span', 'px-give', fmt(t.give, true)), el(doc, 'span', 'px-arrow', '→'), el(doc, 'span', 'px-get', `${t.festival ? '🎉 ' : ''}${fmt(t.get, false)}${t.dailyLimit !== undefined ? `（每天限 ${t.dailyLimit}，剩 ${Math.max(0, t.dailyLimit - used)}）` : ''}`));
    const b = el(doc, 'button', 'px-trade-btn', label);
    b.type = 'button';
    b.disabled = !can;
    if (t.dailyLimit !== undefined && !soldOut) b.title = `今天還剩 ${t.dailyLimit - used} 個`;
    b.addEventListener('click', () => o.onTrade(t));
    row.append(b);
    list.append(row);
  }
  root.append(list);
  return root;
}

// ───────────── 魚類圖鑑 ─────────────
const PHASE_NAME: Record<string, string> = { morning: '早上', afternoon: '下午', evening: '傍晚', night: '晚上' };

/** 把掉落條件寫成人話：「夏」「雨天」「傍晚、晚上」；沒有條件就是隨時 */
export function lootHint(e: LootEntry, defs: GameplayDefs): string {
  const parts: string[] = [];
  if (e.seasons) parts.push(e.seasons.map((id) => defs.file.calendar?.seasons.find((s) => s.id === id)?.name ?? id).join('、') + '季');
  if (e.weather) parts.push(e.weather.map((w) => (w === 'rainy' ? '雨天' : '晴天')).join('、'));
  if (e.phases) parts.push(e.phases.map((p) => PHASE_NAME[p] ?? p).join('、'));
  if (e.minAffection) parts.push(`好感 ${e.minAffection} 以上`);
  return parts.join('・') || '隨時';
}

export function buildCodex(doc: Document, o: { defs: GameplayDefs; caught: Record<ItemId, number>; claimed?: string[] }): HTMLElement {
  const root = el(doc, 'div', 'px-codex');
  const fish = o.defs.file.items.filter((i) => i.category === 'fish');
  const found = fish.filter((i) => o.caught[i.id]).length;
  root.append(el(doc, 'div', 'px-greeting', `已發現 ${found} / ${fish.length} 種${found === fish.length && fish.length ? '　🎉 全部收集完成！' : ''}`));
  const grid = el(doc, 'div', 'px-codex-grid');
  const entries = Object.values(o.defs.file.fishing.tables).flat();
  for (const it of fish) {
    const n = o.caught[it.id] ?? 0;
    const hints = [...new Set(entries.filter((e) => e.item === it.id).map((e) => lootHint(e, o.defs)))];
    const where = hints.includes('隨時') ? '隨時' : hints.join(' 或 ');
    const r = it.rarity ?? 'common';
    const card = el(doc, 'div', `px-codex-card${n ? '' : ' unknown'} rare-${r}`);
    const rr = o.defs.file.fishing.rarities?.[r];
    const tag = el(doc, 'span', 'px-rarity', rr?.name ?? '');
    if (rr) tag.style.color = rr.color;
    card.append(
      n ? slotIcon(doc, it.id, it.emoji) : el(doc, 'span', 'px-slot-emoji', '❓'),
      el(doc, 'span', 'px-codex-name', n ? it.name : '？？？'),
      tag,
      el(doc, 'span', 'px-codex-where', where),
      el(doc, 'span', 'px-codex-count', n ? `釣到 ${n} 次` : '還沒釣到'),
    );
    if (n && it.description) card.title = it.description;
    grid.append(card);
  }
  root.append(grid);
  // 收集獎勵：每一組的進度
  const cols: CollectionDef[] = o.defs.file.collections ?? [];
  if (cols.length) {
    root.append(el(doc, 'div', 'px-subtitle', '🎁 收集獎勵'));
    const list = el(doc, 'div', 'px-trades');
    for (const c of cols) {
      const have = c.items.filter((i) => o.caught[i]).length;
      const done = o.claimed?.includes(c.id);
      const reward = Object.entries(c.reward).map(([id, n]) => `${itemLabel(o.defs, id).emoji} ${itemLabel(o.defs, id).name} ×${n}`).join('、');
      const r = el(doc, 'div', `px-trade${done ? '' : ' disabled'}`);
      r.append(el(doc, 'span', 'px-give', `${done ? '✅' : '⬜'} ${c.name}`),
        el(doc, 'span', 'px-get', `${c.items.map((i) => (o.caught[i] ? itemLabel(o.defs, i).emoji : '❓')).join('')}（${have}/${c.items.length}）`),
        el(doc, 'span', 'px-get', `獎勵：${reward}`));
      list.append(r);
    }
    root.append(list);
  }
  return root;
}
