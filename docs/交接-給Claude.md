> 📌 **2026-11-12 晚上新增待辦**：專案已到 V0.25（DSH 左側欄入口＋遊戲開在獨立視窗），但 **GitHub `main` 還停在 0.22.0、npm 還沒發、市場還沒上架**。
> 要做的事與逐步指令都寫在 [`交接-給Claude-上架v0.25.md`](交接-給Claude-上架v0.25.md)；程式改動摘要看 [`V0.24-設計書.md`](V0.24-設計書.md)、[`V0.25-設計書.md`](V0.25-設計書.md)。

## 回報：V0.22 實機驗收（2026-11-12 19:05–19:45）

環境：DSH **0.2.2-rc.1**（desktop runtime，`@deepseek-ai/dsh-desktop-runtime` 0.2.2-rc.1）｜Node **v24.21.0**（DSH 內建 runtime；這台機器 PATH 上沒有 node／npm／npx）｜Windows 11 家用版 10.0.26200｜安裝方式：**tgz**（`file:...\release\dsh-whale-valley-0.22.0.tgz`），profile = `desktop`。

> ⚠ 先看 [`docs/事故-20261112-專案資料夾被清空.md`](事故-20261112-專案資料夾被清空.md)：驗收一開始我用 `add <本機資料夾>`（link）安裝、後來按「移除」時，**整個專案資料夾的內容被清空**（19:06:34）。已由 Claude 從自己的完整副本補回（417 檔，含 `assets/source/`）。**這件事本身就是 P0 的結論之一**，見下面第 1 點。
>
> 驗收方式：我沒有動你開著的 Electron 視窗，而是用同一台 DSH 的**第二個瀏覽器 client**（`http://127.0.0.1:58563`）操作（同一個 profile、同一份存檔、同一套外掛）。截圖都在 `default-workspace/output/capture/`。

### P0 安裝與相容性

- **環境**：`npx @deepseek-ai/dsh --version` 跑不了（這台沒有 npm），我改用 DSH 內建的 `plugin_manager` 工具（跟 `dsh plugin` 同一套 service）讀到版本 0.2.2-rc.1。
- **移除舊插件**：✅ `remove_bundle dsh-whale-pet` 成功（舊的是 `link:C:/Users/<使用者>/Desktop/dsh-whale-pet`）。
- **安裝方式**：
  1. **本機資料夾**：✅ 安裝成功（pnpm 記成 `link:`，`whale_pet_status` 可呼叫）——但**之後 remove／改裝時把資料夾內容清空**（事故報告）。**不要再用這種方式測**；要嘛給 `file:<絕對路徑的 tgz>`，要嘛別 remove。
  2. **tgz**：✅ 成功。`dsh-whale-valley 0.22.0`，enabled、host 載入、`POST /api/dsh-whale-valley/*` 200、兩個 tool 出現在工具清單。
     （中間那次 `install_bundle <tgz>` 回 `failed to import: ENOENT ...\lib\index.js` 是假警報——當時資料夾剛被清空，`lib/` 不存在；資料夾補回後同一個 tgz 安裝是好的。）
  3. **github:**：❌ 這台沒有 `git`。pnpm 原文：
     `[ERR_PNPM_GIT_RESOLVE_FAILED] Failed to resolve git dependency "github:long432120-blip/dsh-whale-valley": git ls-remote failed: 'git' 不是內部或外部命令、可執行的程式或批次檔。`
     不是插件的問題。沒有 git 的機器可以改裝 tarball URL（pnpm 走 HTTPS）：`install_bundle https://github.com/long432120-blip/dsh-whale-valley/archive/refs/heads/main.tar.gz`。
- **`engines.dsh`：不用改，維持 `>=0.2.1-rc.5 <0.3.0`。** DSH 0.2.2-rc.1 **直接接受**，沒有警告、沒有拒絕。依據：`@deepseek-ai/dsh-app-boot` README 的 profiles 一節寫「Prereleases participate in range matching」，DSH 比對 range 時把預覽版算進去，所以 `0.2.2-rc.1` 落在 `<0.3.0` 裡面（一般 npm 語意會排除它，DSH 不會）。只有被拒時才需要改成 `<0.3.0-0`。
- **API 變動：沒有。** 你 V0.9 的實測寫法在 0.2.2-rc.1 全部照跑：
  - host：`Schemastery` 設定、`ctx.webServer.register({ kind:'prefix', path, handler })`（node:http handler）→ 路由 200；`ctx.tools.register({ name, description, parameters, output, execute })` → `whale_pet_status`／`whale_pet_act` 正常註冊（我這邊真的呼叫得到）；`llm` 服務 → AI 對話有回應。
  - client：`slots.inject('shell.overlay', …)` + `dsh.client.inject: @deepseek-ai/dsh-client-ui-layout` → 浮層有畫出來；`window.__ModuleLoader__.load({ id, factory })` 格式 → 6.7 MB 的 `lib/client.js` 載入正常。
- **型別檢查**：`tsc --noEmit -p .` → **0 錯誤**（TypeScript 5.9.3；含 `src/host/index.ts`、`src/host/service.ts`、`src/client/dsh-entry.tsx`）。
- **測試**：`node --import tsx --test test/*.test.ts` → **215 個全過、0 失敗**。

### P1 驗收清單

| # | 結果 | 證據／說明 |
|---|---|---|
| 1 | ✅（有但書） | 浮層在 DSH 視窗左上出現，房間／花園、木牌時鐘、鯨魚娘、狀態列、側邊欄都在（`output/capture/p1-02-gui.png`、`p1-03-overlay-zoom.png`）。視窗縮到 300px 時 canvas 等比縮成 276×166（92vw），不變形。**⚠ 浮層只有 200px 高**：側邊欄第二、三排按鈕（🛠️🎁📔🐾🕹️🏪📮💬⚙️）要先把側邊欄往下捲才看得到、點得到（`.px-side-inner` 是 `overflow-y:auto`）。實際 Electron 視窗裡大概也一樣。 |
| 2 | ✅ | 沿用舊存檔：`~/.dsh/storages/` 只有 `dsh-whale-pet`（新名字 `dsh-whale-valley` 不存在），`storage-dir.ts` 的邏輯照走。舊存檔讀進來後 `save.json` 2207→2364 bytes，`normalizeGame` 自動補了 `trade`、`mailbox`（V0.22 新欄位）。 |
| 3 | ⚠ 部分 | 點她說話 ✅（走 AI，回「咕嚕……主人初次見面，我餓到」）；點地面她會走過去 ✅（`__pxDebug()` 的 tile 8,7→9,7）。**連點三下摸頭 ❌ 沒觸發**：她會自己走動，我三次點擊很難都落在她身上，打到旁邊就變成走路（`stage.dataset.headpat` 一直沒有值）——不確定是自動化打不準，還是浮層的點擊被別的東西吃掉，**建議人手在 Electron 視窗試一次**。種田／澆水／釣魚沒測（舊存檔金幣 0、飽食 0、田裡沒東西）。 |
| 4 | ✅ | `whale_pet_status` 只讀、回傳狀態摘要；`whale_pet_act`（water, `garden/plot-1`）回「沒有成功（plot_empty）」＝有走白名單、被規則層擋下。兩者都只能餵食／澆水／收成，沒有其他動作。 |
| 5 | ✅ | 沒設 Key（`ai.apiKey` 留空），點她 → 走 DSH 的 `llm` 服務，有回話；`storages/dsh-whale-pet/ai-memory.json` 有記錄；**沒有** `ai-error.log`。 |
| 6 | ❌ 未測 | 要在晚上讓她上床睡著、再立刻停用插件／關 DSH。我沒有在真實 Electron 視窗操作，怕中斷你正在跑的 session，這項留給你或下一輪。 |
| 7 | ❌ 讀不到（只是安靜） | client 去 `GET /music/farm-day.mp3` → **404**（DSH 沒有這條路由）。檔案在 `packs/whale-girl-pixel/music/`（5 首、約 10 MB）裡，但 client 用 `/music/...` 絕對路徑抓不到。結果：**不會壞，就是沒聲音**。要修得給 host 一條讀檔通道（或內嵌，`client.js` 會多約 13 MB）。 |
| 8 | ⚠ 可用，但會整頁重載 | ⚙️設定→简体中文 → 寫 `localStorage['whale-pet:locale']='zh-CN'` → `location.reload()`。重載後**只有插件自己的區塊變簡體**（`鲸鱼娘`、`初次见面`、`生成邀请码`、`本地模拟`…，截圖 `p1-14-simplified.png`）；**DSH 自己的介面沒有被轉**（同一頁的 DSH 側邊欄字串，切換前後都是「新会话／工作区／默认工作区／上下文洞察」）。<br>關於「會不會中斷 DSH 正在跑的任務」：**host 端不會**。頁面重載期間我這個 session 的工具呼叫照樣跑完；只有瀏覽器端重載、重新連上，聊天紀錄由 DSH 自己保管。<br>補充：`document.documentElement.lang` 是 `zh-CN`，那是 DSH 自己的 index.html 帶的（插件只有在 root 是 `document.body` 時才改 lang，DSH 版不是）。 |
| 9 | ✅ | 機制正確：切到簡體後 `CanvasRenderingContext2D.prototype.fillText` **仍是原生函式**（沒有全頁被改掉），只有插件自己的 context 有覆寫（`instanceHasOwnFillText=true`）。所以只轉插件 canvas，DSH 其他 canvas 不受影響。 |
| 10 | ⚠ 部分 | ⚙️設定→🏡生成邀請碼 ✅：`POST /api/dsh-whale-valley/act` 200，彈出「共 321 個字元・30 天內有效」的邀請碼（截圖 `p1-15-invite.png`），走 host 的 `visit_snapshot`。「去朋友家→澆水→留信→回家」沒測（要第二份存檔）；剪貼簿這台沒測。 |
| 11 | ❌ 未測 | 需要金幣（舊存檔 0）＋第二份存檔才能跑「上架→買→收款」。按鈕（🏪）在，但沒有實際交易。 |
| 12 | ❌ 未測 | 需要第二份存檔。 |
| 13 | ✅ | 💬 聊天室預設「📡 本地模拟：还没连上服务器…」寫在畫面上方，沒有打 host（那段網路只有 music 404）。 |
| 14 | ✅ | DSH 網址加 `?dev` 有效：`location.search='?dev'`，DSH 照常載入（側邊欄、對話都正常），插件照常運作。`isDevMode()` 讀整頁網址的寫法在 DSH 裡成立。 |
| 15 | ⚠ 沒看到錯誤，但沒做停用／重啟測試 | 全程沒有未處理錯誤（沒有紅字、沒有 500；唯一的失敗請求是 music 404）。插件停用→重新啟用後有沒有殘留計時器／重複畫面，這輪沒測。 |

### 我改了什麼

| 檔案 | 行數 | 改了什麼 | 為什麼 |
|---|---|---|---|
| （專案原始碼） | 0 | **沒有改任何一個字** | 這輪只做驗收；發現的問題都寫在上面 |
| DSH profile `desktop` 的 `package.json` / `dsh.profile.bundles` | — | 移除舊的 `dsh-whale-pet@link:…`，改成 `dsh-whale-valley@file:...\release\dsh-whale-valley-0.22.0.tgz`，現在 **enabled** | 實機安裝與驗收 |
| `~/.dsh/profiles/desktop/.backup-whale-acceptance-20261112-190546/` | — | 動 profile 前的 `package.json`／`cordis.patch.yml`／`pnpm-lock.yaml` 備份 | 出事可以還原 |

其他副作用（不是檔案修改）：驗收過程點了她幾次（存檔 `pokes`/`ai-memory` 有動）、生成了一張邀請碼（`trade` 那張 30 天有效）、繁體／簡體切換過（最後已切回**繁體**）。

### 給擁有者的結論

**可以上架，但先把三件事處理掉／寫進說明：**

1. **🔴 最重要：不要用「本機資料夾」安裝。** 用 `link:` 裝進去、之後 remove／改裝，**會把那個資料夾的內容刪掉**（這次真的發生在你身上，見事故報告）。上架說明請寫：「請裝 `.tgz` 或 `github:`，**不要** `dsh plugin add <你的原始碼資料夾>`；要測開發版請複製一份再裝」。順便建議這個資料夾 `git init`＋本機 commit。
2. **🟡 `github:` 安裝需要 `git`。** 這台沒有，所以第三種方式沒能驗完。DSH 官方市場的使用者如果有 git 就沒問題；沒有的話要引導他們用 tarball URL。
3. **🟡 三個小問題（不擋上架，但玩家會遇到）**：
   - **背景音樂在 DSH 裡沒聲音**（`/music/*.mp3` 404）。要嘛 host 加一條唯讀路由給 `packs/.../music/`，要嘛明講「DSH 版沒音樂」。
   - **浮層只有 200px 高**，側邊欄要捲才看得到第二、三排按鈕（⚙️設定、🏪交易所、💬聊天室、🐾寵物…）。建議浮層裡的側邊欄改用「兩欄／收合」或把高度撐開。
   - **繁簡切換會整頁重載**（`location.reload()`）。host 端不會中斷，但使用者的畫面會閃一下、要重新連線；如果在意，可以改成不重載、只重建插件區塊。

**還沒驗的（需要你決定要不要我補）**：P1 第 6（夜間日記 dispose）、10 的完整串門流程、11（交易所）、12（寵物領養）——這三項都需要「第二份存檔」（另一個 profile，或單機版 `release/鯨魚谷物語-試玩版-v0.22/鯨魚谷物語.html`）跟我能自由操作的時間。

---

# 交接文件：給 Claude（來自 DSH agent）

> 回報時間：2026-11-11 13:30
> 對象：下一個接手這個資料夾的 Claude。
> 前提：**你的 V0.9（背景圖房間＋互動熱區）我全部保留，一個字都沒覆蓋。**
>
> 這份只寫「你環境跑不到的部分」的結果，以及會影響你後續修改的新事實。
> 專案擁有者用**繁體中文**溝通。

---

## 0. 一句話總結

| 項目 | 結果 |
|---|---|
| P0 完整檢查 | **全部通過**，0 個型別錯誤（`typecheck` 你跑不到的那部分） |
| P1 V0.9 房間實測 | **五項全過**，附像素級證據 |
| P2 兩個 ⚠ | **都結案** |
| 我這輪改的程式碼 | **只有 `src/host/service.ts` 的兩段註解**（共 6 行，0 行邏輯） |

沒有重構、沒有改 `pixel-stage.ts`、沒有動你的 `interactables.json`。

---

## 1. 我改了什麼（唯一改動）

檔案：`src/host/service.ts`

### 1.1 第 3 行：把「未在實機編譯」改成事實

```diff
- // ⚠ 未在 DSH 實機編譯：本專案沒有安裝 @deepseek-ai/cordis，請在你的 dev profile 裡驗證。
+ // 已在 DSH 0.2.2-rc.1 實機驗證：typecheck 通過（有裝 @deepseek-ai/cordis），插件在桌面版正常載入、服務註冊成功。
```

### 1.2 建構子：`storage` 服務的問題有答案了

```diff
- // ⚠ 先確認內建的 storage 服務有沒有提供「插件專屬目錄」；沒有才沿用魚社的慣例路徑
+ // DSH 內建的 `storage` 服務是「JSON／SQLite 的 KV 表」，不是「插件專屬目錄」，
+ // 不適合放存檔（要 mods/、.env、ai-error.log 這種真實檔案）。所以用魚社的慣例路徑，
+ // 需要的話由設定裡的 storageDir 覆寫。
  this.dir = config.storageDir || join(homedir(), '.dsh', 'storages', 'dsh-whale-pet');
```

**依據**：`dsh-vector-store` 的原始碼註解（`~/.dsh/profiles/desktop/node_modules/dsh-vector-store/index.js` 第 8 行）寫著：

> 現成的知識庫插件都走 `ctx.storage` 域，那是 JSON 或 SQLite 的 KV 表，存不了向量索引

所以 `ctx.storage` 是 KV 表，不是目錄。**沿用 `~/.dsh/storages/dsh-whale-pet/` 是對的**，`storageDir` 覆寫機制照舊。

---

## 2. P0 結果（你跑不到的部分）

| 指令 | 結果 |
|---|---|
| `tsc --noEmit` | **EXIT=0**，0 個型別錯誤 |
| `node --import tsx --test test/*.test.ts` | **121 / 121 全過**（含你的 7 個 `hotspots.test.ts`） |
| `tsx scripts/check-pixel.ts` | 通過：8 張地圖（1 張背景圖場景、11 個互動熱區）、59 句台詞、119 種物品、6 種作物、5 種寵物 |
| `build:host` | `lib/index.js` 201,808 B |
| `build:client` | `lib/client.js` **2,461,252 B**（2,461 KB） |
| `demo:standalone` | `demo/pixel-standalone.html` 2,257 KB |

**結論：你的 V0.9 沒有任何型別錯誤要修。** 我一個字都沒改。

---

## 3. P1：V0.9 房間實測（五項全過）

**怎麼測的**：不是看截圖猜。開本機靜態伺服器載入 `demo/pixel-standalone.html`，用真實 CDP 滑鼠事件（`mouseMoved` / `mousePressed` / `mouseReleased`）操作，再讀 canvas 像素、`getComputedStyle`、DOM 狀態與 `.px-stage.__pxDebug()` 做判斷。

### 3.1 背景圖有出來 ✅

- canvas 內部 **960×576**（不是 320×192，是高解析畫布）
- 全畫面取樣 **1458 種顏色**，`uniform: false` → 確定是有細節的圖，不是黑畫面
- 地圖是 **15×12**（背景圖模式），左右各留 40 邏輯 px 黑邊（原圖 1.25:1）

### 3.2 滑鼠移上去：小手＋發光＋提示 ✅

移到床（頁面座標 302, 283）：

| 檢查 | 結果 |
|---|---|
| 游標 | `canvas.style.cursor === "pointer"` |
| 提示文字 | `.px-tip.show` → 「🛏️ 貝殼床：睡到明天早上（體力補滿）」 |
| 提示位置 | `(166.7, 155.4, 270×28.6)`，在床的上方 |

**發光框我做了像素級驗證**（移開截一張 → 移回截一張 → 比對）：

- 差異區塊 `r1` = 文件座標 **(231, 190, 142×195)**，面積 4321
- `interactables.json` 的床熱區換算後 = **(231.3–372.6, 189.7–377.1)**
- **兩者吻合** → 高亮框確實畫在熱區上，不是偏移或畫錯位置

`compare` 工具回 `verdict: FAIL`（`diffPixels 4362`、`diffRatio 0.1363`）—— 那是回歸工具的語意「兩張圖差很多」。在這裡「有差異」正是我要的結果，不是缺陷。

### 3.3 點家具 ✅

| 點什麼 | 結果 |
|---|---|
| 貝殼床 | 她從格子 (7,8) 走到 **(5,8)**（床邊站位），跳出「🛏️ 睡覺 / 要睡到明天早上 6 點嗎？」 |
| 沙發几 | `dataset.clip === "sit"`（**真的坐下**）＋揹包打開且「吃的」分頁是**選中狀態**（`px-tab on`）；空揹包正確顯示「沒有能吃的東西：去釣魚或收成吧！」 |
| 關揹包 | `clip` 變回空 → **她起身**，符合你設計書的「介面關掉才起身」 |
| 水族箱 | 「📖 魚類圖鑑 / 已發現 0 / 21 種」 |
| 門口 | `dataset.scene` 從 `room` 變 **`garden`**，地圖變 **20×12**（Tiled 圖），台詞「外面的空氣好好～」 |
| 閣樓爬梯（未解鎖） | 「🏠 房屋擴建 / 需要 🪙 金幣 ×3000（有 0）」，按鈕變灰寫「金幣不足」 |
| 世界地圖 | 「🔒 閣樓要先解鎖「房屋擴建」」正確顯示 |

### 3.4 窄畫面（比 320px 窄）✅

視窗設成 **280×800**：

| 檢查 | 結果 |
|---|---|
| canvas CSS 尺寸 | 960×576 → **269 × 161.39** |
| 寬高比 | **1.6668**（≈5/3，沒有被壓扁） |
| 內部解析度 | 仍是 320×192（沒被破壞） |
| 水平溢出 | `scrollWidth === 280`，**沒有**跑出橫向捲軸 |
| 點擊準確度 | hover `(83.48, 93.4)` 準確命中床；點下去也正常開睡覺視窗 |

→ **`resize()` 的等比縮小修正成立**，`getBoundingClientRect` 的點擊換算在縮小後仍正確。

### 3.5 點她說話 ✅

`Enter` 觸發（頁面本身有「按 Enter 和她說話」的互動）：

- `.px-dialog` class = `px-dialog top show done` → **確實顯示**
- 文字：「房間好溫暖，想睡午覺了…」
- `.px-dialog.thinking` **沒有**出現 → **沒有卡在「思考中」**
- demo 環境沒有 AI，走 JSON 台詞，符合預期

---

## 4. 你要知道的三個新事實

### 4.1 ⚠ DSH 0.2.2 起，**所有 web 路由都要認證**

```
GET http://127.0.0.1:<port>/  →
401  "dsh web authentication required; reopen the URL printed by dsh web."
```

連插件自己的路由 `POST /api/dsh-whale-pet/chat` 也是 **401**。上一輪（0.2.1-rc.5）不需要 token，**這是版本差異**。

**結論：不用改程式。** `fetchTransport` 用相對路徑 `/api/dsh-whale-pet/...` + 預設 fetch，同源會自動帶 cookie；DSH 自己的前端也是相對路徑，所以驗證一定是 cookie 機制。

**但你要知道**：從外部（例如 curl、另一個 agent）打不到這個 API 了，只能用瀏覽器實測。

### 4.2 `lib/` 可能比 `src/` 舊 —— 改完 client 一定要重建

我接手時 `lib/client.js` 是 **08:32** 的產物，你的 V0.9 是 **11:59** —— 也就是說那個 bundle **根本沒有背景圖房間**，DSH 上跑的是舊的圖塊房間。

改完 `src/client/**` 或 `packs/**` 後**一定要**：

```bash
npm run build
```

不然 DSH 載到的是舊畫面，而且不會有任何錯誤訊息（很容易誤判成「熱區壞了」）。

### 4.3 grep `lib/client.js` 找中文會找不到（我踩過）

esbuild 把中文全部轉成 `\uXXXX`，而且是**大寫十六進位**：

```
name: "\u8C9D\u6BBC\u5E8A"        // 貝殼床
```

所以要確認某段中文有沒有打進 bundle，**不能用** `s.includes('貝殼床')`，也**不能用小寫** `\u8c9d`。要這樣比：

```js
const esc = (str) => [...str].map(c => '\\u' + c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')).join('');
s.includes(esc('貝殼床'))   // true
```

我已經確認 V0.9 完整打進去了：`interactables_default` 整個物件、11 個熱區、`imageSize 1402×1122`、`actorScale 0.8`、`assets/rooms/whale-room.webp` 都在。

---

## 5. 待修清單（給你，我沒動）

### 5.1 窄畫面時提示框會溢出畫面左邊（真缺陷，小）

視窗 280px 寬時，hover 床：

| 值 | 數字 |
|---|---|
| 提示框寬度 | 213.23 px |
| 置中於 | x = 83.48 |
| 算出左邊界 | **-23.15 px** ← 超出畫面 |

→ 文字開頭會被切掉約 23px（「🛏️ 貝殼床…」的前面看不見）。

**我沒有修**，原因：交接文件第 8 節說你也在改 `pixel-stage.ts`，而且這不屬於「只修錯誤」的範圍。修法是把提示框的 `left` clamp 在 `[tipWidth/2, stageWidth - tipWidth/2]` 之間（或 CSS 用 `max(...)` / `clamp()`）。**要不要修請先問擁有者。**

### 5.2 擁有者還沒確認的事（不是你的問題）

- **DSH 實機的 V0.9 畫面還沒驗證**：DSH 是 13:16 重啟的，我 13:17 才建好新 client，所以那時跑的是舊房間。已請擁有者重新整理視窗。
- `~/.dsh/storages/dsh-whale-pet/save.json` 停在 **10:34**，13:16 重啟後沒再寫入 → 浮層應該還沒被掛載（掛載就會 `visit()` 寫存檔）。
- **AI 對話還沒在實機確認**（因為 401 打不到 API）。`ai-error.log` 目前不存在。

### 5.3 版號問題還是開著的

`package.json` 仍是 `0.9.0`，我沒動。交接文件說「下一版用什麼版號請先問擁有者」——**這件事還沒問**。

---

## 6. 請你不要做的事

1. **不要手改 `lib/`** —— 那是 `npm run build` 的產物。
2. **不要為了 5.1 那個提示框，大改 `pixel-stage.ts`** —— 幾行定位就好，那個檔案兩邊都在動。
3. **不要把 `lib/client.js` 改回 ESM** —— 必須維持 `window.__ModuleLoader__.load({ id, factory(require) {...} })` 格式，`require("react")` 在 factory 裡面。DSH 的瀏覽器端不是 ESM，改回去會直接 `Cannot use import statement outside a module`。
4. **不要讓 API Key 進前端** —— `src/client/**`、`src/shared/**`、`lib/client.js`、`demo/*.html` 都不行。`test/ai.test.ts` 最後一個測試會掃。

---

## 7. 我這邊的環境與指令（你環境可能不同）

```powershell
$env:PATH = "$env:USERPROFILE\Desktop\AI\resources\runtime\primary-runtime\dependencies\node\bin;" + $env:PATH
Set-Location "$env:USERPROFILE\Desktop\dsh-whale-pet"

& node_modules\.bin\tsc.CMD --noEmit                      # typecheck
& node --import tsx --test test/*.test.ts                 # 121 個測試
& node_modules\.bin\tsx.CMD scripts/check-pixel.ts        # 角色包檢查
& node_modules\.bin\esbuild.CMD src/host/index.ts --bundle --platform=node --format=esm --target=node22 --packages=external --outfile=lib/index.js
& node_modules\.bin\tsx.CMD scripts/build-client.ts       # client（ModuleLoader 格式）
& node_modules\.bin\tsx.CMD scripts/build-standalone.ts   # 雙擊版 demo
```

- 這台機器**沒有** `npm` / `pnpm` 在 PATH 上，要用上面那個 node bin 目錄。
- `@deepseek-ai/*` 只有 `cordis` 和 `schemastery` 兩個裝在專案裡，`@deepseek-ai/dsh-client-ui-layout` **沒裝**（它只是 `dsh.client.inject` 的字串宣告，不需要真的存在）。

---

## 8. 附：這一輪的驗證證據

| 證據 | 值 |
|---|---|
| 房間截圖 | `output/whalepet/v09-room.png`（1280×800，702 KB） |
| 發光框差異圖 | `output/whalepet/v09-hover-diff.png`（160×200，紅=差異） |
| 背景圖顏色數 | 1458 |
| 發光框差異區塊 | `(231, 190, 142×195)`，面積 4321 |
| 床熱區換算 | `(231.3–372.6, 189.7–377.1)` |
| 窄畫面 canvas | 269 × 161.39，比例 1.6668 |
| 提示框左邊界（280px） | -23.15 |
| 測試 | 121 pass / 0 fail |

（截圖在 DSH 的工作區，不在這個資料夾；需要的話請擁有者提供。）
