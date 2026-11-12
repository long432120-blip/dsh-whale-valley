// demo 用的 AI 小伺服器：`npm run demo:ai`，然後打開 http://127.0.0.1:8787
//
// 為什麼需要它：demo 是純前端（存檔在瀏覽器），但 API Key 絕對不能放進前端。
// 所以由這個只聽本機的伺服器讀 .env 的 DEEPSEEK_API_KEY、替瀏覽器呼叫 DeepSeek；瀏覽器只拿到台詞。
//   - 頁面：demo/pixel-standalone.html，多加一行 <meta name="whale-ai-endpoint" content="/api/ai/chat">
//   - POST /api/ai/chat：{ speaker, trigger, event?, snapshot } → ChatReply
// 快照（遊戲狀態）是瀏覽器送來的，所以一律重新清理過（sanitizeSnapshot）才放進提示詞。
// 正式在 DSH 裡跑時不用這個：host 自己有存檔和設定。
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChatRequest, sanitizeSnapshot, type AiFile, type ChatReply } from '../src/shared/ai.ts';
import { buildDefs } from '../src/shared/gameplay.ts';
import { loadGameplay } from '../src/shared/gameplay-pack.ts';
import { maskKey, readDotEnv, resolveAiConfig } from '../src/host/ai-config.ts';
import { WhaleAi } from '../src/host/ai.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pack = join(root, 'packs/whale-girl-pixel');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = '127.0.0.1'; // 只給自己這台電腦用，不開放給區網

const readJson = (name: string) => {
  try {
    return JSON.parse(readFileSync(join(pack, name), 'utf8')) as unknown;
  } catch {
    return null;
  }
};

const cfg = resolveAiConfig(undefined, process.env, readDotEnv([join(root, '.env')]));
const aiFile = readJson('ai.json') as AiFile;
const gameplay = await loadGameplay(async (n) => readJson(n));
const defs = gameplay ? buildDefs(gameplay) : undefined;
const ai = new WhaleAi(cfg, aiFile, { log: (m) => console.warn(`[ai] ${m}`) });

const page = () => {
  const html = readFileSync(join(root, 'demo/pixel-standalone.html'), 'utf8');
  return html.replace('<head>', '<head>\n<meta name="whale-ai-endpoint" content="/api/ai/chat">');
};

const MAX_BODY = 16 * 1024;

const server = createServer((req, res) => {
  const send = (status: number, type: string, body: string) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    try {
      return send(200, 'text/html; charset=utf-8', page());
    } catch {
      return send(500, 'text/plain; charset=utf-8', '找不到 demo/pixel-standalone.html，請先跑 npm run demo:standalone');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', async () => {
      let reply: ChatReply;
      try {
        const raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { snapshot?: unknown };
        const chat = parseChatRequest(raw, ai.speakers);
        const snap = sanitizeSnapshot(raw.snapshot);
        reply = !chat || !snap ? { ok: false, reason: 'bad_request' } : (ai.unavailable() ?? (await ai.chat(chat, snap, defs)));
      } catch {
        reply = { ok: false, reason: 'bad_request' };
      }
      send(200, 'application/json; charset=utf-8', JSON.stringify(reply));
    });
    return;
  }
  send(404, 'text/plain; charset=utf-8', 'not found');
});

server.listen(PORT, HOST, () => {
  console.log(`鯨魚娘 AI demo：http://${HOST}:${PORT}`);
  console.log(cfg.apiKey
    ? `AI 已開啟（Key ${maskKey(cfg.apiKey)}，來源：${cfg.keySource}；模型 ${cfg.model}）`
    : '沒有找到 DEEPSEEK_API_KEY：AI 關閉，會用內建台詞。把 .env.example 複製成 .env 並填入 Key。');
});
