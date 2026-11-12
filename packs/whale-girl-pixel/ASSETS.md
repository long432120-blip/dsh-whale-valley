# 素材來源與授權

> **AI 生成標示**：本角色包的美術素材大多是 AI 生成的（ChatGPT／GPT 影像、豆包），再由程式去背、裁切、縮放。
> 下表「AI 生成」那一欄就是標示。部分豆包原圖角落的「豆包 AI生成」浮水印在去背時被裁掉了，所以在這裡補上文字標示。

## 授權範圍

- **程式碼、Tiled 地圖、程式畫的臨時圖塊／表情／主人**：MIT（同專案根目錄的 `LICENSE`）。
- **其他美術與音樂**（下表標「作者保留」的）：**不在 MIT 授權範圍內**。可以隨本遊戲一起散布、遊玩、直播和錄影；
  要單獨拿去用（例如放進別的遊戲、商用）請先聯絡作者。AI 生成內容的使用條件也受各生成服務的條款約束。

| 檔案 | 來源 | AI 生成 | 授權 |
|---|---|---|---|
| `assets/tiles.png` | 為本專案用程式繪製的臨時圖塊（房間、花園、田地、商人攤位、沙灘、石板、礦洞、溫室、閣樓、牧場與小鎮的建築） | 否 | MIT |
| `assets/player.png` | 為本專案用程式畫的佔位人物（主人），玩家操控模式用 | 否 | MIT |
| `assets/emotes.png` | 為本專案手點的表情圖示 | 否 | MIT |
| `maps/*.tmj`、`maps/tiles.tsj` | 為本專案製作的 Tiled 地圖 | 否 | MIT |
| `assets/whale-girl-world.png`、`whale-girl-actions.webp`、`whale-girl-portrait.webp` | 作者提供的鯨魚娘走路圖、動作表、待機立繪，用 `tools/import_sheet.py` 去背、對齊、縮小 | 是 | 作者保留 |
| `assets/whale-girl-tavern-sit.png`、`whale-girl-swim.png` | 作者提供的酒館坐姿、游泳兩格動畫；綠幕去背、縮小 | 是 | 作者保留 |
| `assets/tiles-hd.webp`、`assets/sprites.webp`、`sprites.json`、`assets/pets/{jellyfish,fairy,mole}.png` | 作者用 GPT 生成的素材表，由 `tools/import_asset_sheet.py` 切開、去背、縮放 | 是（GPT） | 作者保留 |
| `assets/rooms/whale-room.webp`、`kitchen.webp`、`bath.webp` | 作者提供的房間、廚房、浴室背景圖 | 是 | 作者保留 |
| `assets/rooms/gameroom.webp` | 作者提供的遊戲室背景圖。**V0.20 開源前**，原圖上類似現有作品的圖案（收藏櫃的草帽骷髏旗與機器人頭、問號磚、蘑菇磚、街機的外星人、電視裡的平台遊戲畫面）已用 `tools/fix_gameroom_ip.py` 換成原創的像素小圖（鯨魚、星星、魚、貝殼、船錨） | 是 | 作者保留 |
| `assets/rooms/tavern.webp`、`assets/npc/barkeep.png`、`barkeep-big.png` | 作者提供的酒館內部背景圖與老闆老吳。街機螢幕上類似經典遊戲角色的外星人，V0.20 已用 `tools/fix_tavern_ip.py` 換成霓虹小鯨魚 | 是 | 作者保留 |
| `assets/npc/fisher.png`、`florist.png`、`smith.png`、`goddess.png`（及 `*-big.png`） | 作者提供的居民立繪：老陳、小葵、阿綱、湖中女神；綠幕去背、只留人物、縮小。湖中女神和阿綱的原圖有「豆包 AI生成」浮水印，去背時被裁掉 | 是（豆包） | 作者保留 |
| `assets/pets/dog-walk.png`、`cat-walk.png` | 作者提供的柴犬、橘貓走路圖；綠幕去背、去影子、對齊。原圖有「豆包 AI生成」浮水印，去背時被裁掉 | 是（豆包） | 作者保留 |
| `assets/ui/hud-board.png`、`assets/ui/weather-icons.png` | 作者提供的像素木牌與天氣圖示；`tools/key_green.py` 去綠幕、裁切縮小 | 是 | 作者保留 |
| `music/*.mp3`（農場白天、夜晚房間、下雨、礦洞冒險、酒館） | 作者提供的背景音樂，統一音量後轉成 96 kbps | 由作者確認 | 作者保留；來源與授權由作者負責確認 |

原始大圖（`assets/source/`，約 80 MB）沒有放進 Git，只留在作者電腦上；需要重新切圖時再放回這個資料夾。

物品與作物目前用系統 emoji 顯示（`gameplay.json` 的 `emoji` 欄位），不附帶圖檔；各平台的 emoji 外觀會略有不同。
家具、動物、怪物、礦石的 emoji 在 V0.12 起大多換成 `sprites.webp` 的圖示，換圖不用改規則。
