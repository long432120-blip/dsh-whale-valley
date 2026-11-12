// Host 入口（package.json 的 exports["."]）。
//
// 已對照實機的 DSH 0.2.1-rc.5（cordis 4.1.0 / schemastery 3.19.0 / dsh-tools / dsh-host-webserver）
// 確認過 API，原本標 ⚠ 的三處都已經換成實測寫法：
//   1. Schema 來自 @deepseek-ai/schemastery 的 default export（cordis 沒有匯出 Schema）
//   2. 通道是 ctx.webServer.register({ kind, path, handler })，handler 是 node:http 的 (req, res)，
//      不是 Koa 的 ctx.server.post
//   3. tool 是 ctx.tools.register({ name, description, parameters, output, execute })
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Schema from '@deepseek-ai/schemastery';
import { BadRequest, handleBridgeCall, whalePetTools, type PetApi, type ToolDef } from './routes.ts';
import { WhalePetService, type WhalePetConfig } from './service.ts';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { musicWhitelist, serveFile, serveMusic } from './music-route.ts';
import { BOOT_JS, WINDOW_HTML } from './window-page.ts';
import { launchGameWindow } from './open-window.ts';
import musicJson from '../../packs/whale-girl-pixel/music.json';

export const name = 'dsh-whale-valley';

/** 依賴的宿主服務：tools（註冊 tool）、webServer（瀏覽器通道） */
export const inject = ['tools', 'webServer'];

export type Config = WhalePetConfig;
export const Config = Schema.object({
  storageDir: Schema.string().description('存檔目錄；留空 = ~/.dsh/storages/dsh-whale-valley（舊版的 dsh-whale-pet 資料夾還在就沿用）'),
  initialScene: Schema.string().default('room').description('第一次見面時所在的場景 id'),
  // V0.8：AI 對話。API Key 只存在 host；留空就讀環境變數 DEEPSEEK_API_KEY，再沒有就讀 .env
  ai: Schema.object({
    enabled: Schema.boolean().default(true).description('讓鯨魚娘和居民用 AI 說話（失敗時自動改用內建台詞）'),
    // 已確認：DSH 的 dsh-settings 會對 role('secret') 做結構性遮蔽（redactSecrets），
    // 遠端讀取讀不回這個欄位，所以 Key 不會流到瀏覽器。
    apiKey: Schema.string().role('secret').description('DeepSeek（或 OpenAI 相容服務）的 API Key；留空 = 讀環境變數 DEEPSEEK_API_KEY 或 .env'),
    baseUrl: Schema.string().default('https://api.deepseek.com').description('API 網址（不含 /chat/completions）'),
    model: Schema.string().default('deepseek-chat').description('模型名稱'),
    timeoutMs: Schema.number().default(8000).description('逾時（毫秒）'),
  }).description('AI 對話'),
});

// ───────────── 宿主服務的最小介面（這兩條服務沒有出貨 .d.ts，所以自己宣告形狀）─────────────
interface WebServerService {
  /** 回傳移除這條路由的 disposer */
  register(route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void;
  }): () => void;
  /** 這個部署對外的位址（V0.25：開獨立視窗時用它組網址，不信任瀏覽器送來的 Host） */
  getOrigin?(): string;
}

interface DshToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render: (args: Record<string, unknown>, value: unknown) => unknown;
  };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface ToolsService {
  register(definition: DshToolDefinition): () => void;
}

/** 瀏覽器通道的路由前綴，要跟 client/bridge-dsh.ts 的 fetchTransport() 預設值一致 */
const ROUTE_PREFIX = '/api/dsh-whale-valley';
/** 請求 body 上限；這個通道只收小封包（sceneId / GameAction / ChatRequest） */
const MAX_BODY_BYTES = 256 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** 讀完整個 body 再 JSON.parse；上限 256 KiB，避免被塞爆記憶體 */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new BadRequest('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new BadRequest('body must be JSON'));
      }
    });
    req.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
  });
}

/** POST /api/dsh-whale-valley/<method> → handleBridgeCall */
// V0.22：背景音樂（GET /api/dsh-whale-valley/music/<檔名>）。打包後這個檔案在 lib/index.js，音樂在 ../packs/…
const MUSIC_OK = musicWhitelist(musicJson);
const MUSIC_DIR = (() => {
  for (const rel of ['../packs/whale-girl-pixel/music/', '../../packs/whale-girl-pixel/music/']) {
    try {
      const dir = fileURLToPath(new URL(rel, import.meta.url));
      if (existsSync(dir)) return dir;
    } catch { /* 試下一個 */ }
  }
  return null;
})();

// V0.23 模式 B：獨立視窗的遊戲頁用的 client.js（就是這個資料夾旁邊的 lib/client.js）
const CLIENT_JS = (() => {
  try {
    const p = fileURLToPath(new URL('./client.js', import.meta.url));
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
})();

/** 最近一次「遊戲畫面」呼叫 host 通道的時間；用來判斷獨立視窗是不是還開著 */
let lastClientAt = 0;
/** 這個部署對外的位址（apply() 時從 webServer.getOrigin() 拿） */
let originOverride: string | null = null;

async function handleBridgeRoute(api: PetApi, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const musicPrefix = `${ROUTE_PREFIX}/music/`;
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

  // V0.25：請 host 用系統瀏覽器開一個獨立視窗（DSH 桌面版會擋 window.open）
  if (path === `${ROUTE_PREFIX}/open-window`) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: '只接受 POST' });
      return;
    }
    let force = false;
    try {
      const body = (await readJsonBody(req)) as { force?: unknown } | null;
      force = body?.force === true;
    } catch { /* 沒有 body 或不是 JSON → 當作不強制 */ }
    // 最近 40 秒內有遊戲畫面在呼叫通道 → 視窗應該還開著，不重複開（強制時照開）
    if (!force && lastClientAt > 0 && Date.now() - lastClientAt < 40_000) {
      sendJson(res, 200, { ok: true, alreadyOpen: true, mode: 'app' });
      return;
    }
    const origin = originOverride ?? `http://${req.headers.host ?? '127.0.0.1'}`;
    const url = `${origin.replace(/\/+$/, '')}${ROUTE_PREFIX}/play`;
    const result = launchGameWindow(url);
    sendJson(res, 200, { ...result, alreadyOpen: false, url: result.ok ? undefined : url });
    return;
  }

  // V0.23 模式 B：🪟 開新視窗玩
  if (req.method === 'GET' || req.method === 'HEAD') {
    const head = { 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
    if (path === `${ROUTE_PREFIX}/play`) {
      res.writeHead(200, { ...head, 'content-type': 'text/html; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : WINDOW_HTML);
      return;
    }
    if (path === `${ROUTE_PREFIX}/play/boot.js`) {
      res.writeHead(200, { ...head, 'content-type': 'text/javascript; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : BOOT_JS);
      return;
    }
    if (path === `${ROUTE_PREFIX}/play/client.js`) {
      if (!CLIENT_JS) {
        res.writeHead(404).end();
        return;
      }
      await serveFile(req, res, CLIENT_JS, 'text/javascript; charset=utf-8', 'no-cache').catch(() => { if (!res.headersSent) res.writeHead(500).end(); else res.destroy(); });
      return;
    }
  }
  if (path.startsWith(musicPrefix)) {
    let name = '';
    try { name = decodeURIComponent(path.slice(musicPrefix.length)); } catch { /* 壞掉的網址 → 404 */ }
    if (!MUSIC_DIR || !name) {
      res.writeHead(404).end();
      return;
    }
    await serveMusic(req, res, MUSIC_DIR, MUSIC_OK, name).catch(() => { if (!res.headersSent) res.writeHead(500).end(); else res.destroy(); });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: '只接受 POST' });
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith(`${ROUTE_PREFIX}/`)) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  const method = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));
  lastClientAt = Date.now(); // 有遊戲畫面在跑（DSH 裡或獨立視窗）
  try {
    const body = await readJsonBody(req);
    sendJson(res, 200, await handleBridgeCall(api, method, body));
  } catch (err) {
    if (err instanceof BadRequest) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    // 安全規則：內部錯誤的細節只寫進 host log，不回傳給瀏覽器
    console.error('[whale-pet] bridge 內部錯誤：', err);
    sendJson(res, 500, { error: 'internal error' });
  }
}

/** routes.ts 的 ToolDef（純函數、有測試）→ DSH 的 tool 定義 */
function toDshTool(t: ToolDef): DshToolDefinition {
  return {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    output: {
      // 這兩個 tool 都回傳純文字摘要
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    execute: (args) => t.handler(args),
  };
}

export function apply(ctx: Context, config: Config) {
  ctx.plugin(WhalePetService, config);

  ctx.inject(['whalePet'], (ctx) => {
    const api = ctx.whalePet;
    const webServer = (ctx as unknown as { webServer: WebServerService }).webServer;
    const tools = (ctx as unknown as { tools: ToolsService }).tools;
    // V0.25：開獨立視窗時用 DSH 自己的對外位址，不讀瀏覽器送來的 Host
    try {
      originOverride = typeof webServer.getOrigin === 'function' ? webServer.getOrigin() : null;
    } catch {
      originOverride = null;
    }

    // 1. 瀏覽器 → host：POST /api/dsh-whale-valley/<方法>（對應 bridge-dsh.ts 的 fetchTransport）
    //    webServer 是 node:http 載體，handler 自己讀 body、自己寫 response；
    //    DSH 只綁本機位址，所以這個路由預設只有本機連得到。
    ctx.effect(
      () =>
        webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: (req, res) => {
            void handleBridgeRoute(api, req, res);
          },
        }),
      'dsh-whale-valley: bridge route',
    );
    console.info(`[whale-pet] 通道已註冊：POST ${ROUTE_PREFIX}/<visit|getView|setScene|poke|act|gameplay|chat>、GET ${ROUTE_PREFIX}/music/<檔名>、GET ${ROUTE_PREFIX}/play（獨立視窗）${MUSIC_DIR ? '' : '（找不到音樂資料夾，DSH 裡不會有背景音樂）'}`);

    // 2. tool：讓模型查狀態、幫忙餵她／澆水／收成
    for (const t of whalePetTools(api)) {
      const definition = toDshTool(t);
      ctx.effect(() => tools.register(definition), `dsh-whale-valley: tool ${definition.name}`);
      console.info(`[whale-pet] tool 已註冊：${definition.name}`);
    }
  });
}
