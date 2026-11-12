// V0.23：DSH 版的「啟動器」：浮層裡只放一張小卡片，遊戲在獨立的畫面裡玩。
//
//   模式 A（▶ 啟動遊戲）：在 <body> 最外層蓋一層全螢幕容器（position:fixed、z-index:9999、100vw×100vh），
//                        遊戲畫在裡面；右上角「❌ 關閉遊戲」或選單的「🚪 結束遊戲」就拆掉，回到 DSH。
//   模式 B（🪟 開新視窗玩）：window.open(host 提供的遊戲頁, 'WhaleValley', 'width=1280,height=720,…')，
//                        同一份存檔（走 host 的通道）；選單的「🚪 結束遊戲」會關掉那個視窗。
//
// 不跟 DSH 樣式打架：
//   - 只用 whale- 開頭的 class，樣式全部寫在元素自己身上（inline）或 px- 開頭的遊戲樣式
//   - 不動 DSH 的任何元素；全螢幕時只暫時把 <html> 的捲動關掉，關閉時還原
//   - 全螢幕容器掛在 <body> 最後面，關閉時整個移除，計時器、事件、音樂都跟著遊戲 dispose
import { t } from './i18n.ts';

export interface GameHandle {
  dispose(): void;
}

/** 「開獨立視窗」的結果；note 會直接顯示在卡片上 */
export interface WindowOpenResult {
  ok: boolean;
  note?: string;
}

export interface LauncherOptions {
  /** 把遊戲掛到 el；遊戲裡按「結束遊戲」時呼叫 onExit */
  mountGame(el: HTMLElement, onExit: () => void): Promise<GameHandle>;
  /** 模式 B 的遊戲頁網址；沒給就不顯示「開新視窗」 */
  windowUrl?: string;
  /** 每次新開出來的區塊（啟動卡、全螢幕容器）都會呼叫，例如裝上簡體轉換 */
  onRoot?(el: HTMLElement): void;
  /**
   * V0.24：卡片放哪裡。
   *   'card'（預設）：原本浮層裡的小卡片，貼著內容。
   *   'panel'：DSH 左側欄入口打開的中央面板，卡片放大、寬度跟著面板。
   */
  variant?: 'card' | 'panel';
  /**
   * V0.25：卡片提供哪些玩法。
   *   'both'（預設）：全螢幕＋獨立視窗兩顆按鈕（V0.23／V0.24 的行為）。
   *   'window'：只提供獨立視窗（DSH 的用法：不蓋住 DSH 的畫面）。
   *   'fullscreen'：只提供全螢幕。
   */
  mode?: 'both' | 'window' | 'fullscreen';
  /** V0.25：建立時直接開獨立視窗（由點側欄那一下引起，瀏覽器不會擋） */
  autoOpen?: boolean;
  /**
   * V0.25：自訂「開獨立視窗」的方法。
   * 沒給就用 `window.open(windowUrl)`；DSH 桌面版（Electron）會拒絕 window.open，
   * 所以 DSH 版是由 host 用系統瀏覽器開（見 src/host/open-window.ts）。
   */
  openWindow?(): WindowOpenResult | Promise<WindowOpenResult>;
}

export interface LauncherHandle {
  /** 模式 A：打開全螢幕遊戲 */
  openFullscreen(): Promise<void>;
  closeFullscreen(): void;
  /** 模式 B：開獨立視窗；失敗回傳 false */
  openWindow(): Promise<boolean>;
  readonly fullscreenOpen: boolean;
  dispose(): void;
}

const WINDOW_FEATURES = 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no';

function css(el: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
  Object.assign(el.style, styles);
}

function bigButton(doc: Document, text: string, primary: boolean, onClick: () => void, big = false): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = text;
  css(b, {
    font: big
      ? '700 16px/1.2 system-ui, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif'
      : '700 15px/1.2 system-ui, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
    padding: big ? '12px 22px' : '9px 16px',
    borderRadius: '8px',
    border: '3px solid #6b3f22',
    background: primary ? '#ffd86b' : '#fff3d6',
    color: '#2a1a10',
    cursor: 'pointer',
    boxShadow: '0 3px 0 rgba(0,0,0,.3)',
  });
  b.addEventListener('click', onClick);
  return b;
}

export function createLauncher(root: HTMLElement, opts: LauncherOptions): LauncherHandle {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const panel = opts.variant === 'panel';
  const mode = opts.mode ?? 'both';
  const windowOnly = mode === 'window';
  const showsFullscreen = mode !== 'window';
  const showsWindow = mode !== 'fullscreen' && (!!opts.windowUrl || !!opts.openWindow);
  let layer: HTMLDivElement | null = null;
  let game: GameHandle | null = null;
  let opening = false;
  let popup: Window | null = null;
  let savedOverflow = '';

  // ── 啟動卡（浮層小卡／中央面板的大卡） ──
  const card = doc.createElement('div');
  card.className = 'whale-launcher';
  css(card, panel ? {
    display: 'grid', gap: '14px', padding: '22px 26px', boxSizing: 'border-box',
    width: 'min(560px, 100%)', maxWidth: '100%',
    background: '#2d2238', border: '3px solid #6b3f22', borderRadius: '16px', boxShadow: '0 10px 30px rgba(0,0,0,.4)',
    color: '#fff3d6', font: '15px/1.5 system-ui, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
  } : {
    display: 'grid', gap: '10px', padding: '14px 16px', width: 'max-content', maxWidth: '92vw',
    background: '#2d2238', border: '3px solid #6b3f22', borderRadius: '12px', boxShadow: '0 6px 18px rgba(0,0,0,.35)',
    color: '#fff3d6', font: '14px/1.4 system-ui, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
  });
  const title = doc.createElement('div');
  title.textContent = t('launch.title');
  css(title, panel ? { fontWeight: '800', fontSize: '22px', lineHeight: '1.25' } : { fontWeight: '800', fontSize: '17px' });
  const sub = doc.createElement('div');
  sub.textContent = t(windowOnly ? 'launch.subWindow' : 'launch.sub');
  css(sub, { opacity: '.85', fontSize: panel ? '14px' : '13px' });
  const row = doc.createElement('div');
  css(row, { display: 'flex', gap: '8px', flexWrap: 'wrap' });
  const note = doc.createElement('div');
  css(note, { fontSize: '12.5px', color: '#ffd86b', display: 'none' });
  const playBtn = showsFullscreen
    ? bigButton(doc, t('launch.play'), !windowOnly, () => void handle.openFullscreen(), panel)
    : null;
  const windowBtn = showsWindow
    ? bigButton(doc, t(windowOnly ? 'launch.openWindow' : 'launch.window'), windowOnly, () => void handle.openWindow(), panel)
    : null;
  if (playBtn) row.append(playBtn);
  if (windowBtn) row.append(windowBtn);
  card.append(title, sub, row, note);
  root.append(card);
  opts.onRoot?.(card);

  const showNote = (text: string) => {
    note.textContent = text;
    note.style.display = text ? 'block' : 'none';
  };

  const handle: LauncherHandle = {
    get fullscreenOpen() { return !!layer; },

    async openFullscreen() {
      if (layer || opening) return;
      opening = true;
      showNote('');
      // 最外層的全螢幕容器
      layer = doc.createElement('div');
      layer.className = 'whale-fs-layer';
      layer.setAttribute('role', 'dialog');
      layer.setAttribute('aria-modal', 'true');
      layer.setAttribute('aria-label', t('launch.title'));
      css(layer, {
        position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '9999',
        background: 'radial-gradient(ellipse at 50% 30%, #3a2c4d 0%, #1d1528 70%)',
        overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', padding: '48px 16px 16px',
      });
      const close = bigButton(doc, t('launch.close'), false, () => handle.closeFullscreen());
      close.className = 'whale-fs-close';
      css(close, { position: 'fixed', top: '10px', right: '14px', zIndex: '10000' });
      const inner = doc.createElement('div');
      inner.className = 'whale-fs-game';
      css(inner, { width: 'min(1320px, 96vw)', margin: 'auto' });
      layer.append(inner, close);
      doc.body.append(layer);
      savedOverflow = doc.documentElement.style.overflow;
      doc.documentElement.style.overflow = 'hidden';
      opts.onRoot?.(layer);
      try {
        const g = await opts.mountGame(inner, () => handle.closeFullscreen());
        if (!layer) g.dispose(); // 載入中就被關掉了
        else game = g;
      } catch (err) {
        console.error('[whale-pet] 啟動遊戲失敗', err);
        handle.closeFullscreen();
      } finally {
        opening = false;
      }
    },

    closeFullscreen() {
      try { game?.dispose(); } catch (err) { console.warn('[whale-pet] 關閉遊戲時出錯', err); }
      game = null;
      layer?.remove();
      layer = null;
      doc.documentElement.style.overflow = savedOverflow;
      (playBtn ?? windowBtn)?.focus({ preventScroll: true });
    },

    async openWindow() {
      // 交給外面開（DSH 版：host 用系統瀏覽器開 app 視窗）
      if (opts.openWindow) {
        let result: WindowOpenResult;
        try {
          result = await opts.openWindow();
        } catch (err) {
          console.warn('[whale-pet] 開視窗失敗', err);
          result = { ok: false };
        }
        showNote(result.note ?? (result.ok ? t('launch.inWindow') : t('launch.popupBlocked')));
        return result.ok;
      }
      if (!opts.windowUrl) return false;
      if (popup && !popup.closed) {
        popup.focus();
        showNote(t('launch.inWindow'));
        return true;
      }
      // 同一份存檔不要兩邊一起玩：全螢幕開著就先關掉
      if (layer) handle.closeFullscreen();
      popup = win.open(opts.windowUrl, 'WhaleValley', WINDOW_FEATURES);
      if (!popup) {
        showNote(t('launch.popupBlocked'));
        return false;
      }
      showNote(t('launch.inWindow'));
      return true;
    },

    dispose() {
      handle.closeFullscreen();
      card.remove();
    },
  };
  // V0.25：點側欄就等於「打開遊戲」——直接開獨立視窗。
  // 這裡還在同一次使用者點擊的有效期內，瀏覽器不會擋；真的被擋會顯示提示，按鈕仍然可按。
  if (opts.autoOpen && showsWindow) void handle.openWindow();
  return handle;
}
