// V0.18：季節粒子（輕量、像素小方塊）。春天櫻花瓣、夏天螢火蟲、秋天落葉、冬天雪花。
// 只在戶外地圖；地圖座標（16 像素一格）裡畫 1～2 像素的方塊，放大後就是像素風。
// 設定在 scenes.json 的 ambient.seasons（顏色、數量、大小、落下速度、左右搖擺）。

export interface SeasonFxDef {
  /** petal 花瓣、firefly 螢火蟲（慢慢飄、一閃一閃、晚上發光）、leaf 落葉（會翻轉）、snow 雪花 */
  kind: 'petal' | 'firefly' | 'leaf' | 'snow';
  colors: string[];
  /** 同時最多幾個 */
  count: number;
  /** 方塊大小（地圖像素）[最小, 最大] */
  size: [number, number];
  /** 每秒往下幾像素 [最小, 最大]（螢火蟲可以是負的：往上飄） */
  fall: [number, number];
  /** 左右搖擺的幅度（像素）[最小, 最大] */
  sway: [number, number];
  /** 白天只出現這個比例（螢火蟲白天少一點）；預設 1 */
  dayRatio?: number;
  /** 下雨時出現的比例；預設 0（V0.19：一次只有一種，下雨就不飄花瓣、落葉） */
  rainRatio?: number;
}

interface P {
  x: number;
  y: number;
  vy: number;
  sway: number;
  freq: number;
  phase: number;
  size: number;
  color: string;
  age: number;
}

/** 可以傳一個亂數函數進來（測試時固定） */
export class SeasonFx {
  private ps: P[] = [];
  private def: SeasonFxDef | null = null;
  private key = '';
  private t = 0;
  private target = 0;
  private night = false;

  constructor(
    private readonly defs: Record<string, SeasonFxDef>,
    private readonly rnd: () => number = Math.random,
  ) {}

  /** 換季、換地圖、晝夜、下雨時呼叫；同樣的設定不會重置 */
  set(season: string | null, opts: { outdoor: boolean; night: boolean; rain: boolean }) {
    const def = season && opts.outdoor ? this.defs[season] ?? null : null;
    const key = `${season}|${opts.outdoor}|${opts.night}|${opts.rain}`;
    if (key === this.key) return;
    const changedKind = this.def?.kind !== def?.kind;
    this.key = key;
    this.def = def;
    this.target = def ? Math.round(def.count * (opts.night ? 1 : def.dayRatio ?? 1) * (opts.rain ? def.rainRatio ?? 0 : 1)) : 0;
    this.night = opts.night;
    if (changedKind) this.ps = [];
  }

  get size(): number {
    return this.ps.length;
  }
  get kind(): string | null {
    return this.def?.kind ?? null;
  }

  private spawn(W: number, H: number, anywhere: boolean): P {
    const d = this.def!;
    const r = this.rnd;
    const lerp = (a: [number, number]) => a[0] + r() * (a[1] - a[0]);
    const firefly = d.kind === 'firefly';
    return {
      x: r() * W,
      // 螢火蟲在畫面下半部到處出現；其他從上面掉下來（一開始就散在整個畫面，才不會一排一起落下）
      y: firefly ? H * (0.35 + r() * 0.6) : anywhere ? r() * H : -4 - r() * 10,
      vy: lerp(d.fall),
      sway: lerp(d.sway),
      freq: 0.6 + r() * 1.2,
      phase: r() * Math.PI * 2,
      size: Math.round(lerp(d.size)),
      color: d.colors[Math.floor(r() * d.colors.length) % d.colors.length]!,
      age: 0,
    };
  }

  update(dt: number, W: number, H: number) {
    this.t += dt;
    const d = this.def;
    if (!d) {
      this.ps.length = 0;
      return;
    }
    // 慢慢補到目標數量（一次最多補幾個，避免一下子冒出來）
    const fresh = this.ps.length === 0;
    for (let i = 0; this.ps.length < this.target && i < (fresh ? this.target : 2); i++) this.ps.push(this.spawn(W, H, fresh));
    if (this.ps.length > this.target) this.ps.length = this.target;
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i]!;
      p.age += dt;
      p.y += p.vy * dt;
      const gone = d.kind === 'firefly' ? p.age > 6 + p.freq * 4 || p.y < -4 || p.y > H + 4 : p.y > H + 4;
      if (gone) this.ps[i] = this.spawn(W, H, false);
    }
  }

  /** layer：normal = 跟著時段變暗；glow = 晚上的螢火蟲（畫在夜色上面，才會亮） */
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, layer: 'normal' | 'glow') {
    const d = this.def;
    if (!d || !this.ps.length) return;
    const glow = d.kind === 'firefly' && this.night;
    if ((layer === 'glow') !== glow) return;
    ctx.save();
    for (const p of this.ps) {
      const swayX = Math.sin(this.t * p.freq * 2 + p.phase) * p.sway;
      const x = Math.round(ox + p.x + swayX);
      const y = Math.round(oy + p.y);
      let a = 1;
      if (d.kind === 'firefly') {
        // 一閃一閃：淡入、亮、淡出
        const life = 6 + p.freq * 4;
        a = Math.min(1, p.age / 1.2, (life - p.age) / 1.2) * (0.55 + 0.45 * Math.sin(this.t * 3 * p.freq + p.phase));
        if (!this.night) a *= 0.6;
      }
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      if (d.kind === 'leaf') {
        // 落葉：一下橫一下直（翻轉）
        const flip = Math.sin(this.t * p.freq * 3 + p.phase) > 0;
        ctx.fillRect(x, y, flip ? p.size + 1 : p.size, flip ? p.size : p.size + 1);
      } else {
        ctx.fillRect(x, y, p.size, p.size);
      }
      if (glow && a > 0.3) {
        ctx.globalAlpha = a * 0.25;
        ctx.fillRect(x - 1, y - 1, p.size + 2, p.size + 2);
      }
    }
    ctx.restore();
  }
}
