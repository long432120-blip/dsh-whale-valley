// 玩法資料格式：gameplay.json（物品、釣魚、作物、商人、季節、機器、動物、居民、礦洞…）與存檔裡的遊戲狀態。
// 網友只要改 JSON（或在 mods/ 放追加用的 JSON）就能加內容；規則在 gameplay.ts。
import type { DayLog, DiaryEntry, DiaryFile } from './diary.ts';
import type { WishesFile, WishState } from './wishes.ts';
import type { DayPhase } from './types.ts';
import type { Letter, MarketOffer, SocialFile, StallListing, TradeState, VisitPayload } from './trade.ts';

export type ItemId = string;
export type CropId = string;
/** 農田 id = 場景 id + "/" + Tiled 物件名稱，例如 "garden/plot-1"；擺放的田是 "場景/placed-x-y" */
export type PlotId = string;
export type ShopId = string;
export type SeasonId = string;
/** weather.json 的 id；內建 sunny / rainy / storm，網友可以自己加 */
export type WeatherId = string;
/** 魚和其他稀有掉落的等級 */
export type Rarity = 'common' | 'epic' | 'legendary';
export const RARITIES: Rarity[] = ['common', 'epic', 'legendary'];
export type Cost = Record<ItemId, number>;

/** 金幣也是一般物品，所以交換、解鎖都能直接用金幣 */
export const COIN = 'coin';

// ───────────── packs/<name>/gameplay.json ─────────────
export interface GameplayFile {
  version: 1;
  stamina: { max: number; regenPerHour: number };
  satiety: { max: number; start: number; decayPerHour: number };
  affection: {
    /** 每天最多從餵食拿到多少好感，避免一直餵 */
    dailyCap: number;
    /** 由低到高；min 是進入這個等級需要的好感 */
    levels: { min: number; name: string }[];
    /** 喜歡的東西好感 ×2、討厭的 ×0 */
    likes?: ItemId[];
    dislikes?: ItemId[];
  };
  items: ItemDef[];
  fishing: FishingDef;
  crops: CropDef[];
  shops: Record<ShopId, ShopDef>;
  /** 新存檔送的物品（可以是空的） */
  starter?: Record<ItemId, number>;
  /** 四季、天氣、節慶；省略 = 沒有季節、永遠晴天 */
  calendar?: CalendarDef;
  /** 澆水與灑水器；省略 = 不用澆水 */
  farming?: FarmingDef;
  /** 第 2 輪：花錢或材料解鎖的東西（田、設施、門、建築） */
  unlocks?: Record<string, UnlockDef>;
  /** 第 2 輪：要花時間的加工機器 */
  machines?: Record<string, MachineDef>;
  /** 第 2 輪：圖鑑收集獎勵 */
  collections?: CollectionDef[];
  /** 第 3 輪：動物住的建築（建造用 unlocks 同名 id） */
  buildings?: Record<string, BuildingDef>;
  animals?: Record<string, AnimalDef>;
  /** 第 5 輪：居民 */
  npcs?: Record<string, NpcDef>;
  marriage?: MarriageDef;
  /** 第 6 輪：礦洞 */
  mine?: MineDef;
  /** V0.5：weather.json */
  weather?: WeatherFile;
  /** V0.5：quests.json */
  quests?: QuestFile;
  /** V0.5：睡覺（快轉到隔天早上） */
  sleep?: { scenes: string[]; wakeHour: number };
  /** V0.6：pets.json */
  pets?: PetsFile;
  /** V0.7：stats.json（體力、飽食／水分、好感的消耗與恢復）。有這個檔時，它的數值優先 */
  stats?: StatsFile;
  /** V0.11：leisure.json（泡澡、玩遊戲） */
  leisure?: LeisureFile;
  /** V0.13：tavern.json（酒館的小遊戲、晚上 NPC 去酒館） */
  tavern?: TavernFile;
  /** V0.14：furniture_shop.json（家具目錄） */
  furniture?: FurnitureShopFile;
  /** V0.17：diary.json（鯨魚娘的像素日記） */
  diary?: DiaryFile;
  /** V0.18：wishes.json（她的小願望） */
  wishes?: WishesFile;
  /** V0.22：social.json（交易所、攤位、領養、串門、信箱、聊天室） */
  social?: SocialFile;
  /** V0.6：地上的掉落物（每天早上刷新；點了撿起來，狗會自己去撿） */
  forage?: ForageDef;
  /** 擴展 E6：禮物碼的校驗用字串（不是密碼，只防手誤和隨便改） */
  gifts?: { salt: string };
}

export interface ItemDef {
  id: ItemId;
  name: string;
  emoji: string;
  /** fish / crop / seed / dish / junk / tool / furniture / animal / ore / gem / equip…，也可以自訂 */
  category: string;
  description?: string;
  /** 種子才有：種下去會長成哪種作物 */
  plants?: CropId;
  /** 有 food 才能餵她 */
  /** 能吃：加多少飽食度、好感；stamina 沒寫 = 飽食度 × stats.json 的 eat.staminaPerSatiety */
  food?: { satiety: number; affection: number; stamina?: number };
  /** 出貨箱的賣價；沒有就不能賣 */
  price?: number;
  /** 可以擺在地圖上（家具、裝飾、可移動的田） */
  place?: {
    blocking: boolean;
    plot?: boolean;
    where?: 'indoor' | 'outdoor' | 'any';
    /** V0.14：佔幾格（左上角是擺放的位置）；沒寫 = 1×1 */
    size?: { w: number; h: number };
    /** V0.14：地毯：不擋路，上面還可以再擺一件（非地毯的）家具 */
    rug?: boolean;
  };
  /** 地板或壁紙：把整張地圖的某些圖塊換掉（圖塊名稱見 tiles.tsj 的 type） */
  decor?: { kind: 'floor' | 'wall'; replace: Record<string, string> };
  /** 裝備：揹包裡同一類最強的自動使用 */
  equip?: { slot: EquipSlot; power: number };
  /** V0.5：稀有度（魚、寶石…）；省略 = common */
  rarity?: Rarity;
  /** V0.5：釣具。rod 一直用（揹包裡選一支）、bait 每拋一次竿用掉一個 */
  gear?: GearDef;
  /** V0.6：捕捉網。power 乘在野生寵物的捕捉率上；每丟一次用掉一個 */
  net?: { power: number };
}

export interface GearDef {
  kind: 'rod' | 'bait';
  /** 等魚上鉤的時間倍率：0.7 = 快 30% */
  bite: number;
  /** 稀有魚的權重倍率，例如 { "epic": 1.5, "legendary": 2 } */
  rare?: Partial<Record<Rarity, number>>;
}

export type EquipSlot = 'weapon' | 'armor' | 'pickaxe';

export interface LootEntry {
  item: ItemId;
  weight: number;
  /** 只在這些時段釣得到 */
  phases?: DayPhase[];
  /** 好感到多少才釣得到 */
  minAffection?: number;
  /** 只在這些季節釣得到 */
  seasons?: SeasonId[];
  /** 只在這些天氣釣得到 */
  weather?: WeatherId[];
  /** 只在這個節慶當天 */
  festival?: string;
}

export interface GoddessDef {
  name: string;
  /** 每次釣到東西時出現的機率（0.01 = 1%） */
  chance: number;
  /** 好運期間稀有掉落的權重倍率（釣魚、礦洞） */
  luck: Partial<Record<Rarity, number>>;
  /** 好運期間動物出高級品的機率倍率 */
  goodProduct: number;
  /** 好運持續到「隔天」幾點 */
  untilHour: number;
  /** 彈出視窗的圖（角色包相對路徑）與台詞 */
  image?: string;
  lines: string[];
}

export interface FishingDef {
  staminaCost: number;
  /** 等魚上鉤的時間（毫秒） */
  durationMs: number;
  cooldownMs: number;
  /** 掉落表；Tiled 釣魚區的 table 屬性指到這裡的 key */
  tables: Record<string, LootEntry[]>;
  /** 第 3 輪：小遊戲難度。zone = 綠區寬度（0～1），speed = 指針每秒來回幾趟 */
  minigame?: { zone: number; perfectZone: number; speed: number; doubleChance: number };
  /** V0.5：稀有度的顯示名稱與顏色 */
  rarities?: Record<Rarity, { name: string; color: string }>;
  /** V0.5：湖中女神 */
  goddess?: GoddessDef;
}

export interface CropStage {
  name: string;
  emoji: string;
  /** 種下後第幾分鐘進入這個階段；第一個一定是 0 */
  atMinutes: number;
}

export interface CropDef {
  id: CropId;
  seed: ItemId;
  staminaCost?: number;
  stages: CropStage[];
  harvest: { item: ItemId; min: number; max: number };
  /** 只能在這些季節播種；省略 = 四季都能種。溫室不受限制 */
  seasons?: SeasonId[];
}

export interface ShopDef {
  name: string;
  emoji: string;
  greeting?: string;
  /** 按鈕上的字，預設「交換」；料理台可以寫「製作」 */
  verb?: string;
  /** sell = 出貨箱：列出揹包裡能賣的東西 */
  mode?: 'trade' | 'sell';
  /** sell 模式：只收這些分類（例如老陳只收魚）；省略 = 什麼都收 */
  buys?: string[];
  trades: TradeDef[];
}

/** 一筆交換：拿 give 換 get */
export interface TradeDef {
  id: string;
  give: Record<ItemId, number>;
  get: Record<ItemId, number>;
  /** 只在這個節慶當天出現 */
  festival?: string;
  /** 只在這些季節賣（例如小葵只賣當季種子） */
  seasons?: SeasonId[];
  /** V0.6.2：每天最多換幾次；換完畫面顯示「已售罄」 */
  dailyLimit?: number;
}

export interface CalendarDef {
  /** 一季是現實的幾天 */
  seasonDays: number;
  /** 照順序輪替；rainChance 是沒有 weather.json 時，那一季每天下雨的機率（0～1） */
  seasons: { id: SeasonId; name: string; emoji: string; rainChance: number }[];
  festivals?: FestivalDef[];
}

export interface FestivalDef {
  id: string;
  name: string;
  emoji: string;
  season: SeasonId;
  /** 這一季的第幾天（1 起算） */
  day: number;
  description?: string;
}

export interface FarmingDef {
  /** 澆一次水可以濕幾小時 */
  waterHours: number;
  waterStaminaCost: number;
  /** 沒澆水時的生長速度（0 = 完全不長，1 = 跟有澆水一樣） */
  dryGrowthRate: number;
  /** 灑水器物品 id：裝在田上之後那格永遠是濕的 */
  sprinklerItem?: ItemId;
  /** 這些場景裡的田不分季節、永遠濕潤（溫室） */
  greenhouseScenes?: string[];
  /** V0.6：烏鴉。每天早上，戶外還沒成熟的作物各有 chance 機率被啄（生長倒退 setbackHours 小時）；
   *  戶外種了 minCrops 塊以上才會來。貓（crow_guard）會把機率壓低 */
  crows?: { chance: number; minCrops: number; setbackHours: number };
}

export interface UnlockDef {
  name: string;
  emoji?: string;
  description?: string;
  cost: Cost;
  /** 要先解鎖哪一個 */
  requires?: string;
}

export interface RecipeDef {
  id: string;
  give: Cost;
  get: Record<ItemId, number>;
  minutes: number;
}

export interface MachineDef {
  name: string;
  emoji: string;
  recipes: RecipeDef[];
}

export interface CollectionDef {
  id: string;
  name: string;
  items: ItemId[];
  reward: Record<ItemId, number>;
}

export interface BuildingDef {
  name: string;
  emoji: string;
  /** 第一級在解鎖（unlocks 的同名 id）時取得；之後每一級的 cost 是升級費用 */
  levels: { capacity: number; cost: Cost }[];
}

export interface AnimalDef {
  name: string;
  emoji: string;
  building: string;
  price: Cost;
  product: ItemId;
  /** 心情好時有機會產出的高級品 */
  goodProduct?: ItemId;
  /** 幾小時產出一次 */
  hours: number;
  /** 吃什麼（從揹包扣） */
  feed: ItemId;
  /** 心情要多少才會產出（例如豬要開心才會去找松露） */
  minMood?: number;
  /** V0.5：買來的是幼崽，要長大才會產出 */
  baby?: { name: string; emoji: string; growHours: number };
  /** V0.5：賣給商人的價格（好感越高越值錢，最多 +50%） */
  sellPrice?: { baby: number; adult: number };
}

export interface NpcDef {
  name: string;
  emoji: string;
  title?: string;
  loves?: ItemId[];
  likes?: ItemId[];
  dislikes?: ItemId[];
  /** 平常聊天的台詞；minFriendship 越高越後面解鎖 */
  lines: { text: string; minFriendship?: number; phases?: DayPhase[] }[];
  /** 到門檻時聊天會觸發一次的劇情（連續多句） */
  events?: { id: string; minFriendship: number; lines: string[] }[];
  /** 這位居民也是商人：點「交易」開這個商店 */
  shop?: ShopId;
  /** V0.5：多個商店（例如老陳：收魚、賣釣具） */
  shops?: ShopId[];
  /** V0.5：靜態圖（角色包相對路徑）；地圖上會有呼吸、搖擺的微動。省略 = 用 emoji */
  sprite?: string;
  /** 對話框頭像；省略 = 用 sprite */
  portrait?: string;
}

export interface MarriageDef {
  /** 告白要送的東西 */
  item: ItemId;
  /** 好感要多少才能告白 */
  minAffection: number;
  /** 婚後的好感等級名稱 */
  levelName: string;
  /** 婚後每天早上她會幫忙 */
  helps: { water: boolean; animals: boolean };
}

export interface MonsterDef {
  name: string;
  emoji: string;
  hp: number;
  atk: number;
  drop?: ItemId;
}

export interface MineZone {
  name: string;
  from: number;
  to: number;
  /** 去一趟要幾分鐘 */
  minutes: number;
  /** 鎬子強度至少要多少 */
  needPickaxe: number;
  monsters: MonsterDef[];
  /** 礦石、寶石、裝備 */
  loot: LootEntry[];
}

export interface MineDef {
  staminaCost: number;
  /** 沒裝備時的血量與攻擊 */
  baseHp: number;
  basePower: number;
  zones: MineZone[];
}

// ───────────── V0.5：weather.json ─────────────
export interface WeatherDef {
  id: WeatherId;
  name: string;
  emoji: string;
  /** 土會不會濕：下雨天早上自動把田澆好 */
  wet: boolean;
  /** 也算是哪些天氣（例如雷雨也算 rainy，所以「雨天限定」的魚雷雨也釣得到） */
  tags?: string[];
  /** 史詩、傳說魚的機率加成（0.2 = +20%） */
  rareBonus?: number;
  /** 畫面效果：雨滴粒子、閃電、整體色調 */
  particles?: { count: number; speed: number; length: number; slant: number; color: string };
  flash?: { perMinute: number };
  tint?: string;
}

export interface WeatherFile {
  version: 1;
  types: WeatherDef[];
  /** 每一季各種天氣的權重；沒寫的季節用 default */
  seasons: Record<SeasonId, Record<WeatherId, number>>;
  default: Record<WeatherId, number>;
}

// ───────────── V0.5：quests.json ─────────────
/** 任務條件：event = 動作成功後的事件種類（caught、sold、traded、planted、slept…）或 enter（走進某張地圖） */
export interface QuestCondition {
  event?: GameEvent['type'] | 'enter';
  item?: ItemId;
  category?: string;
  /** 至少這個稀有度（epic = 史詩或傳說） */
  rarity?: Rarity;
  shop?: ShopId;
  npc?: string;
  scene?: string;
  /** 揹包裡已經有就算完成（例如「買種子」：本來就有種子就直接跳過） */
  have?: { item?: ItemId; category?: string; count?: number };
}

export interface QuestStep {
  id: string;
  /** 左上角「當前任務」顯示的字 */
  task: string;
  /** 進到這一步時，她頭頂的氣泡依序說的話 */
  say: string[];
  /** 玩家一直沒動作時，每隔 nagEverySec 秒輪流說一句 */
  nag?: string[];
  /** 指引箭頭要指的地方：哪張地圖、哪個 Tiled 物件（互動物件、門或地點的名稱） */
  target?: { scene: string; object?: string };
  done: QuestCondition;
  /** 要做幾次（預設 1） */
  count?: number;
  reward?: Record<ItemId, number>;
}

export interface QuestChain {
  id: string;
  name: string;
  /** 前一條任務線做完才開始 */
  requires?: string;
  steps: QuestStep[];
  /** 整條做完時她說的話 */
  doneSay?: string[];
}

export interface QuestFile {
  version: 1;
  /** 催促的間隔（秒） */
  nagEverySec: number;
  chains: QuestChain[];
}

// ───────────── V0.7：stats.json ─────────────
export type StatAction = 'fish' | 'plant' | 'water' | 'mine';
export interface StatsFile {
  version: 1;
  /** 低於上限的這個比例（0.3 = 30%）：數值條變紅閃爍、她會說話提醒 */
  lowRatio: number;
  stamina: {
    start: number; max: number;
    /** 每小時自然恢復（0 = 只靠睡覺和吃東西） */
    regenPerHour: number;
    /** 過了起床時間（睡覺快轉、或現實時間過夜）是否補滿 */
    restoreOnMorning: boolean;
  };
  satiety: {
    start: number; max: number;
    /** 每小時流逝 */
    decayPerHour: number;
    /** 睡覺快轉那段時間的流逝倍率（0.5 = 睡著時餓得慢） */
    sleepDecayMult: number;
    /** 歸零時：體力上限倍率、每過一個早上扣多少好感 */
    whenEmpty: { staminaMaxMult: number; affectionLossPerDay: number };
    /** 喝水：哪些水域（釣魚的 table）可以喝、一次加多少、隔多久才能再喝 */
    /** tables：可以喝水的釣魚水域；taps：不是釣魚點的水源（V0.11：廚房的水龍頭） */
    drink: { tables: string[]; taps?: string[]; satiety: number; cooldownMinutes: number };
  };
  affection: { start: number; decayPerHour: number };
  /** 每種動作消耗多少體力 */
  actions: Record<StatAction, { stamina: number }>;
  eat: { staminaPerSatiety: number };
  /** 她的台詞（隨機挑一句） */
  lines: { tired: string[]; exhausted: string[]; hungry: string[]; starving: string[]; drink: string[]; ate: string[]; rested: string[] };
}

// ───────────── V0.6：pets.json ─────────────
/**
 * 寵物的被動技能。同一種技能只算最強的那一隻；寵物餓了（飽食度 0）技能就停。
 * 好感越高越強：效果 × (1 + 好感/1000 × affection.skillBonusAtMax)
 */
export type PetSkillKind = 'auto_pickup' | 'crow_guard' | 'fishing_luck' | 'water_plots' | 'mine_luck';
export interface PetSkillDef {
  kind: PetSkillKind;
  name: string;
  description: string;
  /** auto_pickup：畫面上看得到掉落物的距離（格）；perDay = 離線時一天幫你撿回幾個 */
  radius?: number;
  perDay?: number;
  /** crow_guard：烏鴉機率剩下幾成（0.3 = 剩 30%） */
  crowMult?: number;
  /** fishing_luck、mine_luck：稀有掉落的權重倍率 */
  rare?: Partial<Record<Rarity, number>>;
  /** water_plots：每天早上幫忙澆幾塊田 */
  plots?: number;
}

export interface PetSpeciesDef {
  name: string;
  emoji: string;
  description?: string;
  /** 貼圖：角色包相對路徑（存成 3 倍大，畫 1/3）；沒有就畫 emoji。
   *  sheet = 走路圖（一列 frames 格，走路時輪播 walk、停下來用 idle）；faces = 圖裡面朝哪邊（往另一邊走就左右翻轉）
   *  沒有 sheet 的靜態圖靠程式做呼吸、彈跳 */
  sprite?: {
    src: string; scale?: number; float?: boolean; faces?: 'left' | 'right' | 'front';
    sheet?: { frameWidth: number; frameHeight: number; frames: number; walk: number[]; idle: number; fps: number };
  };
  /** 商店買：價格（例如 { "coin": 800 }） */
  shop?: { price: Cost };
  /** 野外捕捉：在哪些地圖、什麼天氣（天氣 id 或 tags）、時段、季節出現；weight = 同一個地點有好幾種時的權重 */
  wild?: { scenes: string[]; weather?: string[]; phases?: DayPhase[]; seasons?: SeasonId[]; weight: number; catchRate: number; flee: number };
  /** 吃什麼：item 或 category 對上就能餵，satiety = 一次加多少飽食度 */
  diet: { item?: ItemId; category?: string; satiety: number }[];
  /** 每小時掉多少飽食度（0～100） */
  satietyDecay: number;
  /** 走路速度（格／秒） */
  speed: number;
  /** 平常在哪張地圖閒逛（沒寫用 pets.json 的 defaultHome） */
  home?: string;
  skill: PetSkillDef;
}

export interface PetsFile {
  version: 1;
  /** 最多養幾隻 */
  maxPets: number;
  defaultHome: string;
  /** 寵物店的商人 id（gameplay.json shops 裡，賣飼料和捕捉網）；寵物本身列在面板上 */
  shop: ShopId;
  affection: { max: number; petGain: number; feedGain: number; skillBonusAtMax: number };
  satiety: { max: number; start: number };
  /** 野生寵物：一天切成幾段（blockHours 小時一段），每段每張地圖擲一次 chance 決定出不出現 */
  wild: { blockHours: number; chance: number; weatherBonus?: Record<string, number> };
  species: Record<string, PetSpeciesDef>;
}

/** V0.6：地上的掉落物 */
export interface ForageDef {
  /** 每張地圖：幾個位置、每個位置出現的機率、掉什麼 */
  scenes: Record<string, { slots: number; chance: number; table: LootEntry[] }>;
}

/** mods/*.json：只寫要追加或覆蓋的部分 */
export interface GameplayMod {
  version: 1;
  items?: ItemDef[];
  crops?: CropDef[];
  fishing?: { tables?: Record<string, LootEntry[]> };
  shops?: Record<ShopId, Partial<Omit<ShopDef, 'trades'>> & { trades?: TradeDef[] }>;
  calendar?: CalendarDef;
  festivals?: FestivalDef[];
  unlocks?: Record<string, UnlockDef>;
  machines?: Record<string, MachineDef>;
  collections?: CollectionDef[];
  buildings?: Record<string, BuildingDef>;
  animals?: Record<string, AnimalDef>;
  npcs?: Record<string, NpcDef>;
  /** V0.5：任務線（同 id 覆蓋、新 id 新增） */
  questChains?: QuestChain[];
  /** V0.5：天氣種類（同 id 覆蓋、新 id 新增）與季節權重（覆蓋） */
  weatherTypes?: WeatherDef[];
  weatherSeasons?: Record<SeasonId, Record<WeatherId, number>>;
  /** V0.6：寵物種類（同 id 覆蓋、新 id 新增） */
  petSpecies?: Record<string, PetSpeciesDef>;
}

/** 合併、整理後的定義，用 Map 方便查 */
export interface GameplayDefs {
  file: GameplayFile;
  items: Map<ItemId, ItemDef>;
  crops: Map<CropId, CropDef>;
  cropBySeed: Map<ItemId, CropDef>;
}

// ───────────── 存檔裡的遊戲狀態 ─────────────
export interface PlotState {
  crop: CropId;
  plantedAt: number;
  /** 已經累積的生長時間（毫秒）；有澆水才會全速累積 */
  growthMs: number;
  /** growthMs 結算到哪個時間點 */
  growthAt: number;
  /** 澆的水可以撐到什麼時候 */
  wateredUntil: number;
}

export interface MachineState {
  machine: string;
  recipe: string;
  readyAt: number;
}

export interface PetState {
  id: number;
  kind: string;
  name: string;
  /** 0～pets.affection.max */
  affection: number;
  /** 0～pets.satiety.max；0 = 餓了，技能停 */
  satiety: number;
  lastPetDay: string;
  obtainedAt: number;
  /** V0.22：adopt = 朋友用領養碼送來的 */
  how: 'shop' | 'wild' | 'adopt';
}

export interface FarmReport {
  day: string;
  /** 被烏鴉啄的田 */
  pecked: PlotId[];
  /** 貓趕走了幾隻烏鴉 */
  scared: number;
  /** 寵物幫忙澆了幾塊田 */
  watered: number;
  /** 寵物幫忙撿回來的東西（離線時） */
  picked: Record<ItemId, number>;
}

export interface AnimalState {
  id: number;
  kind: string;
  /** 出生（買來）的時間；舊存檔是 0 = 已經是大人 */
  bornAt: number;
  name: string;
  building: string;
  /** 吃飽到什麼時候 */
  fedUntil: number;
  /** 0～100 */
  mood: number;
  /** 0～1000 */
  friendship: number;
  lastPetDay: string;
  /** 下一次產出的時間 */
  readyAt: number;
  /** 已經產出、等你收的東西 */
  pending: ItemId | null;
}

export interface PlacedItem {
  item: ItemId;
  x: number;
  y: number;
}

export interface NpcState {
  friendship: number;
  talkDay: string;
  giftDay: string;
  events: Record<string, true>;
}

export interface MineTrip {
  floor: number;
  startedAt: number;
  endsAt: number;
}

export interface GameState {
  /** 亂數狀態：存在存檔裡，結果可重現、好測試 */
  rngSeed: number;
  stamina: number;
  satiety: number;
  affection: number;
  affectionToday: { day: string; gained: number };
  /** 體力回復、飽食度下降的結算基準 */
  lastTickAt: number;
  lastFishAt: number;
  /** 物品 id → 數量；不認得的 id（例如 mod 被移除）會保留，不會刪 */
  inventory: Record<ItemId, number>;
  plots: Record<PlotId, PlotState | null>;
  /** 裝了灑水器的田 */
  sprinklers: Record<PlotId, true>;
  unlocked: Record<string, true>;
  /** 機器（key = 場景/物件名稱） */
  machines: Record<string, MachineState | null>;
  claimed: Record<string, true>;
  /** 建築等級（0 起算）；沒蓋的不會出現 */
  buildingLevels: Record<string, number>;
  animals: AnimalState[];
  nextAnimalId: number;
  placed: Record<string, PlacedItem[]>;
  decor: Record<string, Partial<Record<'floor' | 'wall', ItemId>>>;
  npcs: Record<string, NpcState>;
  /** 結婚的時間；0 = 還沒 */
  marriedAt: number;
  /** 婚後她今天幫了什麼 */
  help: { day: string; watered: number; petted: number } | null;
  mine: { deepest: number; trip: MineTrip | null };
  /** 收過的禮物碼 */
  redeemed: Record<string, true>;
  /** V0.5：遊戲時間比現實快多少毫秒（睡覺會往前跳） */
  clockOffset: number;
  /** V0.5：湖中女神的好運持續到什麼時候（遊戲時間） */
  luckUntil: number;
  /** V0.5：選用的魚竿、魚餌 */
  gear: { rod: ItemId | null; bait: ItemId | null };
  /** V0.7：上次喝水的時間 */
  lastDrinkAt: number;
  /** V0.11：上次泡澡的時間 */
  lastBathAt: number;
  /** V0.11：正在玩遊戲（遊戲室）：哪一台、從什麼時候開始；null = 沒在玩 */
  play: { game: string; since: number } | null;
  /** V0.14：從家具目錄買過的家具（id → 總共買了幾件；賣掉、擺出去都不會減） */
  furnitureBought: Record<ItemId, number>;
  /** V0.13：酒館今天的紀錄（跨日歸零）：猜硬幣拿了多少好感、跟每個 NPC 打牌贏了幾次 */
  tavernToday: { day: string; flipGain: number; cardWins: Record<string, number> };
  /** V0.18：今天的小願望（跨日重抽；null = 還沒開始許願） */
  wish: WishState | null;
  /** V0.18：今天被摸頭幾次（加好感的次數有上限） */
  headpatToday: { day: string; n: number };
  /** V0.17：今天的紀錄（上次起床到現在）：睡覺時變成一篇日記 */
  dayLog: DayLog;
  /** V0.17：鯨魚娘的像素日記（舊的在前面；最多 diary.json 的 keep 篇） */
  diary: DiaryEntry[];
  /** V0.16：今天吃了幾份點心（每張桌子）、冰箱找過幾次（跨日歸零） */
  pantryToday: { day: string; snacks: Record<string, number>; fridge: number };
  /** V0.6：寵物 */
  pets: PetState[];
  /** V0.22：交易代號、暱稱、攤位、兌換紀錄 */
  trade: TradeState;
  /** V0.22：朋友串門留的信 */
  mailbox: Letter[];
  nextPetId: number;
  /** 跟班：跟在鯨魚娘（或主人）後面走的那一隻；null = 大家都在家閒逛 */
  companion: number | null;
  /** V0.6：今天地上的掉落物撿過哪些（key = 場景:位置） */
  forage: { dayAt: number; picked: Record<string, true> };
  /** V0.6：野生寵物：已經抓到或跑掉的（key = 天:時段:場景），隔天清掉 */
  wild: Record<string, 'caught' | 'fled'>;
  /** V0.6.2：今天在商店換了幾次（key = 商人:交換 id），給 dailyLimit 用 */
  shopToday: { day: string; bought: Record<string, number> };
  /** V0.6：今天早上農場發生的事（烏鴉、寵物幫忙） */
  farmReport: FarmReport | null;
  /** V0.5：任務進度。step 就是 tutorial_step（0 起算） */
  quest: { chain: string | null; step: number; progress: number; done: Record<string, true>; nagAt: number; last: QuestLog | null };
  stats: {
    caught: Record<ItemId, number>;
    harvested: number;
    fed: number;
    traded: number;
    sold: number;
    earned: number;
    kills: number;
  };
}

// ───────────── 前端送給 host 的動作與結果 ─────────────
export type FishQuality = 'miss' | 'good' | 'perfect';

export interface QuestLog {
  chain: string;
  step: string;
  task: string;
  reward: Record<ItemId, number>;
  chainDone: boolean;
  at: number;
}

export type GameAction =
  /** V0.22：社交（social-rules.ts） */
  | { type: 'set_nick'; nick: string }
  | { type: 'market_buy'; item: ItemId; qty: number }
  | { type: 'stall_list'; item: ItemId; qty: number; price: number }
  | { type: 'stall_cancel'; id: string }
  | { type: 'trade_buy'; code: string }
  | { type: 'trade_receipt'; code: string }
  | { type: 'pet_adopt_out'; pet: number }
  | { type: 'pet_adopt_in'; code: string }
  | { type: 'visit_snapshot' }
  | { type: 'visit_reply'; code: string }
  | { type: 'mail_read' }
  | { type: 'fish'; table: string; quality?: FishQuality }
  | { type: 'plant'; plot: PlotId; seed: ItemId }
  | { type: 'harvest'; plot: PlotId }
  | { type: 'water'; plot: PlotId }
  | { type: 'sprinkler'; plot: PlotId }
  | { type: 'feed'; item: ItemId }
  /** V0.7：在水邊喝水（table = 那個水域的釣魚表） */
  | { type: 'drink'; table: string }
  | { type: 'trade'; shop: ShopId; trade: string }
  | { type: 'sell'; item: ItemId; count: number; /** 賣給指定的商人（例如老陳只收魚）；省略 = 出貨箱 */ shop?: ShopId }
  | { type: 'unlock'; id: string }
  | { type: 'machine_start'; key: string; machine: string; recipe: string }
  | { type: 'machine_collect'; key: string }
  | { type: 'upgrade_building'; building: string }
  | { type: 'buy_animal'; kind: string; name?: string }
  | { type: 'feed_animals'; building: string }
  | { type: 'pet_animal'; animal: number }
  | { type: 'collect_animals'; building: string }
  | { type: 'place'; scene: string; item: ItemId; x: number; y: number }
  | { type: 'pickup'; scene: string; x: number; y: number }
  | { type: 'decorate'; scene: string; item: ItemId }
  | { type: 'talk'; npc: string }
  | { type: 'gift'; npc: string; item: ItemId }
  | { type: 'propose' }
  | { type: 'mine_start'; floor: number }
  | { type: 'mine_collect' }
  | { type: 'mine_loot'; floor: number; items: Record<ItemId, number>; kills: number; died: boolean; damage?: number }
  | { type: 'gift_send'; item: ItemId; count: number }
  | { type: 'gift_redeem'; code: string }
  | { type: 'set_gear'; slot: 'rod' | 'bait'; item: ItemId | null }
  | { type: 'sleep' }
  | { type: 'sell_animal'; animal: number }
  | { type: 'buy_pet'; kind: string; name?: string }
  | { type: 'feed_pet'; pet: number; item: ItemId }
  | { type: 'pet_pet'; pet: number }
  | { type: 'set_companion'; pet: number | null }
  | { type: 'release_pet'; pet: number }
  /** 野生寵物：scene 是她現在所在的地圖（host 會檢查），spawn 是 view.wild 的 id */
  | { type: 'catch_pet'; scene: string; spawn: string; net: ItemId }
  /** 撿地上的掉落物；by = 哪隻寵物撿的（要有 auto_pickup 技能） */
  | { type: 'forage'; scene: string; slot: number; by?: number }
  /** V0.11：泡澡（浴室） */
  | { type: 'bath' }
  /** V0.11：開始玩遊戲（遊戲室；game = leisure.json 的 games） */
  | { type: 'play'; game: string }
  /** V0.11：不玩了：結算玩了多久、好感、體力 */
  | { type: 'stop_play' }
  /** V0.13：酒館街機猜硬幣：付 cost 金幣，猜對拿 reward 金幣＋她的好感 */
  | { type: 'coin_flip'; guess: CoinSide }
  /** V0.13：酒館牌桌跟 NPC 比大小：贏了加那個 NPC 的好感 */
  | { type: 'cards'; npc: string }
  /** V0.18：摸摸頭（1.5 秒內點她 3 下）：每天前幾次加好感 */
  | { type: 'headpat' }
  /** V0.17：看過日記了（收起來，不再自動打開） */
  | { type: 'diary_read'; id: string }
  /** V0.16：在點心桌吃一份免費點心（leisure.json 的 snacks） */
  | { type: 'snack'; table: string }
  /** V0.16：打開冰箱：今天第一次會找到一樣東西（leisure.json 的 fridge） */
  | { type: 'fridge' }
  /** V0.14：從家具目錄買家具（放進揹包） */
  | { type: 'buy_furniture'; item: ItemId; count?: number }
  /** V0.14：揹包裡的家具二手賣出（買價 × resaleRate） */
  | { type: 'sell_furniture'; item: ItemId };

export interface CollectionReward {
  id: string;
  name: string;
  reward: Record<ItemId, number>;
}

export interface MineReport {
  floor: number;
  /** 實際走到第幾樓（受傷會提早回來） */
  reached: number;
  injured: boolean;
  kills: { name: string; emoji: string; count: number }[];
  damage: number;
  items: Record<ItemId, number>;
  deepest: number;
}

export type GameEvent =
  | { type: 'nick_set'; nick: string }
  | { type: 'market_bought'; item: ItemId; qty: number; cost: number }
  | { type: 'stall_listed'; listing: StallListing; code: string }
  | { type: 'stall_cancelled'; id: string; item: ItemId; qty: number }
  | { type: 'trade_bought'; item: ItemId; qty: number; total: number; seller: string; receipt: string }
  | { type: 'trade_collected'; id: string; total: number; buyer: string }
  | { type: 'pet_adopt_code'; pet: number; name: string; code: string }
  | { type: 'pet_adopted'; pet: number; kind: string; name: string; from: string }
  | { type: 'visit_snapshot'; payload: VisitPayload }
  | { type: 'letter_received'; letter: Letter; watered: number }
  | { type: 'mail_read' }
  | {
      type: 'caught'; item: ItemId; count: number; /** 第一次釣到：圖鑑新增 */ first: boolean; rewards: CollectionReward[];
      rarity: Rarity; /** 湖中女神出現了：好運到這個時間 */ goddess?: { until: number }; bait?: ItemId;
    }
  | { type: 'escaped'; bait?: ItemId }
  | { type: 'watered'; plot: PlotId }
  | { type: 'sprinkler_placed'; plot: PlotId }
  | { type: 'planted'; plot: PlotId; crop: CropId; seed: ItemId }
  | { type: 'harvested'; plot: PlotId; item: ItemId; count: number }
  | { type: 'fed'; item: ItemId; gain: number; liked: boolean; disliked: boolean; capped: boolean; levelUp?: string; satiety: number; stamina: number }
  | { type: 'drank'; satiety: number }
  /** V0.11 */
  | { type: 'bathed'; stamina: number; gain: number; levelUp?: string }
  | { type: 'play_started'; game: string; since: number }
  | { type: 'play_stopped'; game: string; minutes: number; gain: number; stamina: number; level: number; levelUp?: string }
  /** V0.13：coins = 這一把金幣淨變化（贏 +reward-cost，輸 -cost）；gain = 她的好感 */
  | { type: 'coin_flipped'; guess: CoinSide; result: CoinSide; win: boolean; coins: number; gain: number; levelUp?: string }
  /** V0.16：left = 這張桌子今天還剩幾份 */
  | { type: 'snacked'; table: string; satiety: number; stamina: number; gain: number; left: number; levelUp?: string }
  /** V0.16：item = 找到的東西（null = 今天找過了）；left = 今天還能找幾次 */
  | { type: 'fridge_opened'; item: ItemId | null; count: number; left: number }
  | { type: 'diary_read'; id: string }
  /** V0.18：gain = 加了多少好感（今天摸夠了就是 0）；left = 今天還能加幾次 */
  | { type: 'headpat'; gain: number; left: number; levelUp?: string }
  /** V0.14：cost = 花了多少金幣；coins = 二手賣得多少 */
  | { type: 'furniture_bought'; item: ItemId; count: number; cost: number }
  | { type: 'furniture_sold'; item: ItemId; coins: number }
  /** V0.13：牌是 1～13（1 = A）；gain = NPC 好感 */
  | { type: 'cards_played'; npc: string; mine: number; theirs: number; outcome: 'win' | 'lose' | 'tie'; gain: number; friendship: number }
  | { type: 'traded'; shop: ShopId; trade: string; get: Record<ItemId, number> }
  | { type: 'cleared'; plot: PlotId }
  | { type: 'sold'; item: ItemId; count: number; coins: number; shop?: ShopId }
  | { type: 'unlocked'; id: string }
  | { type: 'machine_started'; key: string; readyAt: number }
  | { type: 'machine_collected'; key: string; get: Record<ItemId, number> }
  | { type: 'building_upgraded'; building: string; level: number; capacity: number }
  | { type: 'animal_bought'; animal: number; kind: string; name: string }
  | { type: 'animals_fed'; building: string; count: number }
  | { type: 'animal_petted'; animal: number; mood: number; friendship: number }
  | { type: 'animals_collected'; building: string; items: Record<ItemId, number> }
  | { type: 'placed'; scene: string; item: ItemId; x: number; y: number }
  | { type: 'picked_up'; scene: string; item: ItemId }
  | { type: 'decorated'; scene: string; item: ItemId; returned?: ItemId }
  | { type: 'talked'; npc: string; text: string; gain: number; event?: { id: string; lines: string[] } }
  | { type: 'gifted'; npc: string; item: ItemId; gain: number; reaction: 'love' | 'like' | 'neutral' | 'dislike' }
  | { type: 'married' }
  | { type: 'mine_started'; floor: number; endsAt: number }
  | { type: 'mine_returned'; report: MineReport }
  | { type: 'gift_code'; code: string }
  | { type: 'gift_received'; items: Record<ItemId, number> }
  | { type: 'gear_set'; slot: 'rod' | 'bait'; item: ItemId | null }
  | { type: 'slept'; from: number; to: number; weather: WeatherId; watered: number; /** V0.17：這次睡覺寫的日記 id */ diary?: string }
  | { type: 'animal_sold'; animal: number; name: string; coins: number }
  | { type: 'pet_bought'; pet: number; kind: string; name: string }
  | { type: 'pet_fed'; pet: number; item: ItemId; satiety: number; affection: number }
  | { type: 'pet_petted'; pet: number; affection: number }
  | { type: 'companion_set'; pet: number | null }
  | { type: 'pet_released'; pet: number; name: string }
  | { type: 'pet_caught'; pet: number; kind: string; name: string; chance: number; net: ItemId }
  | { type: 'pet_escaped'; kind: string; fled: boolean; chance: number; net: ItemId }
  | { type: 'foraged'; scene: string; slot: number; item: ItemId; by?: number };

export type CoinSide = 'heads' | 'tails';

/** V0.14：家具目錄的一件家具 */
export interface FurnitureEntry {
  id: ItemId;
  name: string;
  /** 買價（金幣） */
  price: number;
  emoji: string;
  /** 佔幾格；沒寫 = 1×1。地板、壁紙不用寫 */
  size?: { w: number; h: number };
  /** furniture_shop.json 的 categories 的 key（furniture、deco、rug、outdoor、floor、wall…） */
  category: string;
  where?: 'indoor' | 'outdoor' | 'any';
  /** 擋不擋路；沒寫 = 擋（地毯預設不擋） */
  blocking?: boolean;
  rug?: boolean;
  description?: string;
  /** 新的地板／壁紙：換哪些圖塊（gameplay.json 已經有的可以不寫） */
  decor?: { kind: 'floor' | 'wall'; replace: Record<string, string> };
}

/** V0.14：furniture_shop.json */
export interface FurnitureShopFile {
  version: 1;
  name: string;
  emoji: string;
  /** 哪個居民的選單裡有「家具目錄」 */
  npc?: string;
  /** 二手賣出 = 買價 × resaleRate（也是出貨箱收購的價錢） */
  resaleRate: number;
  /** 分類 key → 顯示名稱（也是目錄分頁的順序） */
  categories: Record<string, string>;
  items: FurnitureEntry[];
}

/** V0.13：酒館裡一個 NPC 站的位置（酒館背景圖的原圖像素） */
export interface TavernSeat {
  npc: string;
  at: { x: number; y: number };
  face?: 'up' | 'down' | 'left' | 'right';
  /** 在做什麼（只是說明，畫面不用） */
  activity?: string;
  /** 原圖這條線（y）以下不畫：站在吧台後面時腳被擋住 */
  hideBelow?: number;
  /** 跟他說話時她要站哪（原圖像素）；沒寫就站在旁邊 */
  stand?: { x: number; y: number };
  /** 頭上偶爾冒的話 */
  bubble?: string[];
}

/** V0.13：tavern.json：酒館的小遊戲、社交時間 */
export interface TavernFile {
  /** 酒館的場景 id（interactables.json 裡的背景圖場景） */
  scene: string;
  coinFlip: {
    cost: number;
    reward: number;
    /** 猜對時她的好感 */
    affection: number;
    /** 一天最多從猜硬幣拿到多少好感（也受每日好感上限限制） */
    maxAffectionPerDay: number;
    lines: Record<'win' | 'lose' | 'broke', string[]>;
  };
  cards: {
    /** 贏了加 NPC 多少好感 */
    friendship: number;
    /** 每個 NPC 一天最多算幾次贏（再贏就不加好感了） */
    maxWinsPerDay: number;
    lines: Record<'win' | 'lose' | 'tie', string[]>;
  };
  /** 一直待在酒館的人（老闆） */
  residents: TavernSeat[];
  /** 社交時間：fromHour ≤ 現在幾點 < toHour（本機時間）時，這些 NPC 從小鎮移到酒館 */
  social: {
    fromHour: number;
    toHour: number;
    seats: TavernSeat[];
    /** 她走到 NPC 旁邊 talkRadius 格內時，自動說的話和 NPC 的回答（每個 NPC 每晚一次） */
    talkRadius: number;
    talks: Record<string, { her: string; reply: string }[]>;
  };
}

/** V0.11：leisure.json：泡澡、玩遊戲（掛機時她自己去遊戲室玩） */
export interface LeisureFile {
  version: 1;
  bath: {
    /** 恢復多少體力（不超過上限） */
    stamina: number;
    /** 好感（算在每日上限裡） */
    affection: number;
    /** 多久能再泡一次（小時，遊戲時間） */
    cooldownHours: number;
    /** V0.15：泡完澡在浴池裡游幾秒（點她就提早上岸）；預設 15 */
    swimSeconds?: number;
  };
  play: {
    games: Record<string, { name: string; emoji: string }>;
    /** 每玩一小時（現實時間）加多少好感；一次最多 maxAffectionPerSession，也算在每日上限裡 */
    affectionPerHour: number;
    maxAffectionPerSession: number;
    /** 玩遊戲也算休息：每小時回多少體力 */
    staminaPerHour: number;
    /** 最多算幾小時（掛機一整晚也只算這麼多） */
    maxHours: number;
    /** 每小時破幾關（台詞用的，好玩而已） */
    levelsPerHour: number;
    /** 主人幾分鐘沒動作，她就自己跑去遊戲室玩（0 = 不會自己去） */
    afkMinutes: number;
  };
  /** 台詞：{minutes}、{level}、{game}、{gain}、{stamina} 會換掉 */
  /** playQuit：玩不到一分鐘就被叫停 */
  /** swim：V0.15 在浴池游泳時頭上偶爾冒的話（可以沒有） */
  lines: Record<'bathIn' | 'bathCooldown' | 'playStart' | 'playing' | 'playEnd' | 'playQuit' | 'afkGo', string[]> & { swim?: string[] };
  /** V0.16：免費的小點心桌（例如遊戲室的零食桌）：每天能吃幾份、一份恢復多少 */
  snacks?: Record<string, SnackDef>;
  /** V0.16：冰箱：每天第一次打開會找到一樣東西（finds 照 weight 抽） */
  fridge?: FridgeDef;
  /** V0.18：摸摸頭（1.5 秒內點她 clicks 下）：每天前 perDay 次加 affection 好感；lines = 她說的話 */
  headpat?: { clicks: number; windowMs: number; affection: number; perDay: number; lines: string[] };
}

/** V0.16：一張點心桌 */
export interface SnackDef {
  name: string;
  emoji: string;
  /** 每天幾份（跨日補滿） */
  perDay: number;
  satiety: number;
  /** 沒寫 = 飽食度 × stats.json 的 eat.staminaPerSatiety */
  stamina?: number;
  /** 好感（算在每日上限裡） */
  affection: number;
  /** 吃的時候她說的話 */
  lines: string[];
}

/** V0.16：冰箱 */
export interface FridgeDef {
  /** 每天能找到幾次 */
  perDay: number;
  finds: { item: ItemId; weight: number; count?: number }[];
  /** found：找到東西（{item} 換成名字）；empty：今天找過了 */
  lines: { found: string[]; empty: string[] };
}

export type ActError =
  | 'no_stamina'
  | 'cooldown'
  | 'not_playing'
  | 'no_item'
  | 'not_food'
  | 'full'
  | 'plot_busy'
  | 'plot_empty'
  | 'not_ready'
  | 'not_seed'
  | 'wrong_season'
  | 'already_watered'
  | 'has_sprinkler'
  | 'not_for_sale'
  | 'locked'
  | 'already'
  | 'busy'
  | 'no_room'
  | 'too_deep'
  | 'weak_pickaxe'
  | 'away'
  | 'not_here'
  | 'not_today'
  | 'too_soon'
  | 'bad_code'
  /** V0.22：自己的攤位碼、碼不是給這個存檔的、價格超出範圍、訪客模式不能做 */
  | 'own_code'
  | 'not_yours'
  | 'bad_price'
  | 'visitor'
  | 'wrong_shop'
  | 'too_many_pets'
  | 'sold_out'
  | 'gone'
  | 'not_hungry'
  | 'not_here'
  | 'unknown'
  | 'no_game';

/** 給前端顯示用的狀態快照（host 算好，前端不用自己推算） */
export interface GameView {
  /** V0.18：今天的小願望；null = 還沒開始許願 */
  wish: { id: string; day: string; text: string; emoji: string; hint: string; progress: number; need: number; done: boolean; affection: number } | null;
  /** V0.17：日記（新的在前面）；unread = 最新一篇還沒看過的 id；today = 今天記了幾件事 */
  diary: { entries: DiaryEntry[]; unread: string | null; today: number };
  stamina: number;
  staminaMax: number;
  satiety: number;
  satietyMax: number;
  affection: number;
  level: string;
  /** 下一個等級需要的好感；已經最高級則是 null */
  nextLevelAt: number | null;
  inventory: Record<ItemId, number>;
  coins: number;
  plots: Record<PlotId, PlotView | null>;
  /** 冷卻結束、可以再釣的時間 */
  fishReadyAt: number;
  /** 圖鑑：每種東西釣到過幾次 */
  caught: Record<ItemId, number>;
  claimed: string[];
  sprinklers: PlotId[];
  /** 沒有 calendar 設定時是 null */
  season: { id: SeasonId; name: string; emoji: string; day: number; days: number } | null;
  weather: WeatherDef;
  festival: FestivalDef | null;
  unlocked: string[];
  machines: Record<string, (MachineState & { ready: boolean }) | null>;
  buildings: Record<string, { level: number; capacity: number; count: number; maxLevel: number }>;
  animals: (AnimalState & { hungry: boolean; pettedToday: boolean; adult: boolean; growsAt: number; sellPrice: number })[];
  placed: Record<string, PlacedItem[]>;
  decor: Record<string, Partial<Record<'floor' | 'wall', ItemId>>>;
  npcs: Record<string, { friendship: number; hearts: number; talkedToday: boolean; giftedToday: boolean; events: string[] }>;
  married: boolean;
  canPropose: boolean;
  /** 婚後她今天幫了什麼（今天沒有就是 null） */
  help: { watered: number; petted: number } | null;
  mine: { deepest: number; trip: (MineTrip & { ready: boolean }) | null };
  equipment: Record<EquipSlot, { item: ItemId | null; power: number }>;
  /** V0.5：釣魚 */
  fishing: { rod: ItemId | null; bait: ItemId | null; baitLeft: number; waitMs: number; rare: Record<Rarity, number> };
  luckUntil: number;
  /** V0.14：家具：買過幾件（總數）、現在擺出去幾件（所有地圖加起來） */
  furniture: { bought: Record<ItemId, number>; placed: Record<ItemId, number> };
  /** V0.5：目前的任務；做完全部任務是 null */
  quest: QuestView | null;
  /** 最近完成的一步（畫面用 at 判斷是不是新的） */
  questLast: QuestLog | null;
  /** V0.6：寵物 */
  pets: PetView[];
  companion: number | null;
  /** V0.22：社交（沒有 social.json 就是 null） */
  social: {
    id: string;
    nick: string;
    stall: StallListing[];
    market: MarketOffer[];
    /** 下次可以產生領養碼的時間（0 = 現在就可以） */
    adoptReadyAt: number;
    mailbox: Letter[];
    unread: number;
  } | null;
  /** V0.6：現在出現的野生寵物（每張地圖最多一隻） */
  wild: WildSpawn[];
  /** V0.6：今天還沒撿的掉落物 */
  forage: ForageSpot[];
  /** V0.6：今天早上農場的事（今天沒有就是 null） */
  farmReport: FarmReport | null;
  /** V0.6.2：今天每筆交換換了幾次（key = 商人:交換 id） */
  shopToday: Record<string, number>;
  /** V0.7：數值狀態 */
  stats: StatView;
}

export interface StatView {
  lowRatio: number;
  /** 低於 lowRatio */
  low: { stamina: boolean; satiety: boolean };
  /** 飽食度歸零：體力上限減半、好感每天下降 */
  starving: boolean;
  /** 沒餓的時候的體力上限 */
  staminaBase: number;
  costs: Record<StatAction, number>;
  /** 什麼時候可以再喝水（0 = 沒有喝水設定） */
  drinkReadyAt: number;
  drinkTables: string[];
  /** V0.11：什麼時候可以再泡澡（0 = 沒有泡澡設定） */
  bathReadyAt: number;
  /** V0.11：正在玩的遊戲 */
  play: { game: string; name: string; emoji: string; since: number } | null;
  /** V0.13：酒館：現在是不是社交時間、誰在酒館、今天猜硬幣還能拿多少好感、跟誰打牌贏了幾次 */
  tavern: { social: boolean; npcs: string[]; flipAffectionLeft: number; cardWins: Record<string, number> } | null;
  /** V0.16：今天每張點心桌還剩幾份、冰箱還能找幾次 */
  pantry: { snacks: Record<string, number>; fridge: number };
}

export interface PetView extends PetState {
  emoji: string;
  speciesName: string;
  home: string;
  hungry: boolean;
  pettedToday: boolean;
  /** 技能現在有沒有在作用、強度倍率 */
  skillActive: boolean;
  skillPower: number;
}

export interface WildSpawn {
  id: string;
  scene: string;
  kind: string;
  /** 這一段時間結束就離開 */
  until: number;
}

export interface ForageSpot {
  scene: string;
  slot: number;
  item: ItemId;
}

export interface QuestView {
  chain: string;
  chainName: string;
  /** 第幾步（0 起算）＝ tutorial_step */
  step: number;
  total: number;
  stepId: string;
  task: string;
  progress: number;
  need: number;
  say: string[];
  nag: string[];
  target?: { scene: string; object?: string };
  /** 下一次可以催促的時間（遊戲時間）；畫面用自己的計時器，這裡給參考 */
  nagEverySec: number;
}

export interface PlotView {
  crop: CropId;
  stage: number;
  stageName: string;
  emoji: string;
  ready: boolean;
  /** 預估下一個階段的時間；成熟了、或沒水又完全不長時是 null */
  nextAt: number | null;
  /** 現在土是濕的（澆過水、下雨、溫室或有灑水器） */
  watered: boolean;
  sprinkler: boolean;
}
