// 內嵌版角色包（雙擊版 demo、DSH 客戶端共用）：所有 JSON 和圖片在打包時就放進來。
// 新增地圖或圖片時，只要改這一個檔案。
import animals from '../../../packs/whale-girl-pixel/animals.json';
import character from '../../../packs/whale-girl-pixel/character.json';
import fishing from '../../../packs/whale-girl-pixel/fishing.json';
import gameplay from '../../../packs/whale-girl-pixel/gameplay.json';
import interactables from '../../../packs/whale-girl-pixel/interactables.json';
import sprites from '../../../packs/whale-girl-pixel/sprites.json';
import attic from '../../../packs/whale-girl-pixel/maps/attic.tmj';
import beach from '../../../packs/whale-girl-pixel/maps/beach.tmj';
import garden from '../../../packs/whale-girl-pixel/maps/garden.tmj';
import greenhouse from '../../../packs/whale-girl-pixel/maps/greenhouse.tmj';
import mine from '../../../packs/whale-girl-pixel/maps/mine.tmj';
import ranch from '../../../packs/whale-girl-pixel/maps/ranch.tmj';
import room from '../../../packs/whale-girl-pixel/maps/room.tmj';
import tiles from '../../../packs/whale-girl-pixel/maps/tiles.tsj';
import town from '../../../packs/whale-girl-pixel/maps/town.tmj';
import quests from '../../../packs/whale-girl-pixel/quests.json';
import pets from '../../../packs/whale-girl-pixel/pets.json';
import stats from '../../../packs/whale-girl-pixel/stats.json';
import leisure from '../../../packs/whale-girl-pixel/leisure.json';
import tavern from '../../../packs/whale-girl-pixel/tavern.json';
import music from '../../../packs/whale-girl-pixel/music.json';
import furnitureShop from '../../../packs/whale-girl-pixel/furniture_shop.json';
import diaryJson from '../../../packs/whale-girl-pixel/diary.json';
import wishesJson from '../../../packs/whale-girl-pixel/wishes.json';
import socialJson from '../../../packs/whale-girl-pixel/social.json';
import scenes from '../../../packs/whale-girl-pixel/scenes.json';
import weather from '../../../packs/whale-girl-pixel/weather.json';
import emotesPng from '../../../packs/whale-girl-pixel/assets/emotes.png';
import fisherBig from '../../../packs/whale-girl-pixel/assets/npc/fisher-big.png';
import fisherPng from '../../../packs/whale-girl-pixel/assets/npc/fisher.png';
import floristBig from '../../../packs/whale-girl-pixel/assets/npc/florist-big.png';
import floristPng from '../../../packs/whale-girl-pixel/assets/npc/florist.png';
import goddessBig from '../../../packs/whale-girl-pixel/assets/npc/goddess-big.png';
import petCat from '../../../packs/whale-girl-pixel/assets/pets/cat-walk.png';
import petDog from '../../../packs/whale-girl-pixel/assets/pets/dog-walk.png';
import petJellyfish from '../../../packs/whale-girl-pixel/assets/pets/jellyfish.png';
import petFairy from '../../../packs/whale-girl-pixel/assets/pets/fairy.png';
import petMole from '../../../packs/whale-girl-pixel/assets/pets/mole.png';
import goddessPng from '../../../packs/whale-girl-pixel/assets/npc/goddess.png';
import smithBig from '../../../packs/whale-girl-pixel/assets/npc/smith-big.png';
import smithPng from '../../../packs/whale-girl-pixel/assets/npc/smith.png';
import playerPng from '../../../packs/whale-girl-pixel/assets/player.png';
import tilesPng from '../../../packs/whale-girl-pixel/assets/tiles.png';
import actionsWebp from '../../../packs/whale-girl-pixel/assets/whale-girl-actions.webp';
import tavernSitPng from '../../../packs/whale-girl-pixel/assets/whale-girl-tavern-sit.png';
import swimPng from '../../../packs/whale-girl-pixel/assets/whale-girl-swim.png';
import portrait from '../../../packs/whale-girl-pixel/assets/whale-girl-portrait.webp';
import worldPng from '../../../packs/whale-girl-pixel/assets/whale-girl-world.png';
import roomWebp from '../../../packs/whale-girl-pixel/assets/rooms/whale-room.webp';
import kitchenWebp from '../../../packs/whale-girl-pixel/assets/rooms/kitchen.webp';
import bathWebp from '../../../packs/whale-girl-pixel/assets/rooms/bath.webp';
import gameroomWebp from '../../../packs/whale-girl-pixel/assets/rooms/gameroom.webp';
import tavernWebp from '../../../packs/whale-girl-pixel/assets/rooms/tavern.webp';
import npcBarkeep from '../../../packs/whale-girl-pixel/assets/npc/barkeep.png';
import npcBarkeepBig from '../../../packs/whale-girl-pixel/assets/npc/barkeep-big.png';
import tilesHdWebp from '../../../packs/whale-girl-pixel/assets/tiles-hd.webp';
import spritesWebp from '../../../packs/whale-girl-pixel/assets/sprites.webp';
import hudBoardPng from '../../../packs/whale-girl-pixel/assets/ui/hud-board.png';
import weatherIconsPng from '../../../packs/whale-girl-pixel/assets/ui/weather-icons.png';
import { assembleGameplay, type AnimalsPart, type FishingPart, type PetsPart } from '../../shared/gameplay-pack.ts';
import type { DiaryFile } from '../../shared/diary.ts';
import type { SocialFile } from '../../shared/trade.ts';
import type { WishesFile } from '../../shared/wishes.ts';
import type { FurnitureShopFile, GameplayFile, LeisureFile, QuestFile, StatsFile, TavernFile, WeatherFile } from '../../shared/gameplay-types.ts';
import { bundledSource } from './pack-loader.ts';

export const bundledPack = bundledSource(
  {
    'scenes.json': scenes,
    'character.json': character,
    'maps/room.tmj': room,
    'maps/garden.tmj': garden,
    'maps/ranch.tmj': ranch,
    'maps/beach.tmj': beach,
    'maps/town.tmj': town,
    'maps/greenhouse.tmj': greenhouse,
    'maps/attic.tmj': attic,
    'maps/mine.tmj': mine,
    'maps/tiles.tsj': tiles,
    'interactables.json': interactables,
    'music.json': music,
    'sprites.json': sprites,
  },
  {
    'assets/tiles.png': tilesPng,
    'assets/whale-girl-world.png': worldPng,
    'assets/whale-girl-portrait.webp': portrait,
    'assets/emotes.png': emotesPng,
    'assets/whale-girl-actions.webp': actionsWebp,
    'assets/whale-girl-tavern-sit.png': tavernSitPng,
    'assets/whale-girl-swim.png': swimPng,
    'assets/player.png': playerPng,
    'assets/npc/fisher.png': fisherPng,
    'assets/npc/fisher-big.png': fisherBig,
    'assets/npc/florist.png': floristPng,
    'assets/npc/florist-big.png': floristBig,
    'assets/npc/smith.png': smithPng,
    'assets/npc/smith-big.png': smithBig,
    'assets/npc/goddess.png': goddessPng,
    'assets/npc/goddess-big.png': goddessBig,
    'assets/pets/cat-walk.png': petCat,
    'assets/pets/dog-walk.png': petDog,
    'assets/pets/jellyfish.png': petJellyfish,
    'assets/pets/fairy.png': petFairy,
    'assets/pets/mole.png': petMole,
    'assets/rooms/whale-room.webp': roomWebp,
    'assets/rooms/kitchen.webp': kitchenWebp,
    'assets/rooms/bath.webp': bathWebp,
    'assets/rooms/gameroom.webp': gameroomWebp,
    'assets/rooms/tavern.webp': tavernWebp,
    'assets/npc/barkeep.png': npcBarkeep,
    'assets/npc/barkeep-big.png': npcBarkeepBig,
    'assets/tiles-hd.webp': tilesHdWebp,
    'assets/sprites.webp': spritesWebp,
    'assets/ui/hud-board.png': hudBoardPng,
    'assets/ui/weather-icons.png': weatherIconsPng,
  },
);

/** 五個玩法 JSON 組好的定義（demo 沒有 host 時直接用；DSH 裡由 host 讀，還會合併 mods/） */
export const bundledGameplay: GameplayFile = assembleGameplay(gameplay, {
  fishing: fishing as unknown as FishingPart,
  weather: weather as unknown as WeatherFile,
  animals: animals as unknown as AnimalsPart,
  quests: quests as unknown as QuestFile,
  pets: pets as unknown as PetsPart,
  stats: stats as unknown as StatsFile,
  leisure: leisure as unknown as LeisureFile,
  tavern: tavern as unknown as TavernFile,
  furniture: furnitureShop as unknown as FurnitureShopFile,
  diary: diaryJson as unknown as DiaryFile,
  wishes: wishesJson as unknown as WishesFile,
    social: socialJson as unknown as SocialFile,
});
