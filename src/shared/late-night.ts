// V0.18：現實時間聯動。用玩家電腦的時鐘（不是遊戲時間：遊戲可以快轉，但主人真的該睡了）。
// fromHour 點以後、toHour 點以前算深夜；同一晚最多提醒 maxPerNight 次，每次至少隔 repeatMinutes 分鐘。

export interface LateNightDef {
  fromHour: number;
  toHour: number;
  repeatMinutes: number;
  maxPerNight: number;
  lines: string[];
}

/** 這一晚提醒過幾次（存在瀏覽器的 localStorage） */
export interface LateNightState {
  /** 哪一晚：深夜 0～5 點算前一天晚上 */
  night: string;
  count: number;
  /** 上次提醒的時間（毫秒） */
  last: number;
}

/** 現在是不是深夜；是的話回傳這一晚的 key（YYYY-MM-DD，晚上那天），不是回傳 null */
export function lateNightKey(now: Date, def: Pick<LateNightDef, 'fromHour' | 'toHour'>): string | null {
  const h = now.getHours();
  const late = def.fromHour > def.toHour ? h >= def.fromHour || h < def.toHour : h >= def.fromHour && h < def.toHour;
  if (!late) return null;
  // 過了午夜還算前一天晚上
  const d = new Date(now);
  if (def.fromHour > def.toHour && h < def.toHour) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 要不要提醒：深夜、這一晚還沒提醒滿、離上次夠久。
 * 回傳新的狀態（要提醒）或 null（不用）。
 */
export function lateNightDue(now: Date, def: LateNightDef, prev: LateNightState | null): LateNightState | null {
  const night = lateNightKey(now, def);
  if (!night) return null;
  const st = prev && prev.night === night ? prev : { night, count: 0, last: 0 };
  if (st.count >= def.maxPerNight) return null;
  if (st.count > 0 && now.getTime() - st.last < def.repeatMinutes * 60_000) return null;
  return { night, count: st.count + 1, last: now.getTime() };
}

/** 讀 localStorage 的內容；壞掉就當作沒提醒過 */
export function parseLateNight(raw: string | null): LateNightState | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<LateNightState>;
    return typeof r.night === 'string' && typeof r.count === 'number' && typeof r.last === 'number' ? { night: r.night, count: r.count, last: r.last } : null;
  } catch {
    return null;
  }
}
