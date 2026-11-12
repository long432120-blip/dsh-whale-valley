// V0.23：存檔格（3 格）＋開新遊戲。單機版（localStorage）和 DSH 版（host 的 slots/ 資料夾）共用這裡的規則。
//
// 一格存的是「當下整份存檔」的複本：
//   { version: 1, savedAt, save: PetSave }
// 讀檔 = 把那份複本變成目前的進度（讀之前畫面會先問玩家）。
// 存檔格壞掉（被手改、版本看不懂）時當作空格，不會讓遊戲當掉。
import type { PetSave, PetView } from './types.ts';

export const SLOT_COUNT = 3;

export interface SlotFile {
  version: 1;
  savedAt: number;
  save: PetSave;
}

/** 給畫面顯示的一格 */
export interface SlotInfo {
  slot: number;
  empty: boolean;
  /** 存檔格壞掉（讀不出來） */
  broken?: boolean;
  savedAt?: number;
  summary?: {
    nick: string;
    coins: number;
    affection: number;
    level: string;
    /** 例如「🌸 春 第 3 天」 */
    season: string;
    sceneId: string;
    ageDays: number;
  };
}

/** 存檔格功能（HostBridge.slots）：LocalBridge、DshBridge 都實作這個 */
export interface SlotApi {
  readonly count: number;
  list(): Promise<SlotInfo[]>;
  /** 把目前進度存到第 slot 格（覆蓋），回傳最新的清單 */
  save(slot: number): Promise<SlotInfo[]>;
  /** 讀第 slot 格，變成目前進度；回傳新的畫面狀態 */
  load(slot: number): Promise<PetView>;
  remove(slot: number): Promise<SlotInfo[]>;
  /** 開新遊戲（目前進度會先備份一份，按錯了還救得回來） */
  newGame(): Promise<PetView>;
}

export function validSlot(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT;
}

export function makeSlotFile(save: PetSave, now: number): SlotFile {
  return { version: 1, savedAt: now, save };
}

/** 讀存檔格：看不懂的一律回傳 null（當作壞掉） */
export function parseSlotFile(raw: unknown): SlotFile | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const f = v as Partial<SlotFile>;
  if (f.version !== 1 || typeof f.savedAt !== 'number' || !Number.isFinite(f.savedAt)) return null;
  const s = f.save as { version?: unknown } | undefined;
  if (!s || typeof s !== 'object' || (s.version !== 1 && s.version !== 2)) return null;
  return { version: 1, savedAt: f.savedAt, save: s as PetSave };
}

/** 一格的摘要（view 是那份存檔算出來的畫面狀態） */
export function slotInfo(slot: number, file: SlotFile | null, view: PetView | null, broken = false): SlotInfo {
  if (!file || !view) return broken ? { slot, empty: false, broken: true } : { slot, empty: true };
  const g = view.game;
  return {
    slot,
    empty: false,
    savedAt: file.savedAt,
    summary: {
      nick: g?.social?.nick ?? '',
      coins: g?.coins ?? 0,
      affection: g?.affection ?? 0,
      level: g?.level ?? '',
      season: g?.season ? `${g.season.emoji} ${g.season.name} 第 ${g.season.day} 天` : '',
      sceneId: view.sceneId,
      ageDays: view.ageDays,
    },
  };
}
