// V0.22：非同步串門
//
// 狀態機（GameShell 負責切換）：
//
//     ┌──────── HOME ────────┐   輸入邀請碼（校驗碼、格式、期限都過）    ┌────── VISITING ──────┐
//     │ bridge = 你的存檔    │ ─────────────────────────────────────▶ │ bridge = VisitBridge  │
//     │ （LocalBridge／DSH） │ ◀───────────────────────────────────── │ （記憶體裡的唯讀副本） │
//     └──────────────────────┘          🏠 回家（或重新整理頁面）       └───────────────────────┘
//
// 隔離方式：
//   - 進入拜訪時，把現在的畫面整個拆掉（dispose），用 VisitBridge 重新掛一個新的畫面；回家時再拆掉、用原本的 bridge 掛回來。
//   - VisitBridge 完全不碰 localStorage，也不打 host；朋友的農場只活在記憶體裡，關掉就沒了。
//   - 你的存檔在拜訪期間完全不會被讀寫；拜訪狀態也不存檔（重新整理就回到自己家）。
//   - 在朋友家只能：點她說話、走來走去換地圖、幫忙澆水；買賣、收成、釣魚、擺家具……一律回 'visitor'。
//   - 澆過的田、寫的信打包成「回信碼」，朋友兌換後才會真的寫進他的存檔（他那邊的規則會再檢查一次）。
import { decodeCodeAsync, encodeCode, encodeCodeAsync, type DecodeError } from '../shared/codec.ts';
import { buildDefs, normalizeGame } from '../shared/gameplay.ts';
import type { GameAction, GameplayDefs, GameplayFile, PlotId } from '../shared/gameplay-types.ts';
import * as rules from '../shared/state.ts';
import { cleanName, fresh, type ReplyPayload, type VisitPayload } from '../shared/trade.ts';
import type { ActResult, HostBridge, PetSave, PetView, SceneId } from '../shared/types.ts';

/** 訪客可以做的動作 */
const VISITOR_ACTIONS = new Set<GameAction['type']>(['water']);

export interface VisitInfo {
  /** 被拜訪的人 */
  from: string;
  nick: string;
  at: number;
  /** 拜訪的人（自己） */
  me: { id: string; nick: string };
}

/** 邀請碼 → 農場快照（壓縮＋校驗碼）。payload 由 host 的 visit_snapshot 動作產生 */
export function encodeInvite(payload: VisitPayload, salt: string): Promise<string> {
  return encodeCodeAsync('visit', payload, salt);
}

export type InviteResult = { ok: true; payload: VisitPayload } | { ok: false; reason: DecodeError | 'expired' | 'own' | 'shape' };

/** 驗證邀請碼：校驗碼、期限、內容形狀；不能拜訪自己 */
export async function decodeInvite(code: string, salt: string, days: number, myId: string, now = Date.now()): Promise<InviteResult> {
  const d = await decodeCodeAsync<VisitPayload>(code, salt, 'visit');
  if (!d.ok) return d;
  const p = d.payload;
  if (!p || p.v !== 1 || typeof p.from !== 'string' || typeof p.at !== 'number' || typeof p.game !== 'object' || !p.game) return { ok: false, reason: 'shape' };
  if (!fresh(p.at, now, days)) return { ok: false, reason: 'expired' };
  if (p.from === myId) return { ok: false, reason: 'own' };
  return { ok: true, payload: { ...p, nick: cleanName(p.nick, 12) || '朋友', scene: typeof p.scene === 'string' ? p.scene : 'garden' } };
}

export class VisitBridge implements HostBridge {
  readonly visiting: VisitInfo;
  private save: PetSave;
  private readonly defs: GameplayDefs;
  private readonly watered = new Set<PlotId>();

  constructor(payload: VisitPayload, private readonly file: GameplayFile, me: { id: string; nick: string }, private readonly salt: string, private readonly clock: () => number = Date.now) {
    this.defs = buildDefs(file);
    const now = clock();
    // 快照經過 normalizeGame：壞掉的欄位補預設、不認得的東西丟掉（防惡意邀請碼）；揹包是空的
    const game = normalizeGame({ ...payload.game, lastTickAt: payload.at, inventory: {}, quest: { chain: null, step: 0, progress: 0, done: {}, nagAt: 0, last: null } }, now, this.defs);
    // 只看不玩：關掉任務、願望、日記這些會「替訪客」產生東西的系統
    this.save = { version: 2, sceneId: payload.scene, createdAt: payload.at, lastTickAt: payload.at, lastSeenAt: now, pokes: 0, game: { ...game, wish: null } };
    this.visiting = { from: payload.from, nick: payload.nick, at: payload.at, me };
  }

  private now() { return this.clock(); }
  private view(now = this.now()): PetView {
    return rules.toView(this.save, now, 0, this.defs);
  }

  async visit(): Promise<PetView> {
    const now = this.now();
    const { next, view } = rules.visit(this.save, now, this.defs);
    this.save = next;
    return { ...view, awayMinutes: 0 };
  }
  async getView(): Promise<PetView> {
    this.save = rules.tick(this.save, this.now(), this.defs);
    return this.view();
  }
  async setScene(sceneId: SceneId): Promise<PetView> {
    this.save = rules.setScene(this.save, sceneId, this.now(), this.defs);
    return this.view();
  }
  async poke(): Promise<PetView> {
    this.save = rules.poke(this.save, this.now(), this.defs);
    return this.view();
  }
  async act(a: GameAction): Promise<ActResult> {
    if (!VISITOR_ACTIONS.has(a.type)) return { ok: false, error: 'visitor', view: this.view() };
    const { next, result } = rules.act({ ...this.save, game: { ...this.save.game, stamina: 100 } }, a, this.now(), this.defs);
    this.save = next;
    if (result.ok && a.type === 'water') this.watered.add(a.plot);
    return result;
  }
  async gameplay(): Promise<GameplayFile | null> {
    return this.file;
  }
  async chat() {
    return { ok: false as const, reason: 'no_key' as const };
  }

  /** 幫忙澆了幾格 */
  get wateredCount(): number { return this.watered.size; }

  /** 寫好信 → 回信碼（給朋友兌換） */
  makeReply(text: string): string {
    const payload: ReplyPayload = {
      v: 1, to: this.visiting.from, from: this.visiting.me.id, nick: this.visiting.me.nick,
      text: cleanName(String(text ?? '').replace(/\s+/g, ' '), this.file.social?.visit.letterMax ?? 120),
      watered: [...this.watered], at: this.now(),
    };
    return encodeCode('reply', payload, this.salt);
  }
}
