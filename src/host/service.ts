// Host 端 service：存檔、時間流逝、V0.2 玩法的唯一真相源。
// 寫法依官方速查表的 Service 樣板（class X extends Service { constructor(ctx){ super(ctx,'key') } }）。
// 已在 DSH 0.2.2-rc.1 實機驗證：typecheck 通過（有裝 @deepseek-ai/cordis），插件在桌面版正常載入、服務註冊成功。
import { Service, type Context } from '@deepseek-ai/cordis';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultStorageDir } from './storage-dir.ts';
import aiJson from '../../packs/whale-girl-pixel/ai.json';
import scenesJson from '../../packs/whale-girl-pixel/scenes.json';
import animalsJson from '../../packs/whale-girl-pixel/animals.json';
import fishingJson from '../../packs/whale-girl-pixel/fishing.json';
import gameplayJson from '../../packs/whale-girl-pixel/gameplay.json';
import questsJson from '../../packs/whale-girl-pixel/quests.json';
import petsJson from '../../packs/whale-girl-pixel/pets.json';
import statsJson from '../../packs/whale-girl-pixel/stats.json';
import leisureJson from '../../packs/whale-girl-pixel/leisure.json';
import tavernJson from '../../packs/whale-girl-pixel/tavern.json';
import furnitureJson from '../../packs/whale-girl-pixel/furniture_shop.json';
import diaryJson from '../../packs/whale-girl-pixel/diary.json';
import wishesJson from '../../packs/whale-girl-pixel/wishes.json';
import socialJson from '../../packs/whale-girl-pixel/social.json';
import weatherJson from '../../packs/whale-girl-pixel/weather.json';
import { markDiaryPending, setDiaryText, type DiaryFile } from '../shared/diary.ts';
import type { SocialFile } from '../shared/trade.ts';
import type { WishesFile } from '../shared/wishes.ts';
import { assembleGameplay, type AnimalsPart, type FishingPart, type PetsPart } from '../shared/gameplay-pack.ts';
import { buildDefs, mergeGameplay } from '../shared/gameplay.ts';
import type { GameAction, GameplayDefs, GameplayFile, GameplayMod, FurnitureShopFile, LeisureFile, QuestFile, StatsFile, TavernFile, WeatherFile } from '../shared/gameplay-types.ts';
import * as rules from '../shared/state.ts';
import { SLOT_COUNT, makeSlotFile, parseSlotFile, slotInfo, validSlot, type SlotInfo } from '../shared/save-slots.ts';
import type { ActResult, PetSave, PetView, SceneId } from '../shared/types.ts';
import { JsonStore } from './store.ts';
import { parseChatRequest, snapshotFromView, type AiFile, type ChatMessage, type ChatReply } from '../shared/ai.ts';
import { readDotEnv, resolveAiConfig, maskKey, type AiUserConfig } from './ai-config.ts';
import { createLlmChat } from './ai-llm.ts';
import { ChatMemory, WhaleAi } from './ai.ts';

/** 場景的中文名稱（給 AI 看的），取自角色包的 scenes.json */
const SCENE_NAMES: Record<string, string> = Object.fromEntries(
  (scenesJson as { scenes: { id: string; name: string }[] }).scenes.map((x) => [x.id, x.name]),
);

declare module '@deepseek-ai/cordis' {
  interface Context {
    whalePet: WhalePetService;
  }
}

export interface WhalePetConfig {
  storageDir?: string;
  initialScene: SceneId;
  /** V0.8：AI 對話。apiKey 留空就讀環境變數 DEEPSEEK_API_KEY，再沒有就讀存檔資料夾或啟動目錄的 .env */
  ai?: AiUserConfig;
}

export class WhalePetService extends Service {
  private readonly dir: string;
  private readonly store: JsonStore<PetSave>;
  private readonly ai: WhaleAi;
  private defsP?: Promise<{ defs: GameplayDefs; warnings: string[] }>;
  /** 測試時可以換掉時鐘 */
  clock: () => number = () => Date.now();

  constructor(ctx: Context, private readonly config: WhalePetConfig) {
    super(ctx, 'whalePet');
    // DSH 內建的 `storage` 服務是「JSON／SQLite 的 KV 表」，不是「插件專屬目錄」，
    // 不適合放存檔（要 mods/、.env、ai-error.log 這種真實檔案）。所以用魚社的慣例路徑，
    // 需要的話由設定裡的 storageDir 覆寫。
    // V0.20 改名 dsh-whale-valley；舊版的存檔資料夾還在、新的還沒建立，就繼續用舊的（存檔不會不見）
    this.dir = config.storageDir || defaultStorageDir(homedir(), existsSync);
    this.store = new JsonStore<PetSave>(this.dir);
    // V0.8：AI 對話。Key 只在這裡（host）讀，永遠不會送到瀏覽器
    const dotenv = readDotEnv([join(this.dir, '.env'), join(process.cwd(), '.env')]);
    const cfg = resolveAiConfig(config.ai, process.env, dotenv);
    const file = aiJson as unknown as AiFile;
    const memStore = new JsonStore<Record<string, ChatMessage[]>>(this.dir, 'ai-memory.json');
    // V0.9：宿主有 llm 服務就用它（不必另外申請 API Key）
    const llm = createLlmChat(ctx as unknown as { get(name: string): unknown });
    this.ai = new WhaleAi(cfg, file, {
      memory: new ChatMemory(file.historyTurns, {
        load: async () => ((await memStore.read()) as Record<string, ChatMessage[]> | undefined) ?? {},
        save: (all) => memStore.update(() => ({ next: all, result: undefined })),
      }),
      log: (m) => {
        console.warn(m);
        // 桌面版的 console 看不到，所以同時寫進存檔資料夾，方便事後查。
        // 只留最後 40 行；內容已經在 WhaleAi 遮蔽過（不含 Key）。
        try {
          const f = join(this.dir, 'ai-error.log');
          const prev = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
          const next = [...prev, `${new Date().toISOString()} ${m}`].slice(-40);
          mkdirSync(this.dir, { recursive: true });
          writeFileSync(f, next.join('\n') + '\n', 'utf8');
        } catch {
          // 寫不進去就算了，不要影響遊戲
        }
      },
      llm,
    });
    const how = !cfg.enabled
      ? '關閉'
      : cfg.apiKey
        ? `開啟（${cfg.model}，Key ${maskKey(cfg.apiKey)} 來自 ${cfg.keySource}）`
        : llm
          ? '開啟（走 DSH 的 llm 服務，不需要 API Key）'
          : '沒有 API Key，也沒有 llm 服務，使用 JSON 台詞';
    console.info(`[whale-pet] AI 對話：${how}`);
  }

  /**
   * 玩法定義：內建的 gameplay.json + 存檔資料夾裡 mods/*.json（依檔名排序合併）。
   * 第一次用到時才讀；有問題的 mod 會被略過並印出原因。
   */
  private loadDefs(): Promise<{ defs: GameplayDefs; warnings: string[] }> {
    this.defsP ??= (async () => {
      const modsDir = join(this.dir, 'mods');
      const names = (await readdir(modsDir).catch(() => [] as string[])).filter((n) => n.endsWith('.json')).sort();
      const mods: { name: string; data: GameplayMod }[] = [];
      for (const name of names) {
        try {
          mods.push({ name, data: JSON.parse(await readFile(join(modsDir, name), 'utf8')) as GameplayMod });
        } catch (err) {
          console.warn(`[whale-pet] mod ${name} 讀取失敗，已略過`, err);
        }
      }
      // 角色包的五個玩法 JSON 組起來，再合併 mods/
      const base = assembleGameplay(gameplayJson, {
        fishing: fishingJson as unknown as FishingPart,
        weather: weatherJson as unknown as WeatherFile,
        animals: animalsJson as unknown as AnimalsPart,
        quests: questsJson as unknown as QuestFile,
        pets: petsJson as unknown as PetsPart,
        stats: statsJson as unknown as StatsFile,
        leisure: leisureJson as unknown as LeisureFile,
        tavern: tavernJson as unknown as TavernFile,
        furniture: furnitureJson as unknown as FurnitureShopFile,
        diary: diaryJson as unknown as DiaryFile,
        wishes: wishesJson as unknown as WishesFile,
    social: socialJson as unknown as SocialFile,
      });
      const { file, warnings } = mergeGameplay(base, mods);
      for (const w of warnings) console.warn('[whale-pet]', w);
      return { defs: buildDefs(file), warnings };
    })();
    return this.defsP;
  }

  private load(raw: unknown, now: number, defs: GameplayDefs): PetSave {
    return rules.migrate(raw, now, this.config.initialScene, defs);
  }

  /** 打開畫面、以及畫面開著時定期呼叫：結算時間、記錄這次見面 */
  async visit(): Promise<PetView> {
    const { defs } = await this.loadDefs();
    const now = this.clock();
    return this.store.update((raw) => {
      const { next, view } = rules.visit(this.load(raw, now, defs), now, defs);
      return { next, result: view };
    });
  }

  /** 唯讀：給 tool 或其他插件查狀態，不寫檔 */
  async getView(): Promise<PetView> {
    const { defs } = await this.loadDefs();
    const now = this.clock();
    return rules.toView(rules.tick(this.load(await this.store.read(), now, defs), now, defs), now, 0, defs);
  }

  async setScene(sceneId: SceneId): Promise<PetView> {
    const { defs } = await this.loadDefs();
    const now = this.clock();
    return this.store.update((raw) => {
      const next = rules.setScene(this.load(raw, now, defs), sceneId, now, defs);
      return { next, result: rules.toView(next, now, 0, defs) };
    });
  }

  async poke(): Promise<PetView> {
    const { defs } = await this.loadDefs();
    const now = this.clock();
    return this.store.update((raw) => {
      const next = rules.poke(this.load(raw, now, defs), now, defs);
      return { next, result: rules.toView(next, now, 0, defs) };
    });
  }

  /** V0.2：釣魚、播種、收成、餵食、交換的唯一入口（之後的 tool 也呼叫這裡） */
  async act(action: GameAction): Promise<ActResult> {
    const { defs } = await this.loadDefs();
    const now = this.clock();
    let diaryId: string | undefined;
    const res = await this.store.update((raw) => {
      const { next, result } = rules.act(this.load(raw, now, defs), action, now, defs);
      // V0.17：睡覺寫了一篇日記：AI 能用的話標記「正在寫」，等一下在背景請 AI 重寫
      if (result.ok && result.event.type === 'slept' && result.event.diary && this.ai.available) {
        diaryId = result.event.diary;
        next.game = { ...next.game, diary: markDiaryPending(next.game.diary, diaryId, now) };
        const top = result.view.game?.diary.entries[0];
        if (top?.id === diaryId) top.pending = true;
      }
      return { next, result };
    });
    if (diaryId) this.diaryJob = this.writeDiaryWithAi(diaryId);
    return res;
  }

  /** 最近一次背景寫日記（測試用：可以 await 等它寫完） */
  diaryJob: Promise<void> = Promise.resolve();

  /**
   * V0.17：請 DeepSeek（或 DSH 的 llm 服務）把今天的紀錄寫成 50 字以內的像素日記，換掉規則層拼的那篇。
   * 只送整理好的文字（日期、天氣、今天的事、關係），不送 Key 以外的設定、不送整個存檔。失敗就留著拼的那篇。
   */
  private async writeDiaryWithAi(id: string): Promise<void> {
    try {
      const { defs } = await this.loadDefs();
      const save = this.load(await this.store.read(), this.clock(), defs);
      const e = save.game.diary.find((x) => x.id === id);
      let text: string | null = null;
      if (e) {
        const view = rules.toView(save, this.clock(), 0, defs);
        const extra = view.game ? [`你和主人的關係：${view.game.level}${view.game.married ? '（已經結婚了）' : ''}`] : [];
        const reply = await this.ai.diary(e, extra);
        if (reply.ok) text = reply.text;
      }
      await this.store.update((raw) => {
        const s = this.load(raw, this.clock(), defs);
        return { next: { ...s, game: { ...s.game, diary: setDiaryText(s.game.diary, id, text) } }, result: undefined };
      });
    } catch (err) {
      console.warn('[whale-pet] AI 日記失敗：', (err as Error)?.message);
    }
  }

  /**
   * V0.8：AI 對話。瀏覽器只送「誰、為什麼」；遊戲狀態由這裡從存檔整理（不信任瀏覽器送來的快照）。
   * 失敗一律回傳 { ok: false }，畫面改用 JSON 台詞。
   */
  async chat(raw: unknown): Promise<ChatReply> {
    const req = parseChatRequest(raw, this.ai.speakers);
    if (!req) return { ok: false, reason: 'bad_request' };
    const off = this.ai.unavailable();
    if (off) return off; // 沒有 Key、關掉了：不用讀存檔，直接請畫面用 JSON 台詞
    try {
      const { defs } = await this.loadDefs();
      const view = await this.getView();
      const snap = snapshotFromView(view, defs, (id) => SCENE_NAMES[id] ?? id, this.clock());
      return await this.ai.chat(req, snap, defs);
    } catch (err) {
      console.warn('[whale-pet] AI 對話失敗：', (err as Error)?.message);
      return { ok: false, reason: 'bad_response' };
    }
  }

  // ── V0.23：存檔格（存檔資料夾的 slots/slot-1～3.json）與開新遊戲 ──
  private slotPath(n: number): string {
    return join(this.dir, 'slots', `slot-${n}.json`);
  }
  private async readSlot(n: number): Promise<{ text: string | null }> {
    try {
      return { text: await readFile(this.slotPath(n), 'utf8') };
    } catch {
      return { text: null };
    }
  }
  /** 讀檔、開新遊戲前：目前進度先備份一份（save.backup.json），按錯了還救得回來 */
  private async backupCurrent(raw: unknown): Promise<void> {
    if (raw == null) return;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(join(this.dir, 'save.backup.json'), JSON.stringify(raw, null, 2), 'utf8');
    } catch (err) {
      console.warn('[whale-pet] 備份目前進度失敗', err);
    }
  }
  async slotList(): Promise<SlotInfo[]> {
    const { defs } = await this.loadDefs();
    const now = this.clock();
    const out: SlotInfo[] = [];
    for (let n = 1; n <= SLOT_COUNT; n++) {
      const { text } = await this.readSlot(n);
      const file = text == null ? null : parseSlotFile(text);
      let view: PetView | null = null;
      try {
        if (file) view = rules.toView(this.load(file.save, now, defs), now, 0, defs);
      } catch {
        view = null;
      }
      out.push(slotInfo(n, file, view, text != null && !view));
    }
    return out;
  }
  async slotSave(n: number): Promise<SlotInfo[]> {
    if (!validSlot(n)) throw new Error('bad slot');
    const { defs } = await this.loadDefs();
    const now = this.clock();
    const cur = rules.tick(this.load(await this.store.read(), now, defs), now, defs);
    const path = this.slotPath(n);
    await mkdir(join(this.dir, 'slots'), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(makeSlotFile(cur, now), null, 2), 'utf8');
    await rename(`${path}.tmp`, path);
    return this.slotList();
  }
  async slotLoad(n: number): Promise<PetView> {
    if (!validSlot(n)) throw new Error('bad slot');
    const file = parseSlotFile((await this.readSlot(n)).text);
    if (!file) throw new Error('empty slot');
    const { defs } = await this.loadDefs();
    const now = this.clock();
    await this.backupCurrent(await this.store.read());
    return this.store.update(() => {
      // 從「現在」開始算，不會一口氣補算存檔之後經過的時間
      const next: PetSave = { ...this.load(file.save, now, defs), lastTickAt: now, lastSeenAt: now };
      return { next, result: rules.toView(next, now, 0, defs) };
    });
  }
  async slotRemove(n: number): Promise<SlotInfo[]> {
    if (!validSlot(n)) throw new Error('bad slot');
    await unlink(this.slotPath(n)).catch(() => {});
    return this.slotList();
  }
  async newGame(): Promise<PetView> {
    const { defs } = await this.loadDefs();
    const now = this.clock();
    await this.backupCurrent(await this.store.read());
    return this.store.update(() => {
      const next = this.load(null, now, defs);
      return { next, result: rules.toView(next, now, 0, defs) };
    });
  }

  /** V0.2：合併好 mods 的玩法定義，給前端顯示名稱與 emoji */
  async gameplay(): Promise<GameplayFile> {
    return (await this.loadDefs()).defs.file;
  }
}
