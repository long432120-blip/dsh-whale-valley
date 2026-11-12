// V0.9：走 DSH 自己的 LLM 服務（不用另外申請 API Key）。
//
// 宿主提供 `llm` 服務（@deepseek-ai/dsh-llm）：
//   llm.stream({ provider, model, messages, temperature, maxTokens, signal })
//   → 非同步 chunk 串流，文字在 { type:'text-delta', text }，
//     結束是 { type:'finish', reason:{ kind:'stop'|'error'|'aborted' } }
// 目前選定的模型在 `agentDefaultModel` 服務的 currentSelection()。
//
// 這一層刻意做成「可選」：profile 裡沒有 llm 服務（例如純 demo）時回傳 undefined，
// WhaleAi 就會退回原本的 HTTP 直連或 JSON 台詞。
import type { LlmChat, LlmChatRequest } from '../shared/ai-fetch.ts';

/** 型別定義在 shared/ai-fetch.ts（WhaleAi 在瀏覽器也要用） */
export type { LlmChat, LlmChatRequest };

interface LlmChunk {
  type?: string;
  text?: string;
  reason?: { kind?: string; failure?: { message?: unknown; code?: unknown } };
}

interface LlmService {
  stream(options: Record<string, unknown>): AsyncIterable<LlmChunk> | Iterable<LlmChunk>;
}

interface DefaultModelSelection {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}

interface DefaultModelService {
  currentSelection?(): DefaultModelSelection | undefined;
}

/** cordis 的 ctx.get()：拿不到服務就回 undefined，不會丟例外 */
interface ServiceLookup {
  get(name: string): unknown;
}

const short = (v: unknown, n = 200) => String(v ?? '').slice(0, n);

/**
 * 用宿主的 llm 服務做一次性對話。
 * 沒有 llm 服務、或拿不到預設模型時回傳 undefined（呼叫端會退回 JSON 台詞）。
 */
export function createLlmChat(ctx: ServiceLookup): LlmChat | undefined {
  let llm: LlmService | undefined;
  let defaults: DefaultModelService | undefined;
  try {
    llm = ctx.get('llm') as LlmService | undefined;
    defaults = ctx.get('agentDefaultModel') as DefaultModelService | undefined;
  } catch {
    return undefined;
  }
  if (!llm || typeof llm.stream !== 'function') return undefined;

  return async (req) => {
    const sel = defaults?.currentSelection?.();
    const provider = sel?.provider;
    const model = sel?.model;
    if (!provider || !model) return { ok: false, reason: 'no_key', detail: '宿主沒有設定預設模型' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      let text = '';
      const stream = llm!.stream({
        provider,
        model,
        // DSH 的訊息是 content block 陣列
        messages: req.messages.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.content }] })),
        temperature: req.temperature,
        maxTokens: req.maxTokens,
        ...(sel?.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}),
        signal: ctrl.signal,
      });
      for await (const chunk of stream) {
        if (!chunk || typeof chunk !== 'object') continue;
        if (chunk.type === 'text-delta') {
          if (typeof chunk.text === 'string') text += chunk.text;
          continue;
        }
        if (chunk.type === 'finish') {
          const kind = chunk.reason?.kind;
          if (kind === 'error') {
            return { ok: false, reason: 'http', detail: short(chunk.reason?.failure?.message) };
          }
          if (kind === 'aborted') {
            return { ok: false, reason: ctrl.signal.aborted ? 'timeout' : 'network', detail: 'aborted' };
          }
        }
      }
      if (!text.trim()) return { ok: false, reason: 'bad_response', detail: '模型沒有回文字' };
      return { ok: true, text };
    } catch (err) {
      if (ctrl.signal.aborted) return { ok: false, reason: 'timeout' };
      return { ok: false, reason: 'network', detail: short((err as Error)?.message ?? err) };
    } finally {
      clearTimeout(timer);
    }
  };
}
