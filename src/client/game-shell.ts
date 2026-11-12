// V0.22：畫面外殼。負責「在自己家」和「在朋友家」之間切換（狀態機說明在 visit.ts），
// 還有跨畫面共用的東西：聊天室、語言。單機版和 DSH 版都用這個掛畫面。
import { ChatService } from './chat.ts';
import { isDevMode } from './dev-flag.ts';
import { i18n } from './i18n.ts';
import { decodeInvite, VisitBridge } from './visit.ts';
import { mountPixelStage, type PixelStageHandle, type PixelStageOptions } from './pixel/pixel-stage.ts';
import { buildGoodbye } from './pixel/ui-menu.ts';
import type { GameplayFile } from '../shared/gameplay-types.ts';
import type { HostBridge, LineTrigger } from '../shared/types.ts';

export type ShellMode = 'home' | 'visiting';

export interface ShellApi {
  readonly mode: ShellMode;
  readonly chat: ChatService | null;
  /** 輸入邀請碼 → 去朋友家；失敗回傳給玩家看的原因 */
  visit(code: string, me: { id: string; nick: string }): Promise<{ ok: true } | { ok: false; message: string }>;
  /** 回自己家（讀回原本的存檔） */
  goHome(): Promise<void>;
  /** V0.23：讀檔、開新遊戲後，用新的存檔把整個畫面重開一次（toast：開好後顯示的提示） */
  reload(toast?: string): Promise<void>;
  /** V0.23：結束遊戲（外面給了 onExit 就交給它；沒有就顯示「已經存好檔，可以關掉了」） */
  exit(): void;
}

export interface GameShellHandle extends PixelStageHandle {
  readonly mode: ShellMode;
}

const INVITE_ERRORS: Record<string, string> = {
  format: 'invite.bad', kind: 'invite.wrongKind', checksum: 'invite.bad', json: 'invite.bad', too_long: 'invite.bad',
  shape: 'invite.bad', expired: 'invite.expired', own: 'invite.own',
};

export async function mountGame(root: HTMLElement, opts: PixelStageOptions): Promise<GameShellHandle> {
  const home: HostBridge = opts.bridge;
  let file: GameplayFile | null = null;
  try { file = await home.gameplay(); } catch { file = null; }
  const social = file?.social ?? null;
  let nick = social?.nick.default ?? '主人';
  const chat = social ? new ChatService(social.chat, { nick: () => nick }) : null;
  let mode: ShellMode = 'home';
  let current: PixelStageHandle;
  let switching = false;
  let ended = false;

  const api: ShellApi = {
    get mode() { return mode; },
    chat,
    async visit(code, me) {
      if (!social || !file) return { ok: false, message: i18n().t('invite.unsupported') };
      if (switching) return { ok: false, message: i18n().t('invite.busy') };
      const r = await decodeInvite(code, social.salt, social.visit.codeDays, me.id).catch(() => ({ ok: false as const, reason: 'format' as const }));
      if (!r.ok) return { ok: false, message: i18n().t(INVITE_ERRORS[r.reason] ?? 'invite.bad') };
      let vb: VisitBridge;
      try {
        vb = new VisitBridge(r.payload, file, me, social.salt);
      } catch {
        return { ok: false, message: i18n().t('invite.bad') };
      }
      try {
        await swap(vb, 'visiting');
      } catch {
        return { ok: false, message: i18n().t('invite.bad') };
      }
      return { ok: true };
    },
    async goHome() {
      if (mode === 'home') return;
      await swap(home, 'home');
    },
    async reload(toast) {
      await swap(home, 'home', toast);
    },
    exit() {
      if (opts.onExit) return opts.onExit();
      // 單機版：瀏覽器不讓網頁關掉使用者自己開的分頁，就把遊戲停掉、顯示「可以關掉了」
      if (switching) return;
      current.dispose();
      chat?.stopAmbient();
      ended = true;
      root.replaceChildren(buildGoodbye(root.ownerDocument, () => {
        ended = false;
        root.replaceChildren();
        void mount(home).then((h) => { current = h; mode = 'home'; });
      }));
    },
  };

  const mount = (bridge: HostBridge, toast?: string) =>
    mountPixelStage(root, {
      ...opts,
      bridge,
      shell: api,
      toast,
      onView: (v) => {
        if (bridge === home && v.game?.social?.nick) nick = v.game.social.nick;
        opts.onView?.(v);
      },
    });

  async function swap(bridge: HostBridge, next: ShellMode, toast?: string) {
    switching = true;
    try {
      current.dispose();
      mode = next;
      try {
        current = await mount(bridge, toast);
      } catch (err) {
        // 朋友的農場打不開（例如快照裡有這個版本畫不出來的東西）：直接回家，不讓畫面空白
        console.warn('[whale-pet] 拜訪失敗，回到自己家', err);
        mode = 'home';
        current = await mount(home);
        if (bridge !== home) throw err;
      }
    } finally {
      switching = false;
    }
  }

  current = await mount(home);
  // 開發者模式：網址帶 ?dev&chat=ws://127.0.0.1:8790 就自動連聊天伺服器（npm run chat:server）
  const auto = isDevMode() ? new URLSearchParams(root.ownerDocument.defaultView?.location.search ?? '').get('chat') : null;
  if (chat && auto) void chat.connectToServer(auto);
  return {
    get mode() { return mode; },
    goto: (id, spawn) => current.goto(id, spawn),
    say: (trigger: LineTrigger) => current.say(trigger),
    visit: () => current.visit(),
    refresh: () => current.refresh(),
    dispose() {
      chat?.dispose();
      if (!ended) current.dispose();
    },
  };
}
