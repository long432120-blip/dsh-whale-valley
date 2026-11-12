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
