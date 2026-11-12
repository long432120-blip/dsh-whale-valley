// DSH 客戶端入口（package.json 的 exports["./client"] 指向這裡打包後的檔案）。
// 像素版渲染器；角色包在打包時整個內嵌（清單在 pixel/bundled-pack.ts）。
//
// 已對照實機 DSH 0.2.1-rc.5 確認：
//   1. 槽位名稱 'shell.overlay' 確實存在（dsh-client-ui-chat / -layout / -schedule 等 8 個官方套件在用）
//   2. slots 服務由 @deepseek-ai/dsh-client-ui-renderer 提供（super(ctx, 'slots')）
//   3. 正確寫法是先 ctx.slots.inject(key, () => ...) 再 register，
//      這樣槽位還沒宣告時會等它宣告，而不是直接失敗
//   4. package.json 的 dsh.client.inject 要列 @deepseek-ai/dsh-client-ui-layout
//      （原本寫的 @deepseek-ai/dsh-client-ui-slots 這個套件不存在）
//
// V0.24：不再用浮層，改成「左側欄入口＋中央面板」：
//   - sidebar.panellist（id 'whale-valley'）→ 左側欄多一顆鯨魚圖示
//   - main（key 'whale-valley'）→ 點圖示後中央欄顯示啟動卡（▶ 全螢幕 / 🪟 開新視窗）
//   DSH 的側欄按鈕把「跟 id 同名的 main key」當成目的面板，所以兩個字串要一致。
//
// V0.25：點側欄就是「打開遊戲」——直接開獨立視窗（host 的 /play 頁），DSH 完全不被遮住：
//   - 中央面板只放狀態卡（mode: 'window'），建立時 autoOpen
//   - 被瀏覽器擋掉彈出視窗時，卡片上會說明，按鈕仍然可按
//   - 全螢幕那一套還留在 launcher.ts（mode: 'both' / 'fullscreen'），只是 DSH 這邊不用了
import { useEffect, useRef } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import { createDshBridge, fetchTransport } from './bridge-dsh.ts';
import { bundledPack } from './pixel/bundled-pack.ts';
import { loadPixelPack } from './pixel/pack-loader.ts';
import { mountGame } from './game-shell.ts';
import { i18n, t } from './i18n.ts';
import { createLauncher, type LauncherOptions, type WindowOpenResult } from './launcher.ts';

const source = bundledPack;

export const name = 'dsh-whale-valley-client';
export const inject = ['slots'] as const;

/** slots 服務的最小介面（宿主沒有出貨 .d.ts） */
interface SlotsService {
  inject(key: string, callback: () => unknown): () => void;
  register(
    spec: {
      name: string;
      /** 列表槽位（sidebar.panellist…）的項目 id */
      id?: string;
      /** keyed 槽位（main…）的 key */
      key?: string;
      order?: number;
      label?: string | (() => string);
    },
    component: unknown,
  ): () => void;
}

/** 左側欄的入口 id；同時是 main 面板的 key，兩邊要一樣 DSH 才會把按鈕對到面板 */
const PANEL_ID = 'whale-valley';

const API = '/api/dsh-whale-valley';

/**
 * V0.25：請 host 用系統瀏覽器開一個獨立視窗。
 * DSH 桌面版（Electron）的 setWindowOpenHandler 會 deny 所有 window.open，
 * 所以這件事只能由 host 做（src/host/open-window.ts）。
 */
async function openStandaloneWindow(force: boolean): Promise<WindowOpenResult> {
  try {
    const res = await fetch(`${API}/open-window`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { ok?: boolean; alreadyOpen?: boolean; mode?: string; browser?: string; url?: string };
    if (data.alreadyOpen) return { ok: true, note: t('launch.windowOpen') };
    if (data.ok) {
      return {
        ok: true,
        note: data.mode === 'app' ? t('launch.windowOpened', { browser: data.browser ?? 'Chrome' }) : t('launch.windowOpenedBrowser'),
      };
    }
    return { ok: false, note: t('launch.windowFailed', { url: data.url ?? `${API}/play` }) };
  } catch {
    // host 沒有這條路由（舊版）或網路怪怪的：退回 window.open，純瀏覽器的 DSH 可以通
    const win = window.open(`${API}/play`, 'WhaleValley', 'width=1280,height=900');
    return win ? { ok: true, note: t('launch.windowOpenedBrowser') } : { ok: false, note: t('launch.windowFailed', { url: `${API}/play` }) };
  }
}

/** 第一次（點側欄自動開）不強制；之後按卡片上的按鈕就強制再開一次 */
function createWindowOpener(): () => Promise<WindowOpenResult> {
  let attempted = false;
  return () => {
    const force = attempted;
    attempted = true;
    return openStandaloneWindow(force);
  };
}

let packP: ReturnType<typeof loadPixelPack> | null = null;
/** 角色包只載一次（啟動卡、全螢幕、重開遊戲都共用） */
function pack() {
  // V0.22.1：音樂由 host 的通道提供（DSH 沒有 /music/ 這條路由）
  packP ??= loadPixelPack(source, { musicBase: `${API}/music/` });
  return packP;
}

/** 把遊戲掛到 el（DSH 的存檔，走 host 的通道）；按「🚪 結束遊戲」時呼叫 onExit */
async function mountDshGame(el: HTMLElement, onExit: () => void) {
  return mountGame(el, {
    pack: await pack(),
    // 通道：POST /api/dsh-whale-valley/<method>（host 端在 src/host/index.ts 註冊）
    bridge: createDshBridge(fetchTransport()),
    pollMs: 30_000,
    onExit,
  });
}

/**
 * 左側欄的鯨魚圖示。
 * DSH 傳進來的 props 是 { size: number; active: boolean }（SidebarPanelIconOwnerProps）；
 * 線條用 currentColor，顏色交給左側欄依選取狀態決定，不寫死。
 */
function WhaleIcon(props: { size?: number; active?: boolean }) {
  const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      {/* 身體 */}
      <path d="M3 13.6a4 4 0 0 1 4-4h6.6a4 4 0 0 1 0 8H7a4 4 0 0 1-4-4Z" />
      {/* 尾鰭 */}
      <path d="M17.6 12.4 21.2 9v7Z" />
      {/* 眼睛 */}
      <circle cx="7.2" cy="12.6" r="1.05" fill="currentColor" stroke="none" />
      {/* 噴水 */}
      <path d="M8.6 9.4c0-1.9.9-3.2 2.6-3.9" />
      <path d="M13.4 9.4c.2-1.4-.2-2.5-1.1-3.2" />
    </svg>
  );
}

/**
 * 中央面板：點側欄就等於「打開遊戲」。
 * V0.25：直接開獨立視窗（host 的 /play 頁），DSH 的畫面完全不會被蓋住；
 * 卡片只顯示狀態，被瀏覽器擋掉彈出視窗時才需要按按鈕。
 */
function WhaleValleyPanel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return mountDshLauncher(el, { variant: 'panel', mode: 'window', autoOpen: true });
  }, []);
  return (
    <div
      className="whale-panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        minHeight: '100%',
        boxSizing: 'border-box',
        padding: '24px 16px',
        overflow: 'auto',
      }}
    >
      <div ref={ref} style={{ width: '100%', maxWidth: '560px' }} />
    </div>
  );
}

export interface LauncherMountOptions {
  variant?: LauncherOptions['variant'];
  mode?: LauncherOptions['mode'];
  /** 建立時直接開獨立視窗（點側欄那一下） */
  autoOpen?: boolean;
}

/** 啟動卡掛到 el；回傳拆除函式（面板卸載時呼叫）。也 export 出來給測試頁用 */
export function mountDshLauncher(el: HTMLElement, opts: LauncherMountOptions = {}): () => void {
  const launcher = createLauncher(el, {
    mountGame: mountDshGame,
    windowUrl: `${API}/play`,
    variant: opts.variant ?? 'card',
    mode: opts.mode,
    autoOpen: opts.autoOpen,
    // V0.25：DSH 桌面版會擋 window.open，改成請 host 用系統瀏覽器開 app 視窗
    openWindow: opts.mode === 'window' || opts.mode === undefined ? createWindowOpener() : undefined,
    // 選了簡體只轉插件自己的區塊（啟動卡、全螢幕容器），不動 DSH 的介面
    onRoot: (root) => i18n().install(document, root, { title: false }),
  });
  // 只在「會在 DSH 頁面裡玩」的模式下先預熱角色包；開獨立視窗時那份由視窗自己載
  if (opts.mode !== 'window') {
    void pack().catch((err) => console.error('[whale-pet] 角色包載入失敗', err));
  }
  return () => launcher.dispose();
}

/**
 * V0.23 模式 B：host 的遊戲頁（GET /api/dsh-whale-valley/play）載入這個 client.js 後呼叫這裡。
 * 跟 DSH 裡是同一份存檔；選單的「🚪 結束遊戲」關掉這個視窗。
 */
export async function bootWindowGame(el: HTMLElement): Promise<void> {
  i18n().install(document, document.body, { title: true });
  await mountDshGame(el, () => window.close());
}

export function apply(ctx: Context) {
  const slots = (ctx as unknown as { slots: SlotsService }).slots;

  // 中央面板：key 跟左側欄 id 相同，DSH 按下側欄圖示就換到這裡
  slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, WhaleValleyPanel));

  // 左側欄圖示：label 傳函式，切換語言時 DSH 會重讀，不用重新註冊
  // （圖示已經畫了鯨魚，label 不用再帶 🐋）
  slots.inject('sidebar.panellist', () =>
    slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: () => t('launch.label'),
      },
      (props: { size?: number; active?: boolean }) => <WhaleIcon size={props.size} active={props.active} />,
    ),
  );
}
