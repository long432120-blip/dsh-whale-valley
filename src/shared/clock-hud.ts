// V0.16：時間與天氣的木牌 HUD。這裡是純函數：給「現在幾點、季節、天氣」，算出木牌上要寫什麼、用哪個圖示、要不要變暗。
// 畫面（client/pixel/clock-hud.ts）只負責把結果放進 DOM。
import type { DayPhase } from './types.ts';
import { dayPhase } from './time.ts';

/** scenes.json 的 hud.clock */
export interface ClockHudDef {
  /** 木牌背景圖（相對角色包根目錄） */
  board: string;
  /** 天氣圖示：一排正方形，names 依序對應每一格（天氣 id，或 seasonIcons 用的名字） */
  icons: { src: string; size: number; names: string[] };
  /** 放在遊戲畫面的哪個角落；預設 top-right */
  corner?: 'top-left' | 'top-right';
  /** 幾點以後算晚上（木牌變暗）；預設 18 */
  nightFrom?: number;
  /** 幾點以前算晚上；預設 6 */
  nightTo?: number;
  /** 季節前面改用圖示（季節 id → icons 的名字），例如冬天用像素雪花 */
  seasonIcons?: Record<string, string>;
}

/** 從遊戲狀態讀出來的：季節、第幾天、現在時間、天氣 */
export interface ClockInput {
  now: number;
  season: { id: string; name: string; emoji: string; day: number; days: number } | null;
  weather: { id: string; name: string; emoji: string };
}

export interface ClockFace {
  /** 「🍂 秋季 第 12 天」 */
  season: string;
  /** 季節前面的像素圖示（icons 的第幾格）；-1 = 用 emoji */
  seasonIcon: number;
  seasonEmoji: string;
  /** 「下午 14:00」 */
  time: string;
  phase: DayPhase;
  phaseName: string;
  /** 🌅 ☀️ 🌇 🌙 */
  phaseIcon: string;
  hhmm: string;
  weatherId: string;
  weatherName: string;
  weatherEmoji: string;
  /** 天氣圖示是 icons 的第幾格；-1 = 沒有圖，用 emoji */
  weatherIcon: number;
  /** 晚上：木牌變暗 */
  night: boolean;
}

export const PHASE_LABEL: Record<DayPhase, { name: string; icon: string }> = {
  morning: { name: '早上', icon: '🌅' },
  afternoon: { name: '下午', icon: '🕒' },
  evening: { name: '傍晚', icon: '🌇' },
  night: { name: '夜晚', icon: '🌙' },
};

export function clockFace(def: Pick<ClockHudDef, 'icons' | 'nightFrom' | 'nightTo' | 'seasonIcons'>, s: ClockInput): ClockFace {
  const d = new Date(s.now);
  const h = d.getHours();
  const hhmm = `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const phase = dayPhase(s.now);
  const p = PHASE_LABEL[phase];
  const from = def.nightFrom ?? 18;
  const to = def.nightTo ?? 6;
  const night = from > to ? h >= from || h < to : h >= from && h < to;
  const seasonName = s.season ? (s.season.name.endsWith('季') ? s.season.name : `${s.season.name}季`) : '';
  const iconOf = (name: string | undefined) => (name ? def.icons.names.indexOf(name) : -1);
  return {
    season: s.season ? `${seasonName} 第 ${s.season.day} 天` : '',
    seasonIcon: s.season ? iconOf(def.seasonIcons?.[s.season.id]) : -1,
    seasonEmoji: s.season?.emoji ?? '',
    time: `${p.name} ${hhmm}`,
    phase,
    phaseName: p.name,
    phaseIcon: p.icon,
    hhmm,
    weatherId: s.weather.id,
    weatherName: s.weather.name,
    weatherEmoji: s.weather.emoji,
    weatherIcon: iconOf(s.weather.id),
    night,
  };
}

/** 檢查 scenes.json 的 hud.clock */
export function validateClockHud(def: unknown): string[] {
  const out: string[] = [];
  const c = def as ClockHudDef;
  if (!c || typeof c !== 'object') return ['scenes.json：hud.clock 要是物件'];
  if (!c.board) out.push('scenes.json：hud.clock 缺 board（木牌圖）');
  if (!c.icons?.src || !(c.icons.size > 0) || !Array.isArray(c.icons.names) || !c.icons.names.length) out.push('scenes.json：hud.clock.icons 要有 src、size、names');
  if (c.corner && c.corner !== 'top-left' && c.corner !== 'top-right') out.push('scenes.json：hud.clock.corner 要是 top-left 或 top-right');
  for (const k of ['nightFrom', 'nightTo'] as const) if (c[k] !== undefined && !(Number.isInteger(c[k]) && c[k]! >= 0 && c[k]! <= 24)) out.push(`scenes.json：hud.clock.${k} 要是 0～24 的整數`);
  for (const [s, n] of Object.entries(c.seasonIcons ?? {})) if (!c.icons?.names?.includes(n)) out.push(`scenes.json：hud.clock.seasonIcons.${s} 的圖示 ${n} 不在 icons.names 裡`);
  return out;
}
