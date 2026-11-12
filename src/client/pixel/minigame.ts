// 釣魚小遊戲（核心第 3 輪）：指針在橫條上來回，點一下（或空白鍵、Enter）停下來。
// 停在黃色區 = perfect、綠色區 = good、其他 = miss；5 秒內沒按也算 miss。
// 結果只是「品質」，釣到什麼仍由 host 決定。
import type { FishQuality } from '../../shared/gameplay-types.ts';

export interface MinigameConfig {
  zone: number;
  perfectZone: number;
  speed: number;
}

const KEY = 'whale-pet:minigame';

/** 小遊戲開關（存在這個瀏覽器）；預設開 */
export function minigameEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}
export function setMinigameEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // 無痕模式等情況存不了：這次開著的頁面仍然有效
  }
}

export function playMinigame(stage: HTMLElement, cfg: MinigameConfig, rng: () => number = Math.random): Promise<FishQuality> {
  const doc = stage.ownerDocument;
  const win = doc.defaultView ?? window;
  const box = doc.createElement('div');
  box.className = 'px-mini';
  box.setAttribute('role', 'button');
  box.tabIndex = 0;
  box.textContent = '魚上鉤了！在綠色區按下去（點一下或空白鍵）';
  const bar = doc.createElement('div');
  bar.className = 'px-mini-bar';
  const zoneW = Math.min(0.8, Math.max(0.05, cfg.zone));
  const zoneX = 0.08 + rng() * (0.84 - zoneW);
  const pw = Math.min(zoneW, cfg.perfectZone);
  const px = zoneX + (zoneW - pw) / 2;
  const zone = doc.createElement('div');
  zone.className = 'px-mini-zone';
  zone.style.left = `${zoneX * 100}%`;
  zone.style.width = `${zoneW * 100}%`;
  const perfect = doc.createElement('div');
  perfect.className = 'px-mini-perfect';
  perfect.style.left = `${px * 100}%`;
  perfect.style.width = `${pw * 100}%`;
  const needle = doc.createElement('div');
  needle.className = 'px-mini-needle';
  bar.append(zone, perfect, needle);
  box.append(bar);
  stage.append(box);
  stage.dataset.minigame = '1';
  box.focus({ preventScroll: true });

  return new Promise((resolve) => {
    const start = performance.now();
    let pos = 0;
    let raf = 0;
    let done = false;
    const finish = (q: FishQuality) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      win.clearTimeout(timer);
      doc.removeEventListener('keydown', onKey, true);
      box.textContent = q === 'perfect' ? '完美！' : q === 'good' ? '釣到了！' : '跑掉了……';
      delete stage.dataset.minigame;
      win.setTimeout(() => box.remove(), 450);
      resolve(q);
    };
    const judge = () => finish(pos >= px && pos <= px + pw ? 'perfect' : pos >= zoneX && pos <= zoneX + zoneW ? 'good' : 'miss');
    const frame = (t: number) => {
      const phase = (((t - start) / 1000) * cfg.speed) % 2;
      pos = phase <= 1 ? phase : 2 - phase; // 0 → 1 → 0 來回
      needle.style.left = `${pos * 100}%`;
      raf = requestAnimationFrame(frame);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        judge();
      }
    };
    box.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      judge();
    });
    doc.addEventListener('keydown', onKey, true);
    const timer = win.setTimeout(() => finish('miss'), 5000);
    raf = requestAnimationFrame(frame);
  });
}
