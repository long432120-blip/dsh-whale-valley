# 交接文件：dsh-whale-pet（鯨魚娘桌寵）

> **2026-11-12 最新：請先讀 [`交接-給DSH-V0.22實機驗收.md`](交接-給DSH-V0.22實機驗收.md)**（專案已改名 `dsh-whale-valley`、做到 V0.22、已開源；需要你在 DSH 實機驗收）。**V0.23 改了 DSH 的進入方式（啟動器＋全螢幕／新視窗）；V0.24 改成「左側欄入口＋中央面板」；V0.25 再改成「點側欄＝用系統瀏覽器開獨立視窗」，DSH 不會被遮住，請看下面表格最上面三列。**
>
> ⚠️ **上架狀態與待辦看 [`上架-插件市場.md`](上架-插件市場.md)**：2026-11-12 查證仍未上架（npm 404、市場索引 0 筆、官方清單 38 個都是 @deepseek-ai/*）。**GitHub `main` 目前還停在 0.22.0**（`lib/client.js` 也是那時的），所以 `dsh plugin add github:…` 會裝到舊版；上架前一定要先把 0.23～0.25 同步上去。
>
> 下面是舊的交接內容，留著當參考。

> 給接手的 DeepSeek Harness（DSH）agent。先讀這份，再讀 `README.md` 和 `docs/開發文件.md`（V0.21 起開發說明搬到這裡），然後才動程式。
> 專案擁有者用**繁體中文**溝通，回覆、註解、文件、遊戲內文字都用繁體中文。
>
> **第二版交接（2026-11-11 下午）**：你上一輪的修改（DSH 實機 API、`ai-llm.ts`、縮放修正、存檔夾值…）已經全部合併保留。
> 之後 Claude 又加了 V0.9 的「背景圖房間＋互動熱區」。先看第 0 節。

---

## 0. 從你上一輪到現在，變了什麼

**你上一輪的修改：全部保留**（Claude 用 V0.8 當共同基準做三方合併，沒有衝突，沒有覆蓋）：

- `src/host/index.ts`：Schemastery、`ctx.webServer.register`、`ctx.tools.register` 的實測寫法
- `src/client/dsh-entry.tsx`：`slots.inject('shell.overlay', …)`；`package.json` 的 `dsh.client.inject` 改成 `@deepseek-ai/dsh-client-ui-layout`
- `scripts/build-client.ts`：client 打包成 `window.__ModuleLoader__.load` 格式
- `src/host/ai-llm.ts`＋`test/ai-llm.test.ts`：沒有 Key 時走 DSH 的 `llm` 服務
- `src/host/service.ts`：`ai-error.log`、llm 接線
- `src/shared/gameplay.ts`：讀存檔時把體力、飽食夾回合法範圍
- `pixel-stage.ts` 的 `resize()`：比 320px 窄時等比縮小；ResizeObserver 排到下一幀
- `tsconfig.json`：把 DSH 的三個檔案加進型別檢查
- `docs/開發文件.md` 的「V0.9：直接接 DSH 的模型」一節

**Claude 新加的（V0.9：背景圖房間＋互動熱區）**，詳細在 `docs/V0.9-設計書.md`：

- 房間（`room`）不再用 Tiled 圖塊畫，改用一整張背景圖 `packs/whale-girl-pixel/assets/rooms/whale-room.webp`。
- 圖上哪裡能點、點了做什麼，全部在 `packs/whale-girl-pixel/interactables.json`（**座標是原圖像素**，1402×1122）。載入時由 `src/shared/hotspots.ts` 的 `buildBackgroundMap()` 換算成 15×12 格的地圖，尋路、站位、門、作息照舊。
- 滑鼠停在家具上：小手游標＋發光框＋提示文字。
- 床 → 睡覺；沙發几 → 她坐下＋揹包新分頁「吃的」；水族箱／書架 → 圖鑑；書桌 → 料理台；寶箱 → 揹包；窗戶等 → 說一句話；門 → 花園；船錨旁的爬梯 → 閣樓（要擴建）。
- 走過去觸發；走不到時黑幕一閃直接過去（`approach: walk／fade／none`）。
- `room.tmj` 還在（拿它的圖塊集給擺家具用），但房間的地板、牆、出生點、門都以 `interactables.json` 為準。

**目前狀態**：121 個單元測試全過、`check-pixel` 通過、`build` 通過、瀏覽器實測熱區全部正常。
**但 V0.9 的房間還沒在 DSH 裡跑過**，也還沒在你那邊跑過完整的 `typecheck`（Claude 的環境沒有 `@deepseek-ai/*`；擁有者電腦的虛擬環境讀不到 pnpm 的 Windows 連結，`@types/node` 也找不到）。

---

## 1. 這是什麼

一個 DSH 插件：一隻像素風的桌面寵物「鯨魚娘」，玩法像星露谷物語，有釣魚、種田、牧場、小鎮居民、礦洞、裝修、寵物、天氣、四季、任務引導和數值系統。V0.8 加上 AI 動態對話，V0.9 房間換成背景圖＋互動熱區。

- **現在能玩的**：雙擊 `demo/pixel-standalone.html`（純前端，存檔放在 localStorage）。給朋友的試玩包在 `release/`（最新是 v0.9）。
- **DSH 實機**：host／client 入口已經由你對照 DSH 0.2.1-rc.5 改成實測寫法（見 `src/host/index.ts`、`src/client/dsh-entry.tsx` 開頭的註解）。

版本：`package.json` 是 0.9.0，`engines.dsh` 是 `>=0.2.1-rc.5 <0.3.0`。

---

## 2. 架構（不要破壞）

**Host 是唯一真相，前端只透過 `HostBridge` 讀寫。**

```
瀏覽器（Canvas 畫面）                       Host（Node，Cordis 插件）
src/client/pixel/pixel-stage.ts             src/host/service.ts  WhalePetService
   │  HostBridge（src/shared/types.ts）         │  規則全部在 src/shared/*（純函數）
   │  ├─ LocalBridge（demo，localStorage）       │  存檔：JsonStore（src/host/store.ts）
   │  └─ createDshBridge(transport) ───────────▶ handleBridgeCall（src/host/routes.ts，方法白名單）
```

- 遊戲規則都在 `src/shared/`（`gameplay.ts`、`pets.ts`、`state.ts`…），是純函數，前後端共用。`LocalBridge` 和 `WhalePetService` 跑的是同一套規則。
- 畫面只負責走路、播動畫、顯示結果。釣到什麼、好感加多少，都由 host 的 `act()` 決定並存檔。
- 時間是「看時間戳記補算」（lazy tick），最多補 72 小時。遊戲時間等於現實時間加上 `clockOffset`（睡覺會跳時間）。
- Bridge 的方法有七個：`visit`、`getView`、`setScene`、`poke`、`act`、`gameplay`、`chat`。新增方法時，`BRIDGE_METHODS`、`PetApi`、`HostBridge`、`bridge-dsh.ts`、`bridge-local.ts` 五個地方都要改。
- 玩法資料都是 JSON，放在 `packs/whale-girl-pixel/`：`gameplay.json`、`fishing.json`、`weather.json`、`animals.json`、`quests.json`、`pets.json`、`stats.json`、`ai.json`、`interactables.json`（背景圖場景的互動熱區）、`scenes.json`、`character.json`、`maps/*.tmj`（Tiled 地圖）。合併邏輯在 `src/shared/gameplay-pack.ts`。使用者也可以在存檔資料夾的 `mods/*.json` 覆蓋。

### 🔒 安全規則（擁有者特別要求，絕對不能違反）

1. **API Key 絕對不能進前端。** 不能出現在 `src/client/**`、`src/shared/**`，也不能出現在打包後的 `lib/client.js`、`demo/*.html`。`test/ai.test.ts` 最後一個測試會掃描原始碼。
2. Key 只能在 host 讀取，優先順序是：DSH 設定 `ai.apiKey` → 環境變數 `DEEPSEEK_API_KEY` → `.env`。`.env` 在 `.gitignore` 裡，不要 commit。
3. 瀏覽器送給 host 的 `chat` 請求只能有 `{ speaker, trigger, event(只收 id) }`。遊戲狀態一律由 host 從存檔整理，不信任瀏覽器送來的快照。
4. log 只能印遮罩後的 Key（`maskKey`）。API 的錯誤內容不能回傳給瀏覽器。

---

## 3. 你的任務（依優先順序）

### P0：在你那邊跑完整檢查（Claude 跑不到的部分）

```bash
pnpm install          # 確認 @types/node、@types/react、@deepseek-ai/* 都在
pnpm typecheck        # 包含 host/index.ts、host/service.ts、client/dsh-entry.tsx
pnpm test             # 應該是 121 個全過
npx tsx scripts/check-pixel.ts
pnpm build
```

有型別錯誤就修。**只修錯誤，不要順便重構**，特別是 `pixel-stage.ts`（Claude 也在改這個檔案，見第 8 節）。

### P1：V0.9 房間在 DSH 裡跑一次

用 `dsh plugin --profile <開發 profile> add link:<本專案路徑>` 掛上，確認：

| # | 要確認什麼 | 可能的問題 |
|---|---|---|
| 1 | 房間的背景圖有出來 | 背景圖用 dataurl 打進 `lib/client.js`（client 約 2.3 MB）。宿主的 ModuleLoader 能不能載這麼大的檔案 |
| 2 | 滑鼠移到家具上：游標變小手、家具發光、有提示文字 | DSH 浮層如果攔截 `pointermove`，或游標樣式被宿主的 CSS 蓋掉 |
| 3 | 點床 → 睡覺視窗；點沙發几 → 她坐下＋揹包「吃的」分頁；點水族箱 → 圖鑑 | |
| 4 | 浮層很窄（比 320px 窄）時，點家具的位置還準不準 | 你的 `resize()` 會用 CSS 等比縮小 canvas；點擊換算用 `getBoundingClientRect`，理論上會跟著縮，但沒在 DSH 實測過 |
| 5 | 點她說話：有 Key 或有 llm 服務時走 AI，沒有時用 JSON 台詞 | |

**完成標準**：上面五項都正常；重開 DSH 進度還在；模型能呼叫 `whale_pet_status`。

### P2：還標著 ⚠ 的地方

| 位置 | 要確認什麼 |
|---|---|
| `src/host/service.ts` 第 3 行 | 註解還寫「未在 DSH 實機編譯」。P0 跑過之後把它改成事實 |
| `src/host/service.ts` 建構子 | 內建 `storage` 服務有沒有提供插件專屬目錄；沒有的話才沿用 `~/.dsh/storages/dsh-whale-pet/` |
| `cordis.patch.yml` | 格式（設定放在 `config:` 底下）。你已經在 `package.json` 加了 `dsh.bundle.patch` 指向它，確認它真的有被讀到 |

### P3：先別做，問過擁有者再說

- 換掉佔位美術（建築、動物、作物、物品目前是程式畫的圖塊和 emoji）。擁有者有一份試算表「鯨魚娘 2D 素材更換清單」，也在用 GPT 生素材。
- 下一版的版號：你和 Claude 都把自己的修改標成 V0.9，README 裡現在有兩段 V0.9。**下一版用什麼版號請先問擁有者。**
- 這個資料夾**沒有 git**。兩個 agent 輪流改同一個資料夾很容易互相覆蓋，可以建議擁有者 `git init`（要他同意才做）。
- （V0.21 已刪除 `packs/whale-girl-pixel/assets/pets/` 裡沒在用的舊 `dog.png`、`cat.png`。）

---

## 4. 指令

```bash
npm install
npm run typecheck           # tsc --noEmit（含 DSH 的三個檔案，要先裝好 @deepseek-ai/*）
npm test                    # 149 個單元測試，全部要過
npx tsx scripts/check-pixel.ts   # 檢查角色包（地圖、台詞、物品）
npm run build               # lib/index.js（host）＋ lib/client.js（client）
npm run demo:build          # demo/pixel.js
npm run demo:standalone     # demo/pixel-standalone.html（雙擊就能玩）
npm run demo:ai             # 本機 AI demo，讀 .env，http://127.0.0.1:8787
```

**改完一定要跑**：`typecheck`、`npm test`、`check-pixel`、`build`、`demo:standalone`，然後打開 `demo/pixel-standalone.html` 實際點一點。瀏覽器的 e2e 腳本（Playwright）不在 repo 裡，請手動檢查下面這些：

- 點她會說話；點地面她會走過去。
- 釣魚、種田、餵食都正常；狀態列的數值會變。
- 點居民會跳出選項（聊天／送禮／逛商店／離開）。
- 側邊欄（揹包 B、地圖 M、圖鑑 C、寵物 K）打得開。
- 商店是畫面中間的獨立視窗，背後有黑幕。
- 睡覺會跳到隔天早上。
- 沒有 Key 時點她：會用 JSON 台詞，畫面不會卡在「思考中」。
- 房間（V0.9）：滑鼠移到家具上會發光；床、沙發几、水族箱、書架、書桌、寶箱、窗戶、門都點得動；門在房間最下面。

---

## 5. 擁有者的習慣（照做）

- **每做完一版都要打包給朋友：**
  1. `npm run demo:standalone`。
  2. 複製成 `release/鯨魚娘-試玩版-v<版本>/鯨魚娘.html`。
  3. 附上 `怎麼玩.txt`（從上一版複製，加上這版的新東西，存成 UTF-8 with BOM，Windows 記事本才不會亂碼）。
  4. 壓成同名的 `.zip`。
  5. 版本號同步改到 `package.json`。
- **每一版寫一份設計書** `docs/V<版本>-設計書.md`，內容包括 JSON 範例、偽代碼、改了哪些檔案；`docs/開發文件.md` 也加一段（README 只放給玩家看的內容）。
- **UI 原則：**
  - 地圖上不要蓋東西。系統面板都放在右邊可以收合的側邊欄。
  - 商店、地圖這類放在畫面中間的獨立 Modal，背後有黑幕。
  - 對話是畫面中間偏下的 RPG 對話框（半透明黑底白字、有頭像）。
  - 按鈕做不了的時候要變灰並寫原因（「金幣不足」「已售罄」），錯誤提示不要疊一堆。
- **數值和文字放 JSON，不要寫死在程式裡**，方便擁有者自己改。
- 不確定 DSH API 的地方，**標 `⚠` 註解**寫清楚是推測，不要假裝確定。
- **熱區座標用原圖像素寫在 JSON**，不要寫死在程式裡；改完跑 `check-pixel` 檢查站位走不走得到。
- 擁有者電腦上的專案資料夾是 `%USERPROFILE%\Desktop\dsh-whale-pet`。

---

## 6. 檔案地圖（重點）

| 路徑 | 內容 |
|---|---|
| `src/shared/gameplay.ts` | 玩法規則主體：`applyAction`、`tickGame`、`gameView`、`buildDefs`、`validateGameplay` |
| `src/shared/gameplay-types.ts` | 所有玩法型別（`GameAction`、`GameEvent`、`GameplayFile`…） |
| `src/shared/state.ts` | 存檔層：`createSave`、`visit`、`act`、`migrate`、`toView` |
| `src/shared/pets.ts` | 寵物、野外捕捉、掉落物、烏鴉 |
| `src/shared/ai.ts` | AI：型別、快照、Prompt 組裝、回覆整理、請求驗證、`RateGate` |
| `src/shared/hotspots.ts` | V0.9：背景圖場景、熱區點擊判定（`hotspotAt`）、換算成格子地圖（`buildBackgroundMap`）、檢查（`validateInteractables`） |
| `packs/whale-girl-pixel/interactables.json` | V0.9：房間的背景圖、地板、障礙、出生點、11 個熱區 |
| `src/host/service.ts` | `WhalePetService`：存檔、讀 mods、AI 設定、`chat()` |
| `src/host/routes.ts` | `handleBridgeCall`（白名單）、`whalePetTools` |
| `src/host/index.ts` | Cordis 入口、設定 Schema、`webServer` 路由與 tool 註冊 |
| `src/host/ai*.ts` | AI：`chatCompletion`（逾時、錯誤處理）、讀 Key、`WhaleAi`（防抖、記憶）、`ai-llm.ts`（走 DSH 的 llm 服務） |
| `src/client/dsh-entry.tsx` | DSH 客戶端入口（`shell.overlay` 槽位） |
| `scripts/build-client.ts` | client 打包成 DSH 的 ModuleLoader 格式 |
| `src/client/bridge-dsh.ts` / `bridge-local.ts` | 兩種 bridge |
| `src/client/pixel/pixel-stage.ts` | 整個畫面（約 3300 行）：走路、互動、對話、天氣、任務引導、AI 觸發、背景圖與熱區 |
| `src/client/pixel/ui-panels*.ts` | 側邊欄、Modal、商店、揹包、圖鑑、寵物… |
| `src/client/pixel/dialogue.ts` | RPG 對話框（打字機效果、選項、思考中） |
| `test/*.test.ts` | 單元測試（`node --test`） |
| `docs/V0.5～V0.9-設計書.md` | 各版設計 |
| `release/` | 給朋友的試玩包 |

除錯：畫面的 `.px-stage` 元素上有 `__pxDebug()`，可以看場景、角色座標、寵物、礦洞狀態；`dataset.scene`、`dataset.tile`、`dataset.clip` 也會即時更新。

---

## 7. 版本歷程（簡）

| 版本 | 內容 |
|---|---|
| V0.4 | 核心六大系統、像素版骨架、Tiled 地圖、居民、礦洞、裝修 |
| V0.5 | 任務引導、釣具與湖中女神、天氣、動物成長、睡覺快轉 |
| V0.6 | 寵物系統（購買、野外捕捉、跟班、被動技能）、側邊欄 |
| V0.6.1～0.6.3 | 寵物走路動畫、UI 全部移到側邊欄、RPG 對話框、商店 Modal、世界地圖重做 |
| V0.7 | 數值系統（`stats.json`）：體力消耗、飽食衰減、餓肚子懲罰、喝水、紅色警示 |
| V0.8 | AI 動態對話（DeepSeek）：Key 只在 host、Prompt 帶入遊戲狀態、記憶、3 秒防抖、失敗用 JSON 台詞、思考中氣泡 |
| V0.9（DSH） | 對照 DSH 0.2.1-rc.5 改成實測寫法；沒有 Key 時走 DSH 的 llm 服務；client 改成 ModuleLoader 格式；窄畫面縮放修正 |
| V0.9（Claude） | 房間換成背景圖＋互動熱區（`interactables.json`，原圖像素座標）：滑鼠高亮、床睡覺、沙發坐下餵食、水族箱／書架開圖鑑、尋路或淡入淡出 |
| V0.11（Claude） | 廚房、浴室、遊戲室（`leisure.json`、`interactables.json`）：泡澡、玩遊戲、掛機自己去遊戲室、門口選目的地；新的 host 動作 `bath`、`play`、`stop_play` |
| V0.19（Claude） | `weather.json` 多了天氣 `snowy`（冬天只有晴天、雪天；雪天 wet 但不算 rainy）；`scenes.json` 的 `ambient.weather`（天氣粒子），冬天的雪從季節粒子移過去，季節粒子下雨時不出現。好感：`gameplay.json` 每日上限 20、等級 50／150／330／500、求婚 500；`character.json` 解鎖台詞、`fishing.json` 的河豚門檻跟著調。沒有新的 host 動作、存檔欄位 |
| V0.20（Claude） | **改名**：套件／插件 `dsh-whale-pet` → `dsh-whale-valley`（遊戲名「鯨魚谷物語」）。`cordis.patch.yml` 的 id／name、`src/host/index.ts` 的 `name`、API 路徑 `/api/dsh-whale-valley`、client 的 `name` 都換了；**你那邊的 profile 要先 remove 舊插件再 add 新的**。存檔資料夾預設 `~/.dsh/storages/dsh-whale-valley`，舊的 `dsh-whale-pet` 還在、新的還沒建立就沿用舊的（`src/host/storage-dir.ts`）。`lib/` 改成要提交（`add github:long432120-blip/dsh-whale-valley` 不用建置）；`assets/source/` 不提交。遊戲室、酒館背景圖遮掉版權疑慮圖案，問號箱改玩具箱。**AI**：`WhaleAi`／`ChatMemory` 搬到 `src/shared/ai-service.ts`、`chatCompletion` 搬到 `src/shared/ai-fetch.ts`（`host/ai.ts`、`host/ai-client.ts` 保留 re-export，host 行為不變）；`ai.json` 的 `historyTurns` 6→3、`maxTokens` 120→100（DSH 版也跟著變）。單機版新增玩家自己填 Key（`src/client/ai-browser.ts`、🔑 設定），DSH 版不會出現這個按鈕（DshBridge 沒有 `aiSettings`）。沒有新的 host 動作、存檔欄位 |
| V0.21（Claude） | 開源前審查，**沒有新的 host 動作或存檔欄位**。`normalizeGame` 讀檔時：揹包只留認得的物品、取整數、金幣上限 99,999,999、其他 9,999；好感上限 99,999；`clockOffset` 上限 10 年（`MAX_*` 常數在 `gameplay.ts`）。`seasonAt()` 遇到非有限數字回傳 null。`HostBridge` 新增選用的 `takeNotice()`（DSH 版不用實作）。`package.json`：0.21.0、`engines.node >=22`、peerDependencies 標 optional。新增 `npm run check:secrets`。README 重寫、開發說明搬到 `docs/開發文件.md`、發布步驟在 `docs/發布到GitHub.md` |
| V0.22（Claude） | **新的 host 動作**（都在 `src/shared/social-rules.ts`，`run()` 開頭用 `isSocialAction` 分派）：`set_nick`、`market_buy`、`stall_list`、`stall_cancel`、`trade_buy`、`trade_receipt`、`pet_adopt_out`、`pet_adopt_in`、`visit_snapshot`、`visit_reply`、`mail_read`；新的 `ActError`：`own_code`、`not_yours`、`bad_price`、`visitor`。**存檔新欄位**：`trade`（玩家 id、暱稱、攤位、兌換紀錄、領養冷卻、市集買過的）、`mailbox`；舊存檔 `normalizeGame` 自動補。寵物 `how` 多了 `'adopt'`。`GameView.social`。**角色包**多了 `social.json`，`GAMEPLAY_PARTS` 已加，host（`service.ts`）和瀏覽器（`bundled-pack.ts`）都有讀；salt 換掉會讓舊碼失效。**client**：`dsh-entry.tsx` 改用 `mountGame()`（`src/client/game-shell.ts`），串門時會換成 `VisitBridge`（純記憶體，不打 host），回家再換回 DshBridge；`PixelStageOptions` 多了選用的 `shell`。簡體模式 `i18n().install(document, 插件根節點, {title:false})` 只轉插件自己的區塊、不改 DSH 的標題。聊天室純前端（localStorage `whale-pet:chat`），DSH 的模型工具沒有變 |
| V0.22.1（Claude） | 依你的實機驗收報告修：**host 多一條 `GET /api/dsh-whale-valley/music/<檔名>`**（`src/host/music-route.ts`，白名單＝`music.json` 的檔名、只讀 `packs/whale-girl-pixel/music/`、支援 Range；同一個 `webServer.register` prefix handler 裡先判斷），client 在 DSH 用 `loadPixelPack(source, { musicBase: '/api/dsh-whale-valley/music/' })`。**浮層寬 640 → `min(900px, 92vw)`**，860px 以下側邊欄排到地圖下面。`package.json` 0.22.1，新的套件檔 `release/dsh-whale-valley-0.22.1.tgz`（0.22.0 的 tgz 沒動，profile 現在指著它）。⛔ 不要用本機資料夾（link）安裝 |
| V0.23（Claude） | **浮層改成啟動器**：`dsh-entry.tsx` 的 `WhalePetPanel` 只呼叫 `mountDshLauncher(el)`，放一張小卡片，不再常駐整個遊戲。模式 A「▶ 啟動遊戲」在 `<body>` 最後面加 `.whale-fs-layer`（fixed、z-index 9999、100vw×100vh，右上「❌ 關閉遊戲」），打開時暫時把 `<html>` 的 overflow 設 hidden、關閉時還原；模式 B「🪟 開新視窗玩」`window.open('/api/dsh-whale-valley/play', 'WhaleValley', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no')`。**host 新路由**（同一個 prefix handler）：`GET /play`（HTML）、`GET /play/boot.js`（模擬 `__ModuleLoader__` 的墊片）、`GET /play/client.js`（就是 `lib/client.js`），都是同網域、走 DSH 的 cookie。**`BRIDGE_METHODS` 多了** `slotList`、`slotSave`、`slotLoad`、`slotRemove`、`newGame`（slot 只收 1～3，空格／壞格回 400）。**存檔資料夾多了** `slots/slot-1..3.json` 和 `save.backup.json`（讀檔、開新遊戲前的備份）。client 多匯出 `mountDshLauncher`、`bootWindowGame`。樣式全部 inline 或 `.px-`／`.whale-` 前綴，不動 DSH 的元素。沒有任何外部資源（`npm run check:offline`）。`package.json` 0.23.0，套件檔 `release/dsh-whale-valley-0.23.0.tgz`。⛔ 一樣不要用本機資料夾（link）安裝 |
| V0.25（DSH） | **點側欄＝在獨立視窗開遊戲，DSH 完全不被遮住**。關鍵發現：DSH 桌面版（Electron）`lib/main.js` 對主視窗 `setWindowOpenHandler` 只放行 `https:` 給系統瀏覽器，其他一律 `deny`，所以 V0.23／V0.24 的「🪟 開新視窗玩」（`window.open`）在桌面版根本按不出東西。改法：新檔 `src/host/open-window.ts`（`launchGameWindow`，spawn Chrome／Edge 的 `--app=<url>`，找不到才退回系統預設瀏覽器），`src/host/index.ts` 新路由 `POST /api/dsh-whale-valley/open-window`（body `{force}`，用 `lastClientAt` 40 秒內不重開，位址取 `webServer.getOrigin()`）；client 面板改成 `mode:'window'`＋`autoOpen`，`launcher.ts` 多了 `mode`／`autoOpen`／`openWindow()`（`LauncherHandle.openWindow` 變 `Promise<boolean>`）。`/api/dsh-whale-valley/*` 不需要 DSH cookie（無 cookie GET `/play` 回 200）。**玩法、存檔、host 橋接通道都沒改**。`package.json` 0.25.0、套件檔 `release/dsh-whale-valley-0.25.0.tgz`。實機：`open-window` 回 `{mode:"app",browser:"Chrome"}`，視窗內遊戲有在呼叫通道（`alreadyOpen:true`）；點側欄只出狀態卡、DSH 無圖層；`tsc`、221 測試、`check-pixel`、`check:offline`、`check:secrets`、`build` 全過 |
| V0.24（DSH） | **改了 DSH 的進入方式**：不再用 `shell.overlay` 浮層。`src/client/dsh-entry.tsx` 的 `apply()` 改成註冊 `sidebar.panellist`（id `whale-valley`、order 30、`label` 走新 key `launch.label`）＋ `main`（key `whale-valley`）→ 左側欄多一個「鯨魚谷物語」入口，點下去中央欄是啟動卡（▶ 全螢幕／🪟 新視窗，兩種模式照舊）。新增 `WhaleIcon`（inline SVG、`currentColor`、DSH 傳 `{size, active}`）與 `WhaleValleyPanel`。`launcher.ts` 多了 `variant: 'card'｜'panel'`（預設 `card`，舊行為不變）。`locales` 新增 `launch.label`。**host、玩法、存檔、`packs/` 都沒改**。`package.json` 0.24.0、套件檔 `release/dsh-whale-valley-0.24.0.tgz`。實機驗收（desktop profile）：側欄入口→中央面板→全螢幕遊戲（gameplay／visit 200、音樂 206）→關閉後 `overflow` 還原、只剩一張啟動卡；`tsc`、221 個測試、`check-pixel`、`check:offline`、`check:secrets`、`build` 全過。⛔ 一樣用 tgz 安裝，不要用本機資料夾 |
| V0.18（Claude） | 新的玩法分檔 `wishes.json`（`service.ts` 已 import）；存檔多了 `wish`、`headpatToday`；新的 host 動作 `headpat`（列在 `NEEDS_HER`）；`setScene` 也會推進願望（走進地圖）。`leisure.json` 多了 `headpat`。`stats.json` 的飽食流逝 4 → 3。`tiled.ts`：所有圖層都空的格子擋路。季節粒子、深夜提醒只在畫面（`scenes.json` 的 `ambient`），深夜提醒用的是玩家電腦的時鐘、記在 localStorage。AI 對話的快照多了 `wish` |
| V0.17（Claude） | 像素日記：新的玩法分檔 `diary.json`（`service.ts` 已 import）；`ai.json` 多了 `diary`。存檔多了 `dayLog`、`diary`；新的 host 動作 `diary_read`；`slept` 事件多了 `diary`。**host 專屬**：`service.act` 遇到睡覺且 AI 可用時，把日記標成 pending，背景呼叫 `WhaleAi.diary()`（API Key 直連 DeepSeek，或 DSH 的 llm 服務），寫好用 `setDiaryText` 換上去；失敗留規則層拼的那篇，原因寫進 `ai-error.log`。pending 超過 2 分鐘自動失效。⚠ 請在 DSH 實機確認：背景的 `store.update` 和 `llm` 呼叫在插件 dispose 之後不會出錯（目前是 fire-and-forget，錯誤都有 catch） |
| V0.16（Claude） | 新的 host 動作：`snack`（點心桌，列在 `NEEDS_HER`）、`fridge`（冰箱每日找東西）；存檔多了 `pantryToday`，`stats.pantry` 給畫面用；資料在 `leisure.json` 的 `snacks`、`fridge`（還是同一個分檔，host 不用多 import）。熱區、地點可以寫 `seat`（坐椅子的像素位置）；`eat` 熱區可以帶 `snack`；新的熱區動作 `fridge`。畫面右上角的時間與天氣木牌：`scenes.json` 的 `hud.clock`，圖在 `assets/ui/`（已內嵌）。阿綱的酒館座位改到飛鏢靶下 |
| V0.15（Claude） | 動作可以帶自己的圖（`ClipDef.sheet`）：酒館坐著喝 `tavern_sit`、浴池游泳 `swim`；修掉魚攤（社交時間跟著老陳收）、告示牌（拿掉）、池塘睡蓮碎片。沒有新的 host 動作 |
| V0.14（Claude） | 家具目錄 `furniture_shop.json`（新的玩法分檔，host 已 import）：host 動作 `buy_furniture`、`sell_furniture`，存檔多了 `furnitureBought`；家具可以佔好幾格、地毯可以疊。背景音樂 `music.json`＋`music/*.mp3`（約 10 MB，**沒有內嵌**在 lib/client.js）。⚠ 待確認：DSH 能不能讓 client 讀到插件資料夾的 `music/`；不行的話 DSH 裡就安靜（不會壞），要嘛 host 給讀檔通道、要嘛改成內嵌（client.js 會多約 13 MB） |
| V0.13（Claude） | 酒館：小鎮新建築＋背景圖場景 `tavern`；`tavern.json`（新的玩法分檔，host 的 `service.ts` 已經 import）；新的 host 動作 `coin_flip`、`cards`；新 NPC `barkeep`；晚上 20～24 點老陳、阿綱、小葵搬到酒館；修掉不搭的舊圖、補畫的素材表。`lib/client.js` 約 5.8 MB |
| V0.12（Claude） | 16 張分類素材表（`assets/source/sheet-*.png`）全部切進遊戲：魚、家具、裝備、料理、作物、動物、寵物、礦洞怪物和圖塊、建築；新作物玉米、向日葵；礦洞新怪物蘑菇怪（岩蟹改名石頭人）；🌀 一鍵傳送（T 鍵）。`sprites.json` 多了 `monsters`、`objects`。`lib/client.js` 約 4.9 MB |
| V0.10（Claude） | 換上 GPT 素材表（`tools/import_asset_sheet.py` → `tiles-hd.webp`、`sprites.webp`、`sprites.json`）：4 倍解析度圖塊、建築、動物、作物、物品圖示；提示框不超出窄畫面。`lib/client.js` 變成約 3.3 MB |

---

## 8. 和 Claude 輪流改同一個資料夾

擁有者會讓你和 Claude 輪流改這個專案。為了不互相覆蓋：

- **開工前**先看哪些檔案最近被改過（沒有 git，就看修改時間），讀過最新版本再改。不要拿你記憶中的舊內容整檔寫回去。
- **改既有檔案用局部修改**，不要整檔重寫。`pixel-stage.ts` 很大，兩邊都會改，整檔重寫最容易蓋掉對方的東西。
- **做完在 README 或設計書寫一段「改了什麼」**，下一個接手的才知道。
- Claude 這邊同步前會先比對你改過的檔案，用三方合併保留你的修改；你這邊也請比照辦理。
