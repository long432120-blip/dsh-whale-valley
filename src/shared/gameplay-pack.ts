// V0.5：玩法資料拆成五個 JSON（全部資料驅動，網友可以只改其中一個）：
//   gameplay.json  主檔：體力、好感、季節、作物、商人、居民、解鎖、機器、礦洞…
//   fishing.json   魚、釣竿、魚餌、掉落表、稀有度、湖中女神
//   weather.json   天氣種類（晴、雨、雷雨…）與各季節的機率、畫面效果
//   animals.json   動物（幼崽、長大、產品、賣價）、雞舍與畜棚
//   quests.json    引導任務（鯨魚娘頭頂氣泡、當前任務、指引箭頭、催促）
//   pets.json      V0.6 寵物：種類、商店／野外、技能、貼圖；飼料和捕捉網
//   leisure.json   V0.11 泡澡、玩遊戲（遊戲室、掛機）
//   tavern.json    V0.13 酒館：街機猜硬幣、牌桌比大小、晚上 NPC 去酒館
//   furniture_shop.json  V0.14 家具目錄：買價、佔幾格、分類；家具的物品定義也從這裡補
//   wishes.json    V0.18 她的小願望：每天早上許一個（想吃什麼、想去哪裡、想被摸頭…）
//   diary.json     V0.17 鯨魚娘的像素日記：今天的事怎麼寫、開頭和結尾（AI 寫不出來時用這些句子拼）
// 這裡把它們組回一個 GameplayFile；host、demo、測試都用同一個函數。
import type { DiaryFile } from './diary.ts';
import type { WishesFile } from './wishes.ts';
import type { AnimalDef, BuildingDef, FishingDef, FurnitureShopFile, GameplayFile, ItemDef, LeisureFile, PetsFile, QuestFile, StatsFile, TavernFile, WeatherFile } from './gameplay-types.ts';
import type { SocialFile } from './trade.ts';

export const GAMEPLAY_PARTS = ['fishing.json', 'weather.json', 'animals.json', 'quests.json', 'pets.json', 'stats.json', 'leisure.json', 'tavern.json', 'furniture_shop.json', 'diary.json', 'wishes.json', 'social.json'] as const;

export interface FishingPart { version: 1; items?: ItemDef[]; fishing: FishingDef }
export interface AnimalsPart { version: 1; items?: ItemDef[]; buildings: Record<string, BuildingDef>; animals: Record<string, AnimalDef> }
export type PetsPart = PetsFile & { items?: ItemDef[] };
/**
 * stats.json 是數值的唯一來源：把它寫回規則實際讀的欄位
 * （stamina、satiety、釣魚／澆水／種田／礦洞的體力消耗），其他新欄位留在 file.stats。
 */
export function applyStats(m: GameplayFile, st: StatsFile): void {
  m.stats = st;
  m.stamina = { max: st.stamina.max, regenPerHour: st.stamina.regenPerHour };
  m.satiety = { max: st.satiety.max, start: st.satiety.start, decayPerHour: st.satiety.decayPerHour };
  if (m.fishing) m.fishing.staminaCost = st.actions.fish.stamina;
  if (m.farming) m.farming.waterStaminaCost = st.actions.water.stamina;
  for (const c of m.crops ?? []) c.staminaCost = st.actions.plant.stamina;
  if (m.mine) m.mine.staminaCost = st.actions.mine.stamina;
}

export interface GameplayParts {
  fishing?: FishingPart | null;
  weather?: WeatherFile | null;
  animals?: AnimalsPart | null;
  quests?: QuestFile | null;
  pets?: PetsPart | null;
  stats?: StatsFile | null;
  /** V0.11 */
  leisure?: LeisureFile | null;
  /** V0.13 */
  tavern?: TavernFile | null;
  /** V0.14 */
  furniture?: FurnitureShopFile | null;
  /** V0.17 */
  diary?: DiaryFile | null;
  /** V0.18 */
  wishes?: WishesFile | null;
  /** V0.22 */
  social?: SocialFile | null;
}

/**
 * V0.14：家具目錄 → 物品定義。
 *   - gameplay.json 已經有的家具：沿用它的設定（例如田地套組的 plot、地板的 decor），目錄寫的欄位蓋過去
 *   - 新的家具：直接用目錄的資料建一個物品
 *   - 物品的 price（出貨箱收購價）= 二手價（買價 × resaleRate）
 */
export function applyFurniture(m: GameplayFile, fs: FurnitureShopFile): void {
  m.furniture = fs;
  for (const e of fs.items) {
    const i = m.items.findIndex((x) => x.id === e.id);
    const base: ItemDef | undefined = i >= 0 ? m.items[i] : undefined;
    const isDecor = e.category === 'floor' || e.category === 'wall';
    const next: ItemDef = {
      ...(base ?? {}),
      id: e.id,
      name: e.name,
      emoji: e.emoji,
      category: isDecor ? 'decor' : 'furniture',
      description: e.description ?? base?.description,
      price: Math.max(1, Math.floor(e.price * fs.resaleRate)),
    };
    if (isDecor) {
      const decor = e.decor ?? base?.decor;
      if (decor) next.decor = decor;
      delete next.place;
    } else {
      const big = e.size && (e.size.w > 1 || e.size.h > 1);
      next.place = {
        ...(base?.place ?? {}),
        blocking: e.blocking ?? base?.place?.blocking ?? !e.rug,
        where: e.where ?? base?.place?.where ?? 'any',
        ...(big ? { size: { w: e.size!.w, h: e.size!.h } } : {}),
        ...(e.rug ? { rug: true } : {}),
      };
    }
    if (i >= 0) m.items[i] = next;
    else m.items.push(next);
  }
}

/** 主檔 + 分檔 → 完整的玩法定義。分檔沒有就沿用主檔裡的同名欄位（V0.4 的單檔格式照樣能讀） */
export function assembleGameplay(main: unknown, parts: GameplayParts): GameplayFile {
  const m = structuredClone(main) as GameplayFile;
  m.items = [...(m.items ?? []), ...(parts.fishing?.items ?? []), ...(parts.animals?.items ?? []), ...(parts.pets?.items ?? [])];
  if (parts.fishing) m.fishing = structuredClone(parts.fishing.fishing);
  if (parts.weather) m.weather = structuredClone(parts.weather);
  if (parts.animals) {
    m.buildings = structuredClone(parts.animals.buildings);
    m.animals = structuredClone(parts.animals.animals);
  }
  if (parts.quests) m.quests = structuredClone(parts.quests);
  if (parts.pets) {
    const { items: _items, ...pets } = structuredClone(parts.pets);
    m.pets = pets;
  }
  if (parts.stats) applyStats(m, structuredClone(parts.stats));
  if (parts.leisure) m.leisure = structuredClone(parts.leisure);
  if (parts.tavern) m.tavern = structuredClone(parts.tavern);
  if (parts.furniture) applyFurniture(m, structuredClone(parts.furniture));
  if (parts.diary) m.diary = structuredClone(parts.diary);
  if (parts.wishes) m.wishes = structuredClone(parts.wishes);
  if (parts.social) m.social = structuredClone(parts.social);
  return m;
}

/** 用一個「讀檔函數」把角色包的五個 JSON 讀進來組好；讀不到的分檔就略過 */
export async function loadGameplay(read: (name: string) => Promise<unknown | null>): Promise<GameplayFile | null> {
  const main = await read('gameplay.json');
  if (!main) return null;
  const [fishing, weather, animals, quests, pets, stats, leisure, tavern, furniture, diary, wishes, social] = await Promise.all(GAMEPLAY_PARTS.map((n) => read(n).catch(() => null)));
  return assembleGameplay(main, {
    fishing: fishing as FishingPart | null,
    weather: weather as WeatherFile | null,
    animals: animals as AnimalsPart | null,
    quests: quests as QuestFile | null,
    pets: pets as PetsPart | null,
    stats: stats as StatsFile | null,
    leisure: leisure as LeisureFile | null,
    tavern: tavern as TavernFile | null,
    furniture: furniture as FurnitureShopFile | null,
    diary: diary as DiaryFile | null,
    wishes: wishes as WishesFile | null,
    social: social as SocialFile | null,
  });
}
