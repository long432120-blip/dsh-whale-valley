// AI 設定：API Key 從哪裡來。
// 優先順序（前面的優先）：
//   1. DSH 插件設定（Config 的 ai.apiKey；設定畫面上是密碼欄位）
//   2. 環境變數 DEEPSEEK_API_KEY（或 WHALE_AI_API_KEY）
//   3. .env 檔（存檔資料夾裡的 .env，或啟動目錄的 .env）
// 都沒有就是「沒有 Key」：AI 對話自動關閉，遊戲照常用 JSON 台詞。
import { readFileSync } from 'node:fs';
import type { ChatApiConfig } from './ai-client.ts';

export interface AiUserConfig {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface ResolvedAiConfig extends ChatApiConfig {
  enabled: boolean;
  /** Key 是從哪裡來的（只給 log 用，不含 Key 本身） */
  keySource: 'config' | 'env' | 'dotenv' | 'none';
}

export const AI_DEFAULTS = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', timeoutMs: 8000 };

/** 很小的 .env 解析：KEY=VALUE，支援 # 註解和引號；不會覆蓋已經存在的環境變數 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]!] = v;
  }
  return out;
}

export function readDotEnv(paths: string[]): Record<string, string> {
  for (const p of paths) {
    try {
      return parseDotEnv(readFileSync(p, 'utf8'));
    } catch {
      // 沒有這個檔：試下一個
    }
  }
  return {};
}

export function resolveAiConfig(user: AiUserConfig | undefined, env: Record<string, string | undefined>, dotenv: Record<string, string> = {}): ResolvedAiConfig {
  const pick = (k: string) => env[k] || undefined;
  const fromEnv = pick('DEEPSEEK_API_KEY') ?? pick('WHALE_AI_API_KEY');
  const fromDot = dotenv.DEEPSEEK_API_KEY || dotenv.WHALE_AI_API_KEY || undefined;
  const apiKey = (user?.apiKey || fromEnv || fromDot || '').trim();
  const keySource = user?.apiKey ? 'config' : fromEnv ? 'env' : fromDot ? 'dotenv' : 'none';
  return {
    enabled: user?.enabled ?? true,
    apiKey,
    keySource,
    baseUrl: user?.baseUrl || pick('DEEPSEEK_BASE_URL') || dotenv.DEEPSEEK_BASE_URL || AI_DEFAULTS.baseUrl,
    model: user?.model || pick('DEEPSEEK_MODEL') || dotenv.DEEPSEEK_MODEL || AI_DEFAULTS.model,
    timeoutMs: user?.timeoutMs ?? (Number(pick('DEEPSEEK_TIMEOUT_MS') || dotenv.DEEPSEEK_TIMEOUT_MS) || AI_DEFAULTS.timeoutMs),
  };
}

/** log 用：只顯示 Key 的前 3 碼和後 4 碼 */
export const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : k ? '***' : '(none)');
