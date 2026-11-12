# 交接：給 DSH agent（V0.22 實機驗收與上架前相容性）

> 寫給：接手這個資料夾的 DeepSeek Harness（DSH）agent。
> 來自：Claude，2026-11-12。
> 專案擁有者用**繁體中文**溝通，回報、註解、文件、遊戲內文字都用繁體中文。
> 先讀這份，再看 `docs/交接-給DSH.md` 最下面的版本表（V0.10～V0.22 每一版改了 host 的哪些東西）。

---

## 0. 一句話

你上一輪（2026-11-11 13:30，V0.9）之後，Claude 做到了 **V0.22**，而且專案已經**開源到 GitHub**。
**V0.10～V0.22 全部只在瀏覽器（單機版）測過，沒有一版在 DSH 實機跑過。**
擁有者想把插件放上 DSH 插件市場（社區的 dsh-market 會自動收錄帶 `dsh-plugin` 標籤的倉庫），**上架前需要你在真的 DSH 上裝一次、驗收一遍**。

| 項目 | 現況 |
|---|---|
| 套件名稱 | `dsh-whale-valley`（V0.20 從 `dsh-whale-pet` 改名，遊戲名「鯨魚谷物語」） |
| 版本 | `package.json` 0.22.0 |
| `engines` | `node >=22`、`dsh >=0.2.1-rc.5 <0.3.0` |
| GitHub | https://github.com/long432120-blip/dsh-whale-valley （`main`，一個 commit；`lib/` 有提交，`add github:` 不用建置；沒有 `prepare`／`postinstall`） |
| 插件套件檔 | `release/dsh-whale-valley-0.22.0.tgz` |
| 編譯產物 | `lib/index.js` 約 0.3 MB、`lib/client.js` 約 6.7 MB |
| 測試 | `npm test` 215 個全過；`check-pixel`、`build`、`check:secrets` 通過 |
| DSH 最新版 | 0.2.2-rc.1（2026-11-04）。**我們是照 0.2.1-rc.5 寫的，沒驗證過 0.2.2** |

---

## 1. 規則（請一定遵守）

1. **不要推 GitHub、不要建 Release、不要改倉庫設定。** 推送由擁有者決定（擁有者要先人工檢查）。
2. **不要手改 `lib/`**：改了原始碼就 `npm run build` 重新產生。
3. **改動越少越好**，不要重構、不要改玩法或畫面；必須改的地方，在回報裡逐一列出「檔案、行數、為什麼」。
4. **不要覆蓋 Claude 的檔案**：如果非改不可，改完在回報裡寫清楚，Claude 會用三方合併保留你的修改。
5. **不要把任何 API Key 寫進程式或文件**；測試用的 Key 不要用 `sk-` 開頭的字串（V0.22 起整個倉庫掃不到 `sk-…`，`npm run check:secrets` 會檢查）。
6. 回報寫在 `docs/交接-給Claude.md`（在最上面加新的一節，舊內容保留）。

---

## 2. 要做的事（照順序）

### P0：安裝與相容性

1. 記下環境：`npx @deepseek-ai/dsh --version`、`node -v`（DSH 0.2.2 起要求 Node 24.9 以上）。
2. 如果 profile 裡還有舊的 `dsh-whale-pet`，先移除：
   `npx @deepseek-ai/dsh plugin --profile web remove dsh-whale-pet`
3. 安裝（兩種都試，記下哪種成功、錯誤訊息原文）：
   - 套件檔：`npx @deepseek-ai/dsh plugin --profile web add ./release/dsh-whale-valley-0.22.0.tgz`
   - GitHub：`npx @deepseek-ai/dsh plugin --profile web add github:long432120-blip/dsh-whale-valley`

   > ⛔ **絕對不要用「本機資料夾」安裝（`add <專案資料夾>`，也就是 `link:`）。**
   > 2026-11-12 19:06 實測：把 link 安裝的插件 remove／改裝時，**整個專案資料夾的內容被刪光**（見 `docs/事故-20261112-專案資料夾被清空.md`）。
   > 如果 profile 裡已經有指向專案資料夾的 link 安裝，**不要 remove、不要改裝**，先停下來回報。
   > 開工前先把整個專案資料夾複製一份到別的地方。
4. **`engines.dsh` 範圍**：照 npm 的版本規則，`>=0.2.1-rc.5 <0.3.0` 很可能**不包含** `0.2.2-rc.1` 這種預覽版。請確認 DSH 實際怎麼檢查：
   - 如果因為版本被拒：改成能涵蓋 0.2.x 預覽版的寫法（例如 `>=0.2.1-rc.5 <0.3.0-0`，或 DSH 文件建議的寫法），並在回報寫明依據。
   - 如果只是警告：照樣回報警告原文。
5. **API 是否還一樣**（0.2.1-rc.5 → 0.2.2-rc.1）：你在 V0.9 改的實測寫法還能用嗎？
   - host：`src/host/index.ts` 的 Schemastery 設定、`ctx.webServer.register`、`ctx.tools.register`、`llm` 服務
   - client：`src/client/dsh-entry.tsx` 的 `slots.inject('shell.overlay', …)`、`package.json` 的 `dsh.client.inject`（`@deepseek-ai/dsh-client-ui-layout`）、`scripts/build-client.ts` 的 `window.__ModuleLoader__.load` 格式
6. **完整型別檢查**（Claude 的環境沒有 `@deepseek-ai/*`，這三個檔案一直是你負責的）：`npx tsc --noEmit -p .`，包含 `src/host/index.ts`、`src/client/dsh-entry.tsx`、`deepseek-ai` 相關型別。

### P1：實機驗收清單

每一項請寫「✅／❌／⚠」＋證據（截圖、log 或你實際看到的畫面描述）。

| # | 項目 | 怎麼測 | 預期 |
|---|---|---|---|
| 1 | 浮層出現 | 重開 `dsh web` | 她出現在 DSH 視窗的浮層；縮小視窗時等比縮放；側邊欄可以收起 |
| 2 | 存檔資料夾 | 看 `~/.dsh/storages/` | 新的是 `dsh-whale-valley`；如果只有舊的 `dsh-whale-pet`，要沿用舊存檔（`src/host/storage-dir.ts`） |
| 3 | 基本玩法 | 點她說話、連點三下摸頭、走到花園種田澆水、釣魚 | 動作都會存檔；重開 DSH 後狀態還在 |
| 4 | 模型工具 | 在 DSH 對話裡說「幫我看看鯨魚娘現在怎麼樣」「幫她澆水」 | `whale_pet_status` 只讀；`whale_pet_act` 只允許餵食、澆水、收成 |
| 5 | AI 對話 | 不設 Key，點她說話 | 走 DSH 的 `llm` 服務；失敗時改說內建台詞，原因寫進存檔資料夾的 `ai-error.log` |
| 6 | 睡前日記（V0.17 ⚠） | 晚上讓她去床上睡，然後馬上停用插件或關 DSH | 背景的 `store.update`、`llm` 呼叫在插件 dispose 之後不會丟出未處理的錯誤 |
| 7 | 背景音樂（V0.14 ⚠） | 打開音樂 | client 讀不讀得到插件資料夾的 `music/*.mp3`；讀不到的話只是安靜、不會壞（請回報是哪一種） |
| 8 | **繁簡切換（V0.22）** | ⚙️ 設定 → 简体中文 | 只有插件自己的區塊變簡體，DSH 的介面和分頁標題**不能**被轉；⚠ 切換會呼叫 `location.reload()`，在 DSH 裡等於整個 DSH 網頁重新整理，請回報這樣能不能接受、會不會中斷 DSH 正在跑的任務 |
| 9 | 畫布文字 | 簡體模式下看時間木牌、提示 | 只轉插件自己的 canvas（`i18n().patchContext(ctx)` 只包單一 context），DSH 其他 canvas 不受影響 |
| 10 | **串門（V0.22）** | ⚙️ 設定 →「🏡 生成邀請碼」→ 畫面中央彈窗 →「📋 一鍵複製」；再到「🚪 去朋友家」貼上**另一個存檔**產生的碼 →「🚀 前往朋友的農場」→ 澆水 →「✉️ 留信」→「🏠 回家」 | 生成走 host 的 `visit_snapshot`；拜訪期間換成 `VisitBridge`（純記憶體，**不打 host、不寫存檔**）；回家後 DshBridge 正常、自己的存檔沒變；剪貼簿在 DSH 頁面能用（不能用時會提示按 Ctrl+C） |
| 11 | 交易所（V0.22） | 🏪 → 今日市集買一樣；我的攤位上架（物品先扣掉）→ 複製攤位碼；用另一個存檔「買朋友的貨」→ 收款碼 → 回原存檔「收款」 | 都走 host 動作（`market_buy`、`stall_list`、`trade_buy`、`trade_receipt`）；同一張收款碼第二次顯示「已經用過了」；把碼改一個字顯示「無效」 |
| 12 | 寵物領養（V0.22） | 🐾 → 送養 → 領養碼 → 另一個存檔領養 | 寵物離開原存檔；24 小時內不能再送 |
| 13 | 聊天室（V0.22） | 💬 | 預設是「本地模擬」，畫面上方寫明；不打 host，紀錄存在 DSH 頁面的 localStorage `whale-pet:chat` |
| 14 | 開發者模式 | DSH 網址加 `?dev` | `isDevMode()` 讀的是**整個頁面**的網址；在 DSH 裡加不加得上去、會不會影響 DSH 本身，請回報 |
| 15 | 主控台 | 整個驗收過程 | 沒有未處理的錯誤；插件停用、重新啟用後不會留下計時器或重複的畫面 |

「另一個存檔」：可以用第二個 DSH profile，或用單機版 `release/鯨魚谷物語-試玩版-v0.22/鯨魚谷物語.html`（兩邊的碼互通）。

### P2：上架前

1. 確認 `add github:long432120-blip/dsh-whale-valley` 裝起來的跟 tgz 一樣能跑。
2. 看插件在 DSH 裡顯示的名稱、說明（來自 `package.json` 的 `description`、`keywords`）有沒有問題。
3. 如果你知道 DSH 官方或 dsh-market 對插件有其他要求（例如必填欄位、圖示），列出來給擁有者。

---

## 3. V0.10～V0.22 對 host 有影響的地方（快速對照）

詳細每一版在 `docs/交接-給DSH.md` 最下面的表；這裡只列你驗收時最可能碰到的：

- **玩法分檔**：`GAMEPLAY_PARTS`（`src/shared/gameplay-pack.ts`）多了 `leisure.json`、`tavern.json`、`furniture_shop.json`、`diary.json`、`wishes.json`、`social.json`；host 在 `src/host/service.ts` 讀。背景音樂的 `music.json` 只有 client 用。
- **新的 host 動作**：`bath`、`play`、`stop_play`、`coin_flip`、`cards`、`buy_furniture`、`sell_furniture`、`snack`、`fridge`、`diary_read`、`headpat`，以及 V0.22 的 `set_nick`、`market_buy`、`stall_list`、`stall_cancel`、`trade_buy`、`trade_receipt`、`pet_adopt_out`、`pet_adopt_in`、`visit_snapshot`、`visit_reply`、`mail_read`。全部走 bridge 的 `act` 方法（`routes.ts` 的 `BRIDGE_METHODS` 沒變）。
- **存檔欄位**：舊存檔讀進來由 `normalizeGame` 自動補（`trade`、`mailbox`、`wish`、`diary`…），並夾回合法範圍（金幣、好感、`clockOffset` 上限）。
- **client 入口**：`dsh-entry.tsx` 改用 `mountGame()`（`src/client/game-shell.ts`），它包住 `mountPixelStage`，負責串門切換和聊天室；簡體模式用 `i18n().install(document, 插件根節點, { title: false })`。
- **AI**：`WhaleAi`／`ChatMemory` 在 `src/shared/ai-service.ts`、`chatCompletion` 在 `src/shared/ai-fetch.ts`；`host/ai.ts`、`host/ai-client.ts` 保留 re-export，host 行為不變。
- **聊天伺服器（選用）**：`npm run chat:server`（`scripts/chat-server.ts`，不用套件），跟 DSH 無關，只是給 `connectToServer()` 用的參考實作。

---

## 4. 回報格式（寫在 `docs/交接-給Claude.md` 最上面）

```
## 回報：V0.22 實機驗收（日期、時間）

環境：DSH 版本、Node 版本、作業系統、安裝方式（資料夾／tgz／github）

### P0 安裝與相容性
- 安裝結果（三種方式各自成功或失敗，錯誤訊息原文）
- engines 範圍：DSH 怎麼檢查、有沒有改、改成什麼、依據
- API 變動：有／沒有，改了哪裡
- 型別檢查：錯誤數，錯誤原文

### P1 驗收清單
| # | 結果 | 證據／說明 |
（1～15 每一項）

### 我改了什麼
| 檔案 | 行數 | 改了什麼 | 為什麼 |

### 給擁有者的結論
能不能上架；不能的話卡在哪裡
```

謝謝！有任何不確定的地方，寫在回報裡讓 Claude 和擁有者決定，不要猜著改。
