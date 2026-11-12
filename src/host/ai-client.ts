// 呼叫 DeepSeek 的 /chat/completions。V0.20 起實作在 shared/ai-fetch.ts（瀏覽器也用得到），這裡保留舊的匯入路徑。
export { chatCompletion, type ChatApiConfig, type ChatApiResult } from '../shared/ai-fetch.ts';
