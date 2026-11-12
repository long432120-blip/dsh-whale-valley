// 框架無關的渲染器：純 DOM + CSS。
// 同一份程式碼給 demo 頁直接用，也給 DSH 的 React 槽位包一層 useEffect 用。
import { pickLine } from '../shared/lines.ts';
import type {
  CharacterFile, HostBridge, LineTrigger, Pct, PetView, SceneDef, SceneId, ScenesFile, SpriteDef,
} from '../shared/types.ts';
import { validatePack } from '../shared/validate.ts';
import { cssUrl } from './css-url.ts';
import { ensureStyles } from './stage-css.ts';

export { cssUrl };

export interface StageOptions {
  scenes: ScenesFile;
  character: CharacterFile;
  bridge: HostBridge;
  /** 把 JSON 裡的相對路徑換成真正的 URL（demo 用 URL 拼接；DSH 用打包後的 data URL） */
  resolveAsset: (path: string) => string;
  /** 向 host 輪詢的間隔；DSH 目前不保證會把宿主事件推到瀏覽器，所以用輪詢 */
  pollMs?: number;
  rng?: () => number;
  /** 每次拿到新的 PetView 時回呼（demo 用來顯示狀態列） */
  onView?: (view: PetView) => void;
}

export interface StageHandle {
  goto(sceneId: SceneId, spawn?: string): Promise<void>;
  say(trigger: LineTrigger): void;
  /** 重新「打開畫面」：結算離開時間，離開夠久會打招呼 */
  visit(): Promise<void>;
  dispose(): void;
}

type Mode = { kind: 'idle'; until: number } | { kind: 'walk'; target: Pct };

const FADE_MS = 280;
const WELCOME_AFTER_MIN = 60;

export async function mountStage(root: HTMLElement, opts: StageOptions): Promise<StageHandle> {
  const { scenes, character: ch, bridge, resolveAsset } = opts;
  const rng = opts.rng ?? Math.random;
  const doc = root.ownerDocument;
  for (const err of validatePack(scenes, ch)) console.warn('[whale-pet] pack:', err);
  ensureStyles(doc);

  const sceneById = new Map(scenes.scenes.map((s) => [s.id, s]));
  const findScene = (id: SceneId): SceneDef => sceneById.get(id) ?? sceneById.get(scenes.initialScene)!;

  // ── 1. 建 DOM：背景 → 夜晚濾色 → 熱區 → 角色 → 轉場黑幕 ──
  const el = (cls: string, tag = 'div') => Object.assign(doc.createElement(tag), { className: cls });
  const stage = el('wp-stage');
  const bg = el('wp-bg');
  const tint = el('wp-tint');
  const hotLayer = el('wp-hotspots');
  const pet = el('wp-pet');
  const shadow = el('wp-shadow');
  const body = el('wp-body');
  const sprite = el('wp-sprite');
  const bubble = el('wp-bubble');
  const fade = el('wp-fade');
  stage.style.aspectRatio = scenes.aspectRatio;
  body.append(sprite);
  pet.append(shadow, body, bubble);
  pet.tabIndex = 0;
  pet.setAttribute('role', 'button');
  pet.setAttribute('aria-label', `和${ch.name}說話`);
  bubble.setAttribute('aria-live', 'polite');
  stage.append(bg, tint, hotLayer, pet, fade);
  root.append(stage);

  // ── 2. 立繪：sprite sheet 用 CSS steps() 播放 ──
  const spriteInfo = new Map<SpriteDef, { url: string; aspect: string }>();
  for (const def of [ch.sprites.idle, ch.sprites.walk]) {
    if (def) spriteInfo.set(def, await loadSprite(def, resolveAsset(def.src)));
  }
  let currentSprite: SpriteDef | undefined;
  function useSprite(def: SpriteDef) {
    if (def === currentSprite) return;
    currentSprite = def;
    const info = spriteInfo.get(def)!;
    const frames = def.frames ?? 1;
    pet.style.aspectRatio = info.aspect;
    sprite.style.backgroundImage = cssUrl(info.url);
    sprite.style.backgroundSize = `${frames * 100}% 100%`;
    sprite.style.animation =
      frames > 1 ? `wp-frames ${frames / (def.fps ?? 8)}s steps(${frames}, jump-none) infinite` : 'none';
  }
  useSprite(ch.sprites.idle);

  // ── 3. 狀態 ──
  let view!: PetView;
  let scene!: SceneDef;
  let x: Pct = 50;
  let mode: Mode = { kind: 'idle', until: 0 };
  let busy = false;
  let lastLine: string | undefined;
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  let disposed = false;

  const rand = (a: number, b: number) => a + rng() * (b - a);
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function setView(v: PetView) {
    view = v;
    stage.dataset.phase = v.phase;
    opts.onView?.(v);
  }

  function applyScene(s: SceneDef, spawnKey = 'default') {
    scene = s;
    stage.dataset.scene = s.id;
    bg.style.backgroundImage = cssUrl(resolveAsset(s.background));
    hotLayer.replaceChildren(
      ...s.hotspots.map((h) => {
        const b = el('wp-hotspot', 'button') as HTMLButtonElement;
        b.type = 'button';
        b.setAttribute('aria-label', h.label);
        Object.assign(b.style, { left: `${h.rect.x}%`, top: `${h.rect.y}%`, width: `${h.rect.w}%`, height: `${h.rect.h}%` });
        const tip = el('', 'span');
        tip.textContent = h.label;
        b.append(tip);
        b.addEventListener('click', () => void goto(h.action.scene, h.action.spawn));
        return b;
      }),
    );
    const scale = s.walkArea.scale ?? 1;
    pet.style.height = `${ch.heightPct * scale}%`;
    pet.style.bottom = `${100 - s.walkArea.groundY}%`;
    x = clamp(s.spawns[spawnKey] ?? s.spawns.default, s.walkArea.xMin, s.walkArea.xMax);
    toIdle();
    render();
  }

  function render() {
    pet.style.left = `${x}%`;
    pet.dataset.align = x < 22 ? 'left' : x > 78 ? 'right' : 'center';
  }

  // ── 4. 走動：idle ⇄ walk 的小狀態機，requestAnimationFrame 推進座標 ──
  function toIdle(ms = rand(ch.idleMs[0], ch.idleMs[1])) {
    mode = { kind: 'idle', until: performance.now() + ms };
    body.classList.remove('walking');
    useSprite(ch.sprites.idle);
  }

  function startWalk() {
    const { xMin, xMax } = scene.walkArea;
    let target = x;
    for (let i = 0; i < 6 && Math.abs(target - x) < 8; i++) target = rand(xMin, xMax);
    if (Math.abs(target - x) < 1) return toIdle();
    const dir = Math.sign(target - x);
    const flip = (ch.facing === 'right' && dir < 0) || (ch.facing === 'left' && dir > 0);
    sprite.classList.toggle('flip', flip);
    if (ch.walkBob) body.classList.add('walking');
    useSprite(ch.sprites.walk ?? ch.sprites.idle);
    mode = { kind: 'walk', target };
  }

  let last = performance.now();
  function frame(t: number) {
    const dt = Math.min(0.1, (t - last) / 1000); // 分頁切回來時不要瞬移
    last = t;
    if (!busy) {
      if (mode.kind === 'idle' && t >= mode.until) startWalk();
      else if (mode.kind === 'walk') {
        const dir = Math.sign(mode.target - x);
        x += dir * ch.speed * dt;
        if (dir === 0 || (dir > 0 && x >= mode.target) || (dir < 0 && x <= mode.target)) {
          x = mode.target;
          toIdle();
        }
        render();
      }
    }
    raf = requestAnimationFrame(frame);
  }

  // ── 5. 說話：從台詞池挑一句，冒泡泡 ──
  function say(trigger: LineTrigger) {
    const text = pickLine(ch.lines, { trigger, sceneId: scene.id, phase: view.phase }, rng, lastLine);
    if (!text) return;
    lastLine = text;
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ch.bubble.durationMs);
  }

  function onPet(e: Event) {
    e.stopPropagation();
    if (busy) return;
    toIdle(ch.bubble.durationMs + 400); // 說話時停下來
    render();
    body.classList.remove('hop');
    void body.offsetWidth; // 重新觸發動畫
    body.classList.add('hop');
    say('click');
    bridge.poke().then(setView, (err) => console.warn('[whale-pet] poke failed', err));
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPet(e); }
  };
  pet.addEventListener('click', onPet);
  pet.addEventListener('keydown', onKey);
  body.addEventListener('animationend', () => body.classList.remove('hop'));

  // ── 6. 換場景：黑幕淡入 → 通知 host 存檔 → 換背景與出生點 → 淡出 → 說進場台詞 ──
  async function goto(sceneId: SceneId, spawn?: string) {
    if (busy || disposed || sceneId === scene.id) return;
    busy = true;
    bubble.classList.remove('show');
    fade.classList.add('on');
    await wait(FADE_MS);
    try {
      setView(await bridge.setScene(sceneId)); // host 是唯一真相：存檔成功才換
      applyScene(findScene(view.sceneId), spawn);
    } catch (err) {
      console.warn('[whale-pet] setScene failed', err);
    }
    fade.classList.remove('on');
    await wait(FADE_MS);
    busy = false;
    if (scene.id === sceneId) say('enter');
  }

  // ── 7. 與 host 同步：打開時 visit 一次，之後輪詢 ──
  async function visit() {
    const v = await bridge.visit();
    setView(v);
    if (!scene || v.sceneId !== scene.id) applyScene(findScene(v.sceneId));
    if (v.awayMinutes >= WELCOME_AFTER_MIN) say('welcome');
  }

  async function poll() {
    if (busy || disposed || doc.visibilityState !== 'visible') return;
    try {
      // 用 visit：畫面開著就代表主人在，更新「上次見面」時間（見 pixel-stage.ts 的說明）
      const v = await bridge.visit();
      setView({ ...v, awayMinutes: 0 });
      // 例如模型用 tool 把她帶去花園：畫面跟著換，但不再寫回 host
      if (v.sceneId !== scene.id && !busy) applyScene(findScene(v.sceneId));
    } catch (err) {
      console.warn('[whale-pet] poll failed', err);
    }
  }
  const pollTimer = setInterval(poll, opts.pollMs ?? 60_000);

  const onVisible = () => {
    if (doc.visibilityState === 'visible') void visit().catch((err) => console.warn('[whale-pet] visit failed', err));
  };
  doc.addEventListener('visibilitychange', onVisible);

  await visit();
  raf = requestAnimationFrame(frame);

  return {
    goto,
    say,
    visit,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(pollTimer);
      clearTimeout(bubbleTimer);
      doc.removeEventListener('visibilitychange', onVisible);
      stage.remove();
    },
  };
}

/** 讀圖拿到單幀寬高比；sheet 為水平排列 */
function loadSprite(def: SpriteDef, url: string): Promise<{ url: string; aspect: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ url, aspect: `${img.naturalWidth / (def.frames ?? 1)} / ${img.naturalHeight}` });
    img.onerror = () => reject(new Error(`sprite 載入失敗：${url}`));
    img.src = url;
  });
}
