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
async function handleBridgeRoute(api: PetApi, req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    console.info(`[whale-pet] 通道已註冊：POST ${ROUTE_PREFIX}/<visit|getView|setScene|poke|act|gameplay|chat>`);

    // 2. tool：讓模型查狀態、幫忙餵她／澆水／收成
    for (const t of whalePetTools(api)) {
      const definition = toDshTool(t);
      ctx.effect(() => tools.register(definition), `dsh-whale-valley: tool ${definition.name}`);
      console.info(`[whale-pet] tool 已註冊：${definition.name}`);
    }
  });
}
