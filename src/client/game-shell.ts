// V0.22：畫面外殼。負責「在自己家」和「在朋友家」之間切換（狀態機說明在 visit.ts），
// 還有跨畫面共用的東西：聊天室、語言。單機版和 DSH 版都用這個掛畫面。
import { ChatService } from './chat.ts';
import { i18n } from './i18n.ts';
import { decodeInvite, VisitBridge } from './visit.ts';
import { mountPixelStage, type PixelStageHandle, type PixelStageOptions } from './pixel/pixel-stage.ts';
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
  };

  const mount = (bridge: HostBridge) =>
    mountPixelStage(root, {
      ...opts,
      bridge,
      shell: api,
      onView: (v) => {
        if (bridge === home && v.game?.social?.nick) nick = v.game.social.nick;
        opts.onView?.(v);
      },
    });

  async function swap(bridge: HostBridge, next: ShellMode) {
    switching = true;
    try {
      current.dispose();
      mode = next;
      try {
        current = await mount(bridge);
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
  return {
    get mode() { return mode; },
    goto: (id, spawn) => current.goto(id, spawn),
    say: (trigger: LineTrigger) => current.say(trigger),
    visit: () => current.visit(),
    refresh: () => current.refresh(),
    dispose() {
      chat?.dispose();
      current.dispose();
    },
  };
}
