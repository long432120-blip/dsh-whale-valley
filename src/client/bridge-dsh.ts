// DSH 版的 HostBridge。
// ⚠ 不確定：宿主 ↔ 瀏覽器的官方通道在公開資料裡沒有寫清楚。
//   所以把「怎麼傳」抽成 Transport 注入，等調研完只需要實作這一個函數。
//   候選 1：@Remote 方法（參考 dsh-ui-github 的 ADR-0008 / 0009）
//   候選 2：host 註冊 HTTP 路由，前端 fetch（參考 dsh-remote 的 /api/dsh-remote/*、dsh-web-terminal 的路由）
import type { GameAction, GameplayFile } from '../shared/gameplay-types.ts';
import type { ActResult, HostBridge, PetView, SceneId } from '../shared/types.ts';
import type { ChatReply, ChatRequest } from '../shared/ai.ts';
import { SLOT_COUNT, type SlotInfo } from '../shared/save-slots.ts';

export type BridgeMethod = 'visit' | 'getView' | 'setScene' | 'poke' | 'act' | 'gameplay' | 'chat' | 'slotList' | 'slotSave' | 'slotLoad' | 'slotRemove' | 'newGame';
/** 呼叫 host 的某個方法；回傳值依方法不同（PetView / ActResult / GameplayFile） */
export type Transport = (method: BridgeMethod, args?: { sceneId?: SceneId; action?: GameAction; request?: ChatRequest; slot?: number }) => Promise<unknown>;

export function createDshBridge(call: Transport): HostBridge {
  return {
    visit: () => call('visit') as Promise<PetView>,
    getView: () => call('getView') as Promise<PetView>,
    setScene: (sceneId) => call('setScene', { sceneId }) as Promise<PetView>,
    poke: () => call('poke') as Promise<PetView>,
    act: (action) => call('act', { action }) as Promise<ActResult>,
    gameplay: () => call('gameplay') as Promise<GameplayFile | null>,
    // V0.8：AI 對話。只送「誰、為什麼」，不送遊戲狀態（host 自己讀存檔）、更沒有 Key。
    // 連不上就當成失敗，畫面會用 JSON 台詞
    chat: (req) => {
      const { snapshot: _drop, ...request } = req;
      return (call('chat', { request }) as Promise<ChatReply>).catch(() => ({ ok: false, reason: 'network' }) as ChatReply);
    },
    // V0.23：存檔格放在 host 的存檔資料夾（slots/）
    slots: {
      count: SLOT_COUNT,
      list: () => call('slotList') as Promise<SlotInfo[]>,
      save: (slot) => call('slotSave', { slot }) as Promise<SlotInfo[]>,
      load: (slot) => call('slotLoad', { slot }) as Promise<PetView>,
      remove: (slot) => call('slotRemove', { slot }) as Promise<SlotInfo[]>,
      newGame: () => call('newGame') as Promise<PetView>,
    },
  };
}

/** 候選 2 的範例實作（路由前綴是假設值，要配合 host 端實際註冊的位置） */
export function fetchTransport(base = '/api/dsh-whale-valley'): Transport {
  return async (method, args) => {
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    });
    if (!res.ok) throw new Error(`${method} → HTTP ${res.status}`);
    return res.json();
  };
}
