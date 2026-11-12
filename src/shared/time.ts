// 時間相關的小工具（state.ts 與 gameplay.ts 共用，避免互相引用）
import type { DayPhase } from './types.ts';

/** 依本機時間判斷時段（host 跟使用者在同一台機器，所以用 host 的時區即可） */
export function dayPhase(now: number): DayPhase {
  const h = new Date(now).getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 20) return 'evening';
  return 'night';
}

/** 本機日期，例如 "2026-11-10"；用來判斷跨日 */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 本機時間的第幾天（從 1970 起算）；季節和天氣都由它決定 */
export function dayIndex(now: number): number {
  const d = new Date(now);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** 本機時間這一天的開始（午夜） */
export function dayStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
