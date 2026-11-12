// 擴展 E1：host 對外的兩個入口，寫成跟 DSH 無關的純函數，方便測試。
//   1. handleBridgeCall：瀏覽器 → host（bridge-dsh.ts 的 fetchTransport 打過來的請求）
//   2. whalePetTools：給模型用的兩個 tool（查狀態、幫忙做事）
// index.ts 只負責把它們掛到 DSH 上（那一段的 API 是推測，標了 ⚠）。
import type { GameAction } from '../shared/gameplay-types.ts';
import type { ActResult, PetView, SceneId } from '../shared/types.ts';
import type { ChatReply } from '../shared/ai.ts';
import { validSlot, type SlotInfo } from '../shared/save-slots.ts';

/** service 需要提供的方法（WhalePetService 已經有；測試時可以換成假的） */
export interface PetApi {
  visit(): Promise<PetView>;
  getView(): Promise<PetView>;
  setScene(id: SceneId): Promise<PetView>;
  poke(): Promise<PetView>;
  act(a: GameAction): Promise<ActResult>;
  gameplay(): Promise<unknown>;
  /** V0.8：AI 對話（參數由 service 自己驗證） */
  chat?(req: unknown): Promise<ChatReply>;
  /** V0.23：存檔格與開新遊戲 */
  slotList?(): Promise<SlotInfo[]>;
  slotSave?(n: number): Promise<SlotInfo[]>;
  slotLoad?(n: number): Promise<PetView>;
  slotRemove?(n: number): Promise<SlotInfo[]>;
  newGame?(): Promise<PetView>;
}

export const BRIDGE_METHODS = ['visit', 'getView', 'setScene', 'poke', 'act', 'gameplay', 'chat', 'slotList', 'slotSave', 'slotLoad', 'slotRemove', 'newGame'] as const;
export type BridgeMethodName = (typeof BRIDGE_METHODS)[number];

export class BadRequest extends Error {}

/** 瀏覽器呼叫 host：只認 BRIDGE_METHODS；參數只收 sceneId、GameAction（type 必須是字串）、ChatRequest、slot（1～3） */
export async function handleBridgeCall(api: PetApi, method: string, body: unknown): Promise<unknown> {
  if (!(BRIDGE_METHODS as readonly string[]).includes(method)) throw new BadRequest(`unknown method: ${method}`);
  const b = (body && typeof body === 'object' ? body : {}) as { sceneId?: unknown; action?: unknown; request?: unknown; slot?: unknown };
  switch (method as BridgeMethodName) {
    case 'visit':
      return api.visit();
    case 'getView':
      return api.getView();
    case 'poke':
      return api.poke();
    case 'gameplay':
      return api.gameplay();
    case 'setScene':
      if (typeof b.sceneId !== 'string') throw new BadRequest('sceneId must be a string');
      return api.setScene(b.sceneId);
    case 'chat':
      // 沒有 AI 的 host（舊版、或測試用的假 api）：回傳 disabled，畫面會用 JSON 台詞
      return api.chat ? api.chat(b.request) : ({ ok: false, reason: 'disabled' } satisfies ChatReply);
    case 'slotList':
      if (!api.slotList) throw new BadRequest('slots not supported');
      return api.slotList();
    case 'newGame':
      if (!api.newGame) throw new BadRequest('slots not supported');
      return api.newGame();
    case 'slotSave':
    case 'slotLoad':
    case 'slotRemove': {
      if (!validSlot(b.slot)) throw new BadRequest('slot must be 1-3');
      const slot = b.slot;
      const run =
        method === 'slotSave' ? api.slotSave && (() => api.slotSave!(slot))
        : method === 'slotLoad' ? api.slotLoad && (() => api.slotLoad!(slot))
        : api.slotRemove && (() => api.slotRemove!(slot));
      if (!run) throw new BadRequest('slots not supported');
      try {
        return await run();
      } catch (err) {
        // 空的格子、壞掉的格子：算是使用者的請求有問題，不是 host 內部錯誤
        if (err instanceof Error && /empty|bad slot/.test(err.message)) throw new BadRequest(err.message);
        throw err;
      }
    }
    case 'act': {
      const a = b.action as { type?: unknown } | undefined;
      if (!a || typeof a !== 'object' || typeof a.type !== 'string') throw new BadRequest('action.type must be a string');
      return api.act(a as GameAction); // 細節由規則層檢查：不認得的動作、格式錯的參數都會回傳失敗，不會壞檔
    }
  }
}

// ───────────── tool ─────────────
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema */
  parameters: Record<string, unknown>;
  handler(args: Record<string, unknown>): Promise<string>;
}

/** 給模型看的狀態摘要（純文字，避免把整個存檔丟給模型） */
export function summarize(v: PetView): string {
  const g = v.game;
  const lines = [`場景：${v.sceneId}｜時段：${v.phase}｜認識 ${v.ageDays} 天`];
  if (!g) return lines.join('\n');
  lines.push(`體力 ${g.stamina}/${g.staminaMax}｜飽食 ${g.satiety}/${g.satietyMax}｜好感 ${g.affection}（${g.level}）｜金幣 ${g.coins}`);
  if (g.season) lines.push(`${g.season.name}季第 ${g.season.day}/${g.season.days} 天｜${g.weather.name}${g.festival ? `｜今天是${g.festival.name}` : ''}`);
  const plots = Object.entries(g.plots).filter(([, p]) => p);
  if (plots.length) {
    lines.push('田：' + plots.map(([id, p]) => `${id}=${p!.crop}${p!.ready ? '（成熟）' : p!.watered ? '' : '（口渴）'}`).join('、'));
  }
  const food = Object.entries(g.inventory).filter(([, n]) => n > 0).slice(0, 30).map(([id, n]) => `${id}×${n}`);
  if (food.length) lines.push('揹包：' + food.join('、'));
  if (g.mine.trip) lines.push(`她在礦洞 ${g.mine.trip.floor} 樓${g.mine.trip.ready ? '，可以接她回來了' : ''}`);
  if (g.married) lines.push('你們已經結婚了');
  const diary = g.diary?.entries[0]; // V0.17
  if (diary && !diary.pending) lines.push(`最近的日記（${diary.date}）：${diary.text}`);
  return lines.join('\n');
}

/** 模型只能做這三件照顧她的事；買賣、解鎖、送禮這種花錢的事留給主人自己決定 */
const TOOL_ACTIONS = ['feed', 'water', 'harvest'] as const;

export function whalePetTools(api: PetApi): ToolDef[] {
  return [
    {
      name: 'whale_pet_status',
      description: '查看桌寵「鯨魚娘」現在的狀態：在哪裡、體力、飽食、好感、季節天氣、田裡的作物、揹包。唯讀。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => summarize(await api.getView()),
    },
    {
      name: 'whale_pet_act',
      description: '幫主人照顧鯨魚娘：feed（餵她揹包裡的食物，item 填物品 id）、water（幫田澆水，plot 填田 id）、harvest（收成，plot 填田 id）。先用 whale_pet_status 看有哪些東西。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: [...TOOL_ACTIONS] },
          item: { type: 'string', description: 'feed 時要餵的物品 id' },
          plot: { type: 'string', description: 'water / harvest 時的田 id，例如 garden/plot-1' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const kind = args.action;
        let a: GameAction;
        if (kind === 'feed' && typeof args.item === 'string') a = { type: 'feed', item: args.item };
        else if ((kind === 'water' || kind === 'harvest') && typeof args.plot === 'string') a = { type: kind, plot: args.plot };
        else return '參數不對：feed 要給 item，water / harvest 要給 plot';
        const r = await api.act(a);
        if (!r.ok) return `沒有成功（${r.error}）`;
        return `成功：${JSON.stringify(r.event)}\n${summarize(r.view)}`;
      },
    },
  ];
}
