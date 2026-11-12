// V0.9：DSH llm 轉接層的單元測試（用假的 llm 服務，不打真的 API）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmChat } from '../src/host/ai-llm.ts';

const MSG = [{ role: 'user' as const, content: '你好' }];

function fakeCtx(opts: {
  chunks?: unknown[];
  throwAt?: number;
  selection?: { provider?: string; model?: string; reasoningEffort?: string };
  noLlm?: boolean;
  noDefaults?: boolean;
} = {}) {
  const llm = {
    stream(options: Record<string, unknown>) {
      return (async function* () {
        const chunks = opts.chunks ?? [
          { type: 'text-delta', index: 0, text: '噗' },
          { type: 'text-delta', index: 0, text: '嚕～' },
          { type: 'finish', reason: { kind: 'stop' } },
        ];
        for (let i = 0; i < chunks.length; i++) {
          if (opts.throwAt === i) throw new Error('boom');
          yield chunks[i];
        }
      })();
    },
  };
  const defaults = { currentSelection: () => opts.selection ?? { provider: 'deepseek', model: 'deepseek-chat' } };
  return {
    get(name: string) {
      if (name === 'llm') return opts.noLlm ? undefined : llm;
      if (name === 'agentDefaultModel') return opts.noDefaults ? undefined : defaults;
      return undefined;
    },
  };
}

test('沒有 llm 服務時回傳 undefined（退回 JSON 台詞）', () => {
  assert.equal(createLlmChat(fakeCtx({ noLlm: true })), undefined);
});

test('把 text-delta 串起來變成完整句子', async () => {
  const chat = createLlmChat(fakeCtx())!;
  const res = await chat({ messages: MSG, timeoutMs: 5000 });
  assert.deepEqual(res, { ok: true, text: '噗嚕～' });
});

test('宿主沒有預設模型 → no_key', async () => {
  const chat = createLlmChat(fakeCtx({ noDefaults: true }))!;
  const res = await chat({ messages: MSG, timeoutMs: 5000 });
  assert.equal(res.ok, false);
  assert.equal((res as { reason: string }).reason, 'no_key');
});

test('finish 是 error → http（並帶錯誤訊息）', async () => {
  const chat = createLlmChat(fakeCtx({
    chunks: [{ type: 'finish', reason: { kind: 'error', failure: { message: '模型不存在' } } }],
  }))!;
  const res = await chat({ messages: MSG, timeoutMs: 5000 });
  assert.equal(res.ok, false);
  assert.equal((res as { reason: string }).reason, 'http');
  assert.match((res as { detail: string }).detail, /模型不存在/);
});

test('finish 是 aborted（不是我們逾時）→ network', async () => {
  const chat = createLlmChat(fakeCtx({
    chunks: [{ type: 'finish', reason: { kind: 'aborted' } }],
  }))!;
  const res = await chat({ messages: MSG, timeoutMs: 5000 });
  assert.equal((res as { reason: string }).reason, 'network');
});

test('串流中途丟例外 → network，不會讓遊戲卡住', async () => {
  const chat = createLlmChat(fakeCtx({ throwAt: 1 }))!;
  const res = await chat({ messages: MSG, timeoutMs: 5000 });
  assert.equal(res.ok, false);
  assert.equal((res as { reason: string }).reason, 'network');
});

test('只有空白也算 bad_response', async () => {
  const chat = createLlmChat(fakeCtx({
    chunks: [{ type: 'text-delta', index: 0, text: '   ' }, { type: 'finish', reason: { kind: 'stop' } }],
  }))!;
  const res = await chat({ messages: MSG, timeoutMs: 5000 });
  assert.equal((res as { reason: string }).reason, 'bad_response');
});

test('訊息會轉成 DSH 的 content block 格式', async () => {
  let seen: Record<string, unknown> | undefined;
  const ctx = {
    get(name: string) {
      if (name === 'llm') {
        return {
          stream(options: Record<string, unknown>) {
            seen = options;
            return (async function* () {
              yield { type: 'text-delta', text: 'ok' };
              yield { type: 'finish', reason: { kind: 'stop' } };
            })();
          },
        };
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) };
      return undefined;
    },
  };
  const chat = createLlmChat(ctx)!;
  await chat({ messages: [{ role: 'system', content: '你是鯨魚娘' }, { role: 'user', content: '嗨' }], timeoutMs: 5000, temperature: 0.8, maxTokens: 60 });
  assert.equal(seen?.provider, 'p');
  assert.equal(seen?.model, 'm');
  assert.equal(seen?.temperature, 0.8);
  assert.equal(seen?.maxTokens, 60);
  assert.deepEqual((seen?.messages as unknown[])[0], { role: 'system', content: [{ type: 'text', text: '你是鯨魚娘' }] });
});
