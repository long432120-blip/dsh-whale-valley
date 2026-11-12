// V0.20：單機版的 AI 對話（玩家自己的 DeepSeek API Key，存在瀏覽器 localStorage）
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AiFile, ChatRequest, DialogueSnapshot } from '../src/shared/ai.ts';
import {
  AIChatService, explainFailure, looksLikeKey, maskKey, PLAYER_KEY_STORAGE, PLAYER_MEMORY_STORAGE, type KeyValueStore,
} from '../src/client/ai-browser.ts';

const root = join(import.meta.dirname, '..');
const aiFile = JSON.parse(await readFile(join(root, 'packs/whale-girl-pixel/ai.json'), 'utf8')) as AiFile;
// 假的 Key（測試用，不是真的）
// 測試用的 Key：執行時才拼出 sk- 開頭的格式（looksLikeKey 要測），原始碼裡不放任何像 Key 的字串
const KEY = ['sk', 'x'.repeat(28) + 'cdef'].join('-');

const snapshot: DialogueSnapshot = {
  scene: '室內房間', season: '春季第 3 天', phase: '晚上', clock: '20:00', weather: '雨天',
  stamina: 30, staminaMax: 100, satiety: 15, satietyMax: 100, affection: 120, level: '熟悉', married: false, coins: 50,
  mood: ['肚子很餓'], inventory: ['鬆餅×1'], pets: [],
};
const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({ speaker: 'whale', trigger: 'click', snapshot, ...over });

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
}
type Body = { model: string; max_tokens: number; messages: { role: string; content: string }[] };
function fakeFetch(reply: (body: Body, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: Body }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Body;
    calls.push({ url, init, body });
    return reply(body, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

test('ai.json：最近 3 輪記憶、max_tokens 100、3 秒防抖（玩家的要求）', () => {
  assert.equal(aiFile.historyTurns, 3);
  assert.equal(aiFile.maxTokens, 100);
  assert.equal(aiFile.minIntervalMs, 3000);
});

test('沒有填 Key：回傳 no_key，不會發任何請求（畫面改用內建台詞）', async () => {
  const { f, calls } = fakeFetch(() => ok('不會用到'));
  const ai = new AIChatService(aiFile, { store: memStore(), fetch: f });
  assert.equal(ai.hasKey, false);
  assert.deepEqual(await ai.chat(req()), { ok: false, reason: 'no_key' });
  assert.equal(calls.length, 0);
});

test('有 Key：打 DeepSeek 的 /chat/completions，deepseek-chat、max_tokens 100、狀態寫進 System Prompt', async () => {
  const { f, calls } = fakeFetch(() => ok('主人～下雨了，肚子好餓喔，可以吃鬆餅嗎？'));
  const store = memStore({ [PLAYER_KEY_STORAGE]: KEY });
  const ai = new AIChatService(aiFile, { store, fetch: f });
  const r = await ai.chat(req());
  assert.deepEqual(r, { ok: true, text: '主人～下雨了，肚子好餓喔，可以吃鬆餅嗎？', source: 'ai' });
  const c = calls[0]!;
  assert.equal(c.url, 'https://api.deepseek.com/chat/completions');
  assert.equal((c.init.headers as Record<string, string>).authorization, `Bearer ${KEY}`);
  assert.equal(c.body.model, 'deepseek-chat');
  assert.equal(c.body.max_tokens, 100);
  const system = c.body.messages[0]!;
  assert.equal(system.role, 'system');
  for (const s of ['鯨魚娘', '晚上（20:00）', '天氣雨天', '室內房間', '體力 30/100', '飽食度 15/100', '好感 120', '肚子很餓']) {
    assert.ok(system.content.includes(s), `System Prompt 少了「${s}」`);
  }
  assert.ok(!system.content.includes(KEY), 'Key 不可以出現在 prompt 裡');
});

test('短期記憶：只帶最近 3 輪；記在 localStorage（重新整理還記得）', async () => {
  let n = 0;
  const { f, calls } = fakeFetch(() => ok(`第${++n}句`));
  let t = 0;
  const store = memStore({ [PLAYER_KEY_STORAGE]: KEY });
  const ai = new AIChatService(aiFile, { store, fetch: f, now: () => t });
  for (let i = 0; i < 5; i++) {
    t += 10_000;
    assert.equal((await ai.chat(req())).ok, true);
  }
  const last = calls.at(-1)!.body.messages;
  // system + 3 輪（user/assistant 各 3）+ 這一輪的 user
  assert.equal(last.length, 1 + 3 * 2 + 1);
  assert.deepEqual(last.filter((m) => m.role === 'assistant').map((m) => m.content), ['第2句', '第3句', '第4句']);
  assert.ok(store.data.get(PLAYER_MEMORY_STORAGE)?.includes('第5句'));
  // 重新開一個（模擬重新整理）：記憶還在
  const again = new AIChatService(aiFile, { store, fetch: f, now: () => t + 10_000 });
  await again.chat(req());
  assert.ok(calls.at(-1)!.body.messages.some((m) => m.content === '第5句'));
});

test('防抖：3 秒內連點只送第一次，其他回傳 rate_limited（畫面用內建台詞）', async () => {
  const { f, calls } = fakeFetch(() => ok('嗯？'));
  let t = 100_000;
  const ai = new AIChatService(aiFile, { store: memStore({ [PLAYER_KEY_STORAGE]: KEY }), fetch: f, now: () => t });
  assert.equal((await ai.chat(req())).ok, true);
  t += 1000;
  const r = await ai.chat(req());
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'rate_limited');
  t += 2500;
  assert.equal((await ai.chat(req())).ok, true);
  assert.equal(calls.length, 2);
});

test('10 秒超時：AbortController 中止，回傳 timeout，不會一直等', async () => {
  const f = ((_url: string, init: RequestInit) => new Promise<Response>((_ok, fail) => {
    init.signal!.addEventListener('abort', () => fail(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })) as unknown as typeof fetch;
  const ai = new AIChatService(aiFile, { store: memStore({ [PLAYER_KEY_STORAGE]: KEY }), fetch: f, timeoutMs: 30 });
  const r = await ai.chat(req());
  assert.deepEqual(r, { ok: false, reason: 'timeout' });
});

test('API 報錯、網路斷線、回應壞掉：都回傳 ok:false，不丟例外', async () => {
  const cases: [() => Response | Promise<Response>, string][] = [
    [() => new Response('{"error":{"message":"Authentication Fails"}}', { status: 401 }), 'http'],
    [() => new Response('busy', { status: 503 }), 'http'],
    [() => { throw new TypeError('Failed to fetch'); }, 'network'],
    [() => new Response('not json', { status: 200 }), 'bad_response'],
  ];
  let t = 0;
  for (const [reply, reason] of cases) {
    const { f } = fakeFetch(reply);
    t += 10_000;
    const ai = new AIChatService(aiFile, { store: memStore({ [PLAYER_KEY_STORAGE]: KEY }), fetch: f, now: () => t });
    const r = await ai.chat(req());
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, reason);
  }
});

test('沒有附遊戲狀態的請求：不送，回傳 bad_request', async () => {
  const { f, calls } = fakeFetch(() => ok('x'));
  const ai = new AIChatService(aiFile, { store: memStore({ [PLAYER_KEY_STORAGE]: KEY }), fetch: f });
  const r = await ai.chat(req({ snapshot: undefined }));
  assert.deepEqual(r, { ok: false, reason: 'bad_request' });
  assert.equal(calls.length, 0);
});

test('🔑 設定：存、遮住顯示、清除（連記憶一起清）', async () => {
  const store = memStore();
  const { f } = fakeFetch(() => ok('好'));
  const ai = new AIChatService(aiFile, { store, fetch: f });
  ai.save(`  ${KEY}  `);
  assert.equal(store.data.get(PLAYER_KEY_STORAGE), KEY);
  assert.equal(ai.masked(), 'sk-…cdef');
  assert.ok(!ai.masked().includes('0123456789'));
  await ai.chat(req());
  assert.ok(store.data.has(PLAYER_MEMORY_STORAGE));
  ai.clear();
  assert.equal(ai.hasKey, false);
  assert.equal(store.data.has(PLAYER_KEY_STORAGE), false);
  assert.equal(store.data.has(PLAYER_MEMORY_STORAGE), false);
  ai.save('   ');
  assert.equal(ai.hasKey, false, '存空白 = 清除');
});

test('測試連線：成功、401、402 翻成玩家看得懂的話；不回傳伺服器原文', async () => {
  const good = new AIChatService(aiFile, { store: memStore(), fetch: fakeFetch(() => ok('好')).f });
  assert.deepEqual(await good.test(KEY), { ok: true });
  const bad = new AIChatService(aiFile, { store: memStore(), fetch: fakeFetch(() => new Response('{"error":"secret detail"}', { status: 401 })).f });
  const r = await bad.test(KEY);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.message.includes('401') && !r.message.includes('secret'));
  assert.ok(explainFailure('http', 402).includes('餘額'));
  assert.deepEqual(await new AIChatService(aiFile, { store: memStore() }).test(), { ok: false, message: '還沒有填 Key。' });
});

test('Key 格式提示、遮罩', () => {
  assert.equal(looksLikeKey(KEY), true);
  assert.equal(looksLikeKey('hello'), false);
  assert.equal(maskKey('abc'), '••••');
});

test('原始碼裡沒有寫死任何 Key', async () => {
  const files = ['src/client/ai-browser.ts', 'src/client/bridge-local.ts', 'src/shared/ai-fetch.ts', 'src/shared/ai-service.ts', 'src/client/pixel/ui-ai-settings.ts', 'packs/whale-girl-pixel/ai.json'];
  for (const p of files) {
    const text = await readFile(join(root, p), 'utf8');
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(text), `${p} 裡有像 Key 的字串`);
  }
});
