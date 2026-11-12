// V0.14：背景音樂（packs/<角色包>/music.json）。這裡只有「現在該播哪一首」的純函數和檢查；播放在 client/pixel/music-player.ts。

export interface MusicTrack {
  /** 音樂檔（相對角色包根目錄，例如 music/rain.mp3） */
  src: string;
  name: string;
  /** 這首的音量倍率（預設 1） */
  volume?: number;
}

/** 條件沒寫 = 不限；全部符合才算 */
export interface MusicRule {
  track: string;
  scenes?: string[];
  outdoor?: boolean;
  weather?: string[];
  phases?: string[];
}

export interface MusicFile {
  version: 1;
  /** 整體音量 0～1 */
  volume: number;
  /** 換歌時淡出淡入的時間 */
  fadeMs: number;
  tracks: Record<string, MusicTrack>;
  /** 由上往下，第一條符合的就播那首 */
  rules: MusicRule[];
}

export interface MusicContext {
  scene: string;
  outdoor: boolean;
  weather?: string;
  phase?: string;
}

/** 現在該播哪一首（tracks 的 key）；沒有符合的規則就是 null（不放音樂） */
export function pickTrack(f: MusicFile | undefined, c: MusicContext): string | null {
  if (!f) return null;
  for (const r of f.rules) {
    if (r.scenes && !r.scenes.includes(c.scene)) continue;
    if (r.outdoor !== undefined && r.outdoor !== c.outdoor) continue;
    if (r.weather && (!c.weather || !r.weather.includes(c.weather))) continue;
    if (r.phases && (!c.phase || !r.phases.includes(c.phase))) continue;
    if (f.tracks[r.track]) return r.track;
  }
  return null;
}

/** 檢查 music.json；ctx 給了就順便檢查場景、天氣 id 存不存在 */
export function validateMusic(file: unknown, ctx: { scenes?: string[]; weather?: string[] } = {}): string[] {
  const out: string[] = [];
  const f = file as MusicFile;
  if (!f || typeof f !== 'object' || f.version !== 1 || !f.tracks || !Array.isArray(f.rules)) return ['music.json：要有 version: 1、tracks、rules'];
  if (!(f.volume >= 0 && f.volume <= 1)) out.push('music.json：volume 要在 0～1');
  if (!(f.fadeMs >= 0)) out.push('music.json：fadeMs 要 ≥ 0');
  for (const [id, t] of Object.entries(f.tracks)) {
    if (!t.src || !/\.(mp3|ogg|m4a|wav)$/i.test(t.src)) out.push(`music.json tracks.${id}：src 要是音樂檔（mp3、ogg、m4a、wav）`);
    if (!t.name) out.push(`music.json tracks.${id}：要有 name`);
  }
  f.rules.forEach((r, i) => {
    if (!f.tracks[r.track]) out.push(`music.json rules[${i}]：沒有「${r.track}」這首`);
    for (const s of r.scenes ?? []) if (ctx.scenes && !ctx.scenes.includes(s)) out.push(`music.json rules[${i}]：沒有場景「${s}」`);
    for (const w of r.weather ?? []) if (ctx.weather && !ctx.weather.includes(w)) out.push(`music.json rules[${i}]：沒有天氣「${w}」`);
    for (const p of r.phases ?? []) if (!['morning', 'afternoon', 'evening', 'night'].includes(p)) out.push(`music.json rules[${i}]：時段「${p}」要是 morning／afternoon／evening／night`);
  });
  const last = f.rules[f.rules.length - 1];
  if (last && (last.scenes || last.outdoor !== undefined || last.weather || last.phases)) out.push('music.json：最後一條規則建議不加條件（其他都不符合時播的預設曲）');
  return out;
}
