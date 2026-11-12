// 呼叫 DeepSeek（或任何 OpenAI 相容的 /chat/completions）。V0.20 從 host 搬到 shared：
// DSH 的 host（Key 在 .env／插件設定）和單機版的瀏覽器（玩家自己填的 Key）共用同一份。
// 只用 fetch、AbortController、setTimeout，Node 22 和瀏覽器都有。
import type { ChatFailReason, ChatMessage } from './ai.ts';

export interface ChatApiConfig {
  /** 例如 https://api.deepseek.com（不含 /chat/completions） */
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export type ChatApiResult = { ok: true; text: string } | { ok: false; reason: ChatFailReason; status?: number; detail?: string };

/**
 * POST {baseUrl}/chat/completions。
 * - 超過 timeoutMs 就中止（AbortController），回傳 timeout。
 * - HTTP 錯誤（401 Key 錯、402 餘額不足、429 太頻繁、5xx）回傳 http + 狀態碼。
 * - 回應不是預期的 JSON 形狀，回傳 bad_response。
 * 不會丟例外：呼叫端只要看 ok。
 */
export async function chatCompletion(
  cfg: ChatApiConfig,
  body: { messages: ChatMessage[]; temperature?: number; max_tokens?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<ChatApiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, stream: false, ...body }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // 錯誤內容可能帶有帳號資訊：只留前 200 字給 log，不回傳給瀏覽器
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      return { ok: false, reason: 'http', status: res.status, detail };
    }
    const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'bad_response' };
    return { ok: true, text };
  } catch (err) {
    if (ctrl.signal.aborted || (err as Error)?.name === 'AbortError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network', detail: String((err as Error)?.message ?? err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** V0.9：DSH 自己的 LLM 服務（host/ai-llm.ts 實作）；回傳形狀跟 chatCompletion 一致 */
export interface LlmChatRequest {
  /** 已經含 system 的完整訊息 */
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
}
export type LlmChat = (req: LlmChatRequest) => Promise<ChatApiResult>;
