// Demo 頁共用的接線：狀態列、時間快轉、重置存檔。
// V0.1（DOM 版）和 V0.2（像素版）、伺服器版和雙擊版都呼叫這裡。
import { LocalBridge } from '../src/client/bridge-local.ts';
import { isDevMode } from '../src/client/dev-flag.ts';
import type { AiFile } from '../src/shared/ai.ts';
import type { GameplayFile } from '../src/shared/gameplay-types.ts';
import type { PetView } from '../src/shared/types.ts';

const HOUR = 3_600_000;
const PHASE_LABEL = { morning: '早上', afternoon: '下午', evening: '傍晚', night: '晚上' } as const;

export interface DemoStage {
  visit(): Promise<void>;
  /** 有的話，「快轉」會在你看著的時候推進時間（她會自己走去下一個地方） */
  refresh?(): Promise<void>;
}

export interface DemoOptions {
  title: string;
  sceneNames: Record<string, string>;
  initialScene: string;
  storageKey: string;
  /** V0.2 玩法定義（釣魚、種菜、商人、好感）；省略 = 只有 V0.1 的走動與對話 */
  gameplay?: GameplayFile | null;
  /** V0.20：角色包的 ai.json；給了，玩家可以在 🔑 設定填自己的 DeepSeek API Key */
  ai?: AiFile;
  mount(root: HTMLElement, bridge: LocalBridge, onView: (v: PetView) => void): Promise<DemoStage>;
}

export async function startDemo(o: DemoOptions): Promise<void> {
  const status = document.getElementById('status')!;
  const showView = (v: PetView) => {
    status.textContent =
      `存檔：${o.sceneNames[v.sceneId] ?? v.sceneId}｜${PHASE_LABEL[v.phase]}｜被戳了 ${v.pokes} 次` +
      (v.game?.season ? `｜${v.game.season.emoji}${v.game.season.name} ${v.game.weather.emoji}` : '') +
      (v.game ? `｜好感 ${v.game.affection}（${v.game.level}）` : '') +
      (v.awayMinutes ? `｜你離開了 ${v.awayMinutes} 分鐘` : '');
  };
  document.title = o.title;
  const bridge = new LocalBridge(o.storageKey, o.initialScene, o.gameplay ?? undefined, o.ai);
  const stage = await o.mount(document.getElementById('app')!, bridge, showView);

  // V0.21：快轉、跳天這些是開發者測試用的，網址加 ?dev 才顯示
  if (isDevMode()) for (const b of document.querySelectorAll<HTMLElement>('.dev-only')) b.hidden = false;

  // 快轉：你一直看著畫面，時間往前跳 3 小時
  document.getElementById('skip')?.addEventListener('click', async () => {
    bridge.debugAdvance(3 * HOUR);
    if (stage.refresh) await stage.refresh();
    else await stage.visit();
  });
  document.getElementById('day')?.addEventListener('click', async () => {
    bridge.debugAdvance(24 * HOUR);
    if (stage.refresh) await stage.refresh();
    else await stage.visit();
  });
  // 離開再回來：模擬關掉畫面 3 小時後重新打開
  document.getElementById('away')?.addEventListener('click', async () => {
    bridge.debugAdvance(3 * HOUR);
    await stage.visit();
  });
  document.getElementById('reset')?.addEventListener('click', () => {
    if (!confirm('確定要從頭開始嗎？\n（目前的存檔會先備份一份，但遊戲裡讀不回來）')) return;
    bridge.debugReset();
    location.reload();
  });
}

/**
 * V0.21：啟動失敗時不要白畫面：顯示原因，給「重新整理」和「備份存檔後重新開始」兩個按鈕。
 */
export function showFatal(err: unknown, storageKey?: string): void {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  const status = document.getElementById('status');
  if (status) status.textContent = `啟動失敗：${msg}`;
  const app = document.getElementById('app');
  if (!app) return;
  app.replaceChildren();
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'max-width:560px;margin:40px auto;padding:20px 24px;border-radius:10px;background:#fff3d6;color:#4a2b17;border:3px solid #6b3f22;line-height:1.6';
  const h = document.createElement('h2');
  h.textContent = '🐋 遊戲打不開…';
  h.style.margin = '0 0 8px';
  const p = document.createElement('p');
  p.textContent = '可能是瀏覽器太舊、存檔壞掉，或檔案沒有完整解壓縮。可以先重新整理；還是不行，就備份存檔後重新開始。';
  const code = document.createElement('code');
  code.textContent = msg.slice(0, 200);
  code.style.cssText = 'display:block;font-size:12px;opacity:.7;margin:8px 0;word-break:break-all';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'border:2px solid #6b3f22;border-radius:6px;padding:5px 12px;background:#ffe6bd;color:#4a2b17;cursor:pointer;font:inherit';
    b.addEventListener('click', fn);
    return b;
  };
  row.append(btn('🔄 重新整理', () => location.reload()));
  if (storageKey) {
    row.append(btn('🗑 備份存檔後重新開始', () => {
      try {
        const text = localStorage.getItem(storageKey);
        if (text) localStorage.setItem(`${storageKey}:backup`, text);
        localStorage.removeItem(storageKey);
        localStorage.removeItem(`${storageKey}:offset`);
      } catch { /* storage 被停用：直接重新整理 */ }
      location.reload();
    }));
  }
  box.append(h, p, code, row);
  app.append(box);
}
