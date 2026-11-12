// 純函數：host（DSH service）和 demo（LocalBridge）共用同一套規則。
// 沒有 I/O、沒有 Date.now()，時間一律由呼叫端傳入，方便測試與日後聯機重播。
// defs（玩法定義）是可選的：V0.1 的畫面不用玩法，照樣能用這些函數。
import { advanceQuests, applyAction, progressWish, gameView, newGame, normalizeGame, tickGame } from './gameplay.ts';
import type { GameAction, GameplayDefs } from './gameplay-types.ts';
import { dayPhase } from './time.ts';
import type { ActResult, PetSave, PetView, SceneId } from './types.ts';

export { dayPhase };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** 離線最多結算幾小時，避免回來時一次衰減到底 */
export const MAX_OFFLINE_MS = 72 * 60 * MINUTE;
const SCENE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * 遊戲時間 = 現實時間 + clockOffset（睡覺會讓它往前跳）。
 * 下面每個函數收到的 now 都是現實時間，進來第一件事就換成遊戲時間。
 * lastSeenAt 用現實時間（算「離開多久」）；其他時間戳記都是遊戲時間。
 */
export function gameNow(s: PetSave, now: number): number {
  return now + (s.game?.clockOffset ?? 0);
}

export function createSave(now: number, initialScene: SceneId, defs?: GameplayDefs): PetSave {
  return {
    version: 2,
    sceneId: initialScene,
    createdAt: now,
    lastTickAt: now,
    lastSeenAt: now,
    pokes: 0,
    game: newGame(now, defs),
  };
}

/**
 * 時間流逝（lazy tick）：每次讀寫前呼叫。
 * 有玩法定義時，順便結算體力回復、飽食度下降、每日好感上限。
 */
export function tick(s: PetSave, now: number, defs?: GameplayDefs): PetSave {
  const t = gameNow(s, now);
  if (t <= s.lastTickAt) return s;
  return { ...s, lastTickAt: t, game: defs ? tickGame(s.game, t, defs) : s.game };
}

export function toView(s: PetSave, now: number, awayMinutes = 0, defs?: GameplayDefs): PetView {
  const t = gameNow(s, now);
  return {
    sceneId: s.sceneId,
    phase: dayPhase(t),
    awayMinutes,
    ageDays: Math.floor((t - s.createdAt) / DAY),
    pokes: s.pokes,
    now: t,
    game: defs ? gameView(s.game, defs, t) : undefined,
  };
}

/** 打開畫面（或畫面開著時定期呼叫）：算出離開多久，並把 lastSeenAt 更新成現在 */
export function visit(s: PetSave, now: number, defs?: GameplayDefs): { next: PetSave; view: PetView } {
  const t = tick(s, now, defs);
  const away = Math.max(0, Math.floor((now - t.lastSeenAt) / MINUTE));
  const next = { ...t, lastSeenAt: now };
  return { next, view: toView(next, now, away, defs) };
}

export function setScene(s: PetSave, sceneId: SceneId, now: number, defs?: GameplayDefs): PetSave {
  // host 不認識角色包，只檢查格式；不存在的場景由前端退回 initialScene
  if (!SCENE_ID_RE.test(sceneId)) throw new Error(`invalid sceneId: ${sceneId}`);
  const t = tick(s, now, defs);
  // 任務：「走進某張地圖」也是一種訊號
  const enter = { event: 'enter' as const, items: [], scene: sceneId, count: 1 };
  const game = defs ? progressWish(advanceQuests(t.game, [enter], defs, gameNow(t, now)), enter, defs) : t.game; // V0.18：「帶她去海邊」這種願望
  return { ...t, sceneId, game };
}

export function poke(s: PetSave, now: number, defs?: GameplayDefs): PetSave {
  return { ...tick(s, now, defs), pokes: s.pokes + 1 };
}

/** V0.2 玩法動作：成功或失敗都回傳新的存檔（失敗時只推進時間） */
export function act(s: PetSave, a: GameAction, now: number, defs?: GameplayDefs): { next: PetSave; result: ActResult } {
  if (!defs) return { next: s, result: { ok: false, error: 'no_game', view: toView(s, now) } };
  const t = tick(s, now, defs);
  // 睡覺只能在指定的場景（房間）；host 才知道她在哪裡，所以在這一層檢查
  if (a.type === 'sleep' && defs.file.sleep && !defs.file.sleep.scenes.includes(t.sceneId)) {
    return { next: t, result: { ok: false, error: 'not_here', view: toView(t, now, 0, defs) } };
  }
  // 野生寵物、地上的掉落物：只能在她現在所在的地圖
  if ((a.type === 'catch_pet' || a.type === 'forage') && a.scene !== t.sceneId) {
    return { next: t, result: { ok: false, error: 'not_here', view: toView(t, now, 0, defs) } };
  }
  const r = applyAction(t.game, a, defs, gameNow(t, now));
  const next = { ...t, game: r.game, lastTickAt: Math.max(t.lastTickAt, gameNow({ ...t, game: r.game }, now)) };
  const view = toView(next, now, 0, defs);
  return { next, result: r.ok ? { ok: true, event: r.event, view } : { ok: false, error: r.error, view } };
}

/** 存檔版本遷移：1 → 2 補上玩法狀態；之後改欄位就在這裡加 case */
export function migrate(raw: unknown, now: number, initialScene: SceneId, defs?: GameplayDefs): PetSave {
  const r = (raw ?? {}) as Partial<Omit<PetSave, 'version'>> & { version?: number };
  if (r.version !== 1 && r.version !== 2) return createSave(now, initialScene, defs);
  return {
    version: 2,
    sceneId: typeof r.sceneId === 'string' ? r.sceneId : initialScene,
    createdAt: num(r.createdAt, now),
    lastTickAt: num(r.lastTickAt, now),
    lastSeenAt: num(r.lastSeenAt, now),
    pokes: num(r.pokes, 0),
    game: r.version === 2 ? normalizeGame(r.game, now, defs) : newGame(now, defs, num(r.createdAt, now)),
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
