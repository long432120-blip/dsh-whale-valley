// V0.14：背景音樂播放器。哪一首由 shared/music.ts 的 pickTrack 決定；這裡只管播、淡入淡出、靜音。
//
// - 瀏覽器不准網頁自己出聲：要等主人第一次點畫面或按鍵才開始播（之前選好的歌先記著）。
// - 換歌：舊的淡出、新的淡入（fadeMs）。同一首就不重播。
// - 分頁切走時暫停，切回來繼續（桌寵開著不吵人）。
// - 開關和音量記在 localStorage（'whale-pet:music'）；讀不到音樂檔（例如 DSH 還沒提供檔案）就安靜地不放。
import type { MusicFile } from '../../shared/music.ts';

const KEY = 'whale-pet:music';

export interface MusicPrefs { on: boolean; volume: number }

export function loadMusicPrefs(defVolume: number): MusicPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<MusicPrefs> | null;
    return { on: raw?.on !== false, volume: typeof raw?.volume === 'number' ? Math.min(1, Math.max(0, raw.volume)) : defVolume };
  } catch {
    return { on: true, volume: defVolume };
  }
}
function savePrefs(p: MusicPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 無痕視窗之類：不記也沒關係 */
  }
}

export class MusicPlayer {
  private cur: { id: string; el: HTMLAudioElement } | null = null;
  private want: string | null = null;
  private unlocked = false;
  private readonly broken = new Set<string>();
  private readonly fades = new Map<HTMLAudioElement, number>();
  prefs: MusicPrefs;
  onChange?: (state: { on: boolean; track: string | null; name: string | null }) => void;

  constructor(
    private readonly doc: Document,
    private readonly file: MusicFile,
    /** 音樂檔的候選網址（第一個載入失敗就試下一個） */
    private readonly urls: (src: string) => string[],
  ) {
    this.prefs = loadMusicPrefs(file.volume);
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      this.apply();
    };
    for (const ev of ['pointerdown', 'keydown'] as const) doc.addEventListener(ev, unlock, { capture: true });
    doc.addEventListener('visibilitychange', () => {
      if (!this.cur) return;
      if (doc.hidden) this.cur.el.pause();
      else if (this.prefs.on && this.unlocked) void this.cur.el.play().catch(() => {});
    });
  }

  /** 現在應該播哪一首（null = 不放） */
  set(track: string | null) {
    if (track === this.want) return;
    this.want = track;
    this.apply();
  }

  toggle(): boolean {
    this.prefs = { ...this.prefs, on: !this.prefs.on };
    savePrefs(this.prefs);
    this.unlocked = true; // 按了開關就算主人有互動了
    if (!this.prefs.on && this.cur) this.fadeOut(this.cur.el), (this.cur = null);
    this.apply();
    return this.prefs.on;
  }

  get playing(): string | null {
    return this.cur?.id ?? null;
  }

  dispose() {
    for (const el of this.fades.keys()) el.pause();
    this.cur?.el.pause();
    this.cur = null;
  }

  private target(id: string) {
    const t = this.file.tracks[id];
    return this.prefs.volume * (t?.volume ?? 1);
  }

  private apply() {
    const id = this.prefs.on && this.unlocked && this.want && !this.broken.has(this.want) ? this.want : null;
    if (this.cur?.id === id) return this.emit();
    if (this.cur) this.fadeOut(this.cur.el);
    this.cur = null;
    if (!id) return this.emit();
    const t = this.file.tracks[id]!;
    const el = this.doc.createElement('audio');
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    const tries = this.urls(t.src);
    let k = 0;
    el.addEventListener('error', () => {
      k++;
      if (k < tries.length) {
        el.src = tries[k]!;
        void el.play().catch(() => {});
        return;
      }
      // 每個網址都讀不到：這首先不播（不要一直重試）
      this.broken.add(id);
      console.warn(`[whale-pet] 讀不到音樂 ${t.src}`);
      if (this.cur?.el === el) this.cur = null;
      this.emit();
    });
    el.src = tries[0]!;
    this.cur = { id, el };
    if (!this.doc.hidden) void el.play().catch(() => {});
    this.fadeTo(el, this.target(id));
    this.emit();
  }

  private fadeOut(el: HTMLAudioElement) {
    this.fadeTo(el, 0, () => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    });
  }

  private fadeTo(el: HTMLAudioElement, to: number, done?: () => void) {
    const prev = this.fades.get(el);
    if (prev) clearInterval(prev);
    const ms = Math.max(1, this.file.fadeMs);
    const from = el.volume;
    const t0 = performance.now();
    const h = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = Math.min(1, Math.max(0, from + (to - from) * k));
      if (k >= 1) {
        clearInterval(h);
        this.fades.delete(el);
        done?.();
      }
    }, 50);
    this.fades.set(el, h);
  }

  private emit() {
    const id = this.cur?.id ?? null;
    this.onChange?.({ on: this.prefs.on, track: id, name: id ? this.file.tracks[id]?.name ?? null : null });
  }
}
