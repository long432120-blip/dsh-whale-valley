// V0.20：🔑 AI 對話設定（只有單機版有）。玩家填自己的 DeepSeek API Key，存在這台電腦的瀏覽器裡。
// 純畫面：存、清除、測試都交給呼叫的人（bridge.aiSettings）。Key 不會顯示在畫面上（只顯示 sk-…尾碼）。
import { button, el } from './ui-panels-v4.ts';

export interface AiSettingsView {
  hasKey: boolean;
  /** sk-…a1b2；沒有 Key 是空字串 */
  masked: string;
  /** 剛剛做了什麼（存好了、測試結果…） */
  status?: { ok: boolean; text: string } | null;
  busy?: boolean;
  /** 畫面重畫（測試中、測試失敗）時，輸入框裡已經打的字要留著 */
  draft?: string;
}

export function buildAiSettings(doc: Document, v: AiSettingsView, o: {
  onSave(key: string): void;
  onTest(key: string): void;
  onClear(): void;
  onClose(): void;
  onDraft?(text: string): void;
}): HTMLElement {
  const root = el(doc, 'div', 'px-ai-settings');
  root.append(el(doc, 'p', 'px-ai-lead', '填入你自己的 DeepSeek API Key，鯨魚娘就會看著現在的時間、天氣、體力和心情，用 AI 跟你說話。'));

  const now = el(doc, 'div', `px-ai-now ${v.hasKey ? 'on' : 'off'}`, v.hasKey ? `✅ 已經填了 Key：${v.masked}` : '⚪ 還沒有填 Key：她會用內建的台詞說話');
  root.append(now);

  const row = el(doc, 'div', 'px-ai-row');
  const input = doc.createElement('input');
  input.type = 'password';
  input.className = 'px-ai-input';
  input.placeholder = v.hasKey ? '貼上新的 Key 會取代舊的' : '貼上 sk- 開頭的 Key';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'DeepSeek API Key');
  input.value = v.draft ?? '';
  input.addEventListener('input', () => o.onDraft?.(input.value));
  // 在輸入框裡打字不要觸發遊戲的快捷鍵（B 揹包、M 地圖…）
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') o.onSave(input.value);
  });
  const eye = button(doc, '👁', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
  }, { cls: 'px-ai-eye', title: '顯示／隱藏' });
  row.append(input, eye);
  root.append(row);

  const btns = el(doc, 'div', 'px-arcade-btns');
  btns.append(
    button(doc, '💾 儲存', () => o.onSave(input.value), { disabled: v.busy }),
    button(doc, '🧪 測試連線', () => o.onTest(input.value), { disabled: v.busy || (!v.hasKey && !input.value) }),
    button(doc, '🗑 清除 Key', () => o.onClear(), { disabled: v.busy || !v.hasKey }),
  );
  // 有打字才能測試：輸入時更新按鈕
  input.addEventListener('input', () => {
    (btns.children[1] as HTMLButtonElement).disabled = !!v.busy || (!v.hasKey && !input.value.trim());
  });
  root.append(btns);

  if (v.busy) root.append(el(doc, 'div', 'px-ai-status busy', '連線中……（最多等 10 秒）'));
  else if (v.status) root.append(el(doc, 'div', `px-ai-status ${v.status.ok ? 'ok' : 'bad'}`, v.status.text));

  const notes = el(doc, 'ul', 'px-ai-notes');
  for (const t of [
    '🔒 Key 只存在這台電腦的這個瀏覽器（localStorage），只會直接送到 api.deepseek.com，不會上傳到其他地方，也不會寫進存檔。',
    '🖥️ 公用電腦或別人的電腦不要填；不玩了可以按「清除 Key」。',
    '💰 費用從你自己的 DeepSeek 帳戶扣（每次點她大約幾百個 token）。Key 在 platform.deepseek.com 申請。',
    '🌧️ 沒填 Key、網路斷了、10 秒沒回應、或 Key 錯了，她會自動改用內建的台詞，遊戲不會卡住。',
    '⏱️ 連續點她，3 秒內只會問一次 AI；她會記得最近 3 輪對話。',
  ]) notes.append(el(doc, 'li', '', t));
  root.append(notes);

  const foot = el(doc, 'div', 'px-arcade-btns');
  foot.append(button(doc, '✕ 關閉', o.onClose));
  root.append(foot);
  setTimeout(() => input.focus(), 0);
  return root;
}
