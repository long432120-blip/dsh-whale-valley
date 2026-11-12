// V0.25：把遊戲開成「獨立視窗」。
//
// 為什麼不是 window.open：
//   DSH 桌面版（Electron）對主視窗設了
//     view.webContents.setWindowOpenHandler(({ url }) => {
//       if (destination.protocol === 'https:') shell.openExternal(url)   // 只把 https 丟給系統瀏覽器
//       return { action: 'deny' }                                        // 其他一律拒絕
//     });
//   所以插件用 window.open('http://127.0.0.1:<port>/api/dsh-whale-valley/play') 會被直接擋掉，
//   畫面不會有任何反應（V0.23／V0.24 的「🪟 開新視窗玩」在桌面版就是這樣）。
//
// 現在的做法：由 host 呼叫系統的 Chromium 系瀏覽器，用 `--app=<url>` 開一個沒有網址列、沒有分頁列的視窗，
// 看起來就是一個獨立的小程式；找不到 Chrome／Edge 才退回系統預設瀏覽器。
// 這條網址是插件自己的路由（不是 DSH 的 index），不需要 DSH 的登入 cookie。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type LaunchMode = 'app' | 'browser' | 'failed';

export interface LaunchResult {
  ok: boolean;
  mode: LaunchMode;
  /** 用了哪個瀏覽器（app 模式才有） */
  browser?: string;
}

interface BrowserCandidate {
  name: string;
  paths: string[];
}

function candidate(name: string, dirs: (string | undefined)[], exe: string): BrowserCandidate {
  return { name, paths: dirs.filter((d): d is string => !!d).map((d) => join(d, exe)) };
}

/** Windows 上一定要有的 Edge，加上常見的 Chrome（都用 --app 模式） */
const WINDOWS_BROWSERS: BrowserCandidate[] = [
  candidate('Chrome', [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']], 'Google/Chrome/Application/chrome.exe'),
  candidate('Edge', [process.env['PROGRAMFILES(X86)'], process.env['PROGRAMFILES']], 'Microsoft/Edge/Application/msedge.exe'),
];

function findAppBrowser(): { name: string; exe: string } | null {
  if (process.platform !== 'win32') return null;
  for (const b of WINDOWS_BROWSERS) {
    for (const p of b.paths) {
      try {
        if (existsSync(p)) return { name: b.name, exe: p };
      } catch { /* 沒有權限看就算了 */ }
    }
  }
  return null;
}

function detach(argv: string[]): void {
  const child = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: false });
  // 開不起來時不要讓它變成未處理的錯誤（例：瀏覽器被移除、路徑消失）
  child.on('error', (err) => console.warn('[whale-pet] 開視窗失敗：', (err as Error).message));
  child.unref();
}

/**
 * 用系統瀏覽器開一個獨立視窗。
 * @param url 遊戲頁的完整網址（由 host 用 webServer.getOrigin() 組出來，不信任瀏覽器送來的 Host）
 */
export function launchGameWindow(url: string): LaunchResult {
  try {
    if (process.platform === 'win32') {
      const app = findAppBrowser();
      if (app) {
        detach([app.exe, `--app=${url}`, '--window-size=1280,900', '--no-first-run', '--no-default-browser-check']);
        return { ok: true, mode: 'app', browser: app.name };
      }
      // 沒有 Chrome／Edge：交給系統預設瀏覽器（一般瀏覽器視窗，也會是獨立的一個視窗）
      detach(['cmd.exe', '/c', 'start', '', url]);
      return { ok: true, mode: 'browser' };
    }
    if (process.platform === 'darwin') {
      detach(['open', url]);
      return { ok: true, mode: 'browser' };
    }
    detach(['xdg-open', url]);
    return { ok: true, mode: 'browser' };
  } catch (err) {
    console.warn('[whale-pet] 開視窗失敗：', err);
    return { ok: false, mode: 'failed' };
  }
}
