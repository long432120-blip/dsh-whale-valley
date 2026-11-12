# 交接給 Claude：把 dsh-whale-valley 同步上 GitHub、發佈 npm、上架插件市場

> 寫於 2026-11-12 晚上（DSH agent）。擁有者要「上架」，但這台機器沒有 git／gh／npm、也沒有任何 token，所以做到「發佈前檢查」為止。
> 你接手後只要照下面三件事做，做完回報第 9 節的清單就好。
> 詳細背景與查證資料在 [`上架-插件市場.md`](上架-插件市場.md)，這份是「怎麼做」。

---

## 1. 任務一句話

**先把 GitHub 的 `main` 從 0.22.0 更新到 0.25.0 → `npm publish` → 到 `awesome-dsh-plugin` 提 PR。**
順序不能換：市場與 `github:` 安裝都看 repo，repo 還停在 0.22.0 的話，先上架只會讓大家裝到舊版。

## 2. 現在的狀態（2026-11-12 20:5x 實測）

| 項目 | 狀態 |
|---|---|
| 本機專案 `%USERPROFILE%\Desktop\dsh-whale-pet` | **0.25.0**（`package.json`），`lib/` 已重新建置，`release/dsh-whale-valley-0.25.0.tgz` 已打包 |
| GitHub `long432120-blip/dsh-whale-valley` `main` | **0.22.0**（`package.json` 與 `lib/client.js` 都是舊的，6,716,132 bytes） |
| GitHub Releases | **0 筆**（README 原本的「到 Releases 下載」已改成「目前還沒有」） |
| npm `dsh-whale-valley` | **404，名稱還空著** |
| 市場索引 `dsh-plugin-catalog/index.json` | 搜 `whale-valley`／`鯨魚` → **0 筆** |
| DSH 官方 bundle 清單（38 個） | 全是 `@deepseek-ai/*`，第三方不會出現在那裡 |
| 本機 `desktop` profile | 裝的是 `file:...release\dsh-whale-valley-0.25.0.tgz`，enabled、host + client 都載入正常 |
| 環境 | DSH **0.2.2-rc.1**（desktop runtime）｜PATH 上**沒有** `node`／`npm`／`npx`／`git`／`gh`｜Node v24.21.0 只在 DSH 內建 runtime 裡 |

## 3. 我已經做完、不要重做的

1. **V0.23 / V0.24 / V0.25 的程式改動與文件**（見第 10 節摘要）。三份設計書都在 `docs/`。
2. **發佈前檢查**：tarball 78 個檔案只有 `lib/`、`packs/`、`cordis.patch.yml`、`README.md`、`LICENSE`、`package.json`；沒有 `.env`、`node_modules`、`demo/`、`docs/`、`test/`、`packs/*/assets/source/`。`license: MIT`、`repository`／`homepage`／`bugs` 齊全、沒有 `private: true`。
3. **`pnpm publish --dry-run` 已通過**：`📦 dsh-whale-valley@0.25.0 → https://registry.npmjs.org/`、exit 0（用 DSH 內建 pnpm：`C:\Users\<使用者>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs`）。
4. **`README.md` 的 Releases 死連結已修**（改成「自己 `npm run demo:standalone`；Releases 目前還沒有」）。
5. **整理好一份可直接拖上 GitHub 的資料夾**：`C:\Users\<使用者>\Desktop\dsh-whale-valley-sync`（253 個檔案、23.4 MB；已排除 `node_modules/`、`release/`、`demo` 建置產物、`packs/*/assets/source/`、`.env`、`.git`）。

## 4. 任務 1：把 GitHub 同步到 0.25.0

### 4.1 先確認本機是新版

```powershell
cd C:\Users\<使用者>\Desktop\dsh-whale-pet
# package.json 應該是 "version": "0.25.0"
# 如果改了任何程式碼，先重新建置（lib/ 要一起提交）
#   host:  esbuild src/host/index.ts --bundle --platform=node --format=esm --target=node22 --packages=external --outfile=lib/index.js
#   client: tsx scripts/build-client.ts
#   （或 npm run build）
```

### 4.2 路線 A：有 git 的環境（乾淨、可回溯）

```powershell
cd C:\Users\<使用者>\Desktop
git clone https://github.com/long432120-blip/dsh-whale-valley.git dsh-whale-valley-repo
# 用 dsh-whale-valley-sync（或 dsh-whale-pet 排除清單）覆蓋 repo 內容
robocopy C:\Users\<使用者>\Desktop\dsh-whale-valley-sync C:\Users\<使用者>\Desktop\dsh-whale-valley-repo /E /NFL /NDL /NJH /NJS /NP
cd dsh-whale-valley-repo
git status --short        # 確認：沒有 .env、沒有 node_modules、沒有 release/、沒有 assets/source
git add -A
git commit -m "V0.25.0：DSH 左側欄入口、遊戲開在獨立視窗；V0.24 中央面板；V0.23 存檔格與啟動器"
git push origin main
```

> 這台沒有 `git`：`winget install --id Git.Git -e` 裝一次就好；或改用下面路線 B。

### 4.3 路線 B：沒有 git（用 GitHub 網頁）

1. 開 <https://github.com/long432120-blip/dsh-whale-valley> → **Add file → Upload files**
2. 把 `C:\Users\<使用者>\Desktop\dsh-whale-valley-sync` 裡的**全部內容**拖進去（253 檔、23.4 MB，含 `lib/client.js` 6.7 MB）
3. commit message 用上面那句，選 **Commit directly to the `main` branch**

### 4.4 驗證（兩個都要看）

```powershell
# 1) GitHub 上的版本
#    https://raw.githubusercontent.com/long432120-blip/dsh-whale-valley/main/package.json → "version": "0.25.0"
# 2) lib/client.js 有換（大小約 6.75 MB，跟舊的 6,716,132 bytes 不同）
#    https://api.github.com/repos/long432120-blip/dsh-whale-valley/contents/lib
```

再實際裝一次（**新開一個臨時 profile**，不要動擁有者正在用的 `desktop`）：

```powershell
dsh plugin --profile verify add github:long432120-blip/dsh-whale-valley
# 或沒有 git 的機器：dsh plugin --profile verify add https://github.com/long432120-blip/dsh-whale-valley/archive/refs/heads/main.tar.gz
```

裝完確認：`dsh --profile verify --dump-config | Select-String whale-valley`、`whale_pet_status` 可用、左側欄有「鯨魚谷物語」、點下去會開獨立視窗（V0.25 行為）。驗完把 `verify` profile 刪掉。

## 5. 任務 2：npm 發佈

前提：要用**擁有者自己的 npm 帳號**（`long432120-blip` 或他常用的那個）。沒有帳號先到 <https://www.npmjs.com/signup>。名稱 `dsh-whale-valley` 還沒有人用（已查 404）。

### 5.1 有 npm（裝了 Node.js 官方版）

```powershell
cd C:\Users\<使用者>\Desktop\dsh-whale-pet
npm login
npm pack --dry-run          # 應該只有 lib/ packs/ cordis.patch.yml README.md LICENSE package.json
npm publish --access public
```

### 5.2 只有 DSH 內建 pnpm（這台現在就是）

```powershell
cd C:\Users\<使用者>\Desktop\dsh-whale-pet
# ~/.npmrc 或專案 .npmrc（.gitignore 已忽略）放：
#   //registry.npmjs.org/:_authToken=<token>
node "C:\Users\<使用者>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" publish --access public --no-git-checks
```

Token 在 npm → Access Tokens → Generate New Token（Automation 或 Publish）。**用完刪掉 `.npmrc`。**

### 5.3 驗證

```powershell
npm view dsh-whale-valley version        # → 0.25.0
# 或直接開 https://registry.npmjs.org/dsh-whale-valley
dsh plugin --profile verify2 add dsh-whale-valley
```
> 之後每次改版：`npm version patch|minor` → `npm run build` → `npm publish`。市場索引會跟著版本走，PR 不用再提。

## 6. 任務 3：提 PR 到 `awesome-dsh-plugin`

市場（dshmarket、DSH 的 Discover、`awesome-dsh-plugin.com/index.json`）**都吃同一份清單**，所以只要提這一個 PR。

1. 開 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin> → Fork
2. 在 `README.md` 的 **Just for Fun** 分類，按字母序插入一行：

```markdown
- [long432120-blip/dsh-whale-valley](https://github.com/long432120-blip/dsh-whale-valley) - Pixel-art town life sim with a whale-girl companion inside DeepSeek Harness: fishing, farming, ranch, townsfolk, tavern, four seasons, an AI diary and mailbox/local-market social features, with no external CDN requests. A left-sidebar entry opens the game in its own window so DSH is never covered.
```

3. PR 標題：`Add dsh-whale-valley to Just for Fun`
4. PR 說明：

```
## What it is
A pixel-art farming / town-life sim (鯨魚谷物語) as a DSH plugin: fishing, farming, ranch,
NPCs, tavern, four seasons, quests, an optional AI diary (DeepSeek key, host-side only) and
local co-op through invite / stall / adoption codes. It also runs standalone in a browser.

## Why it meets the listing bar
- Declares `dsh.bundle.patch` → `cordis.patch.yml`; installs with `dsh plugin add` (npm or `github:`)
- Ships prebuilt `lib/`, so installs need no build step
- Offline-clean: `npm run check:offline` (no Google Fonts / CDN / Firebase / GA)
- No API key in the browser: host-only key, browser requests carry only `{ speaker, trigger, event id }`;
  `npm run check:secrets` scans the whole tree
- Left-sidebar entry + its own window on Windows (Chrome/Edge `--app`), so it never overlays DSH
- 221 unit tests, `tsc --noEmit` clean, `check:pixel` / `check:offline` / `check:secrets` all pass

## Try it
dsh plugin --profile web add dsh-whale-valley        # npm
dsh plugin --profile web add github:long432120-blip/dsh-whale-valley
```

5. 合併後約一天內同步到 `awesome-dsh-plugin.com/index.json`、`dshmarket.com/index.json` 與 dshmarket。
   驗證：`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json` 裡搜 `whale-valley` 應該有 1 筆。

> 想讓 **DSH 自己的 Plugins → Discover** 也搜到：`dsh plugin --profile web add @deepseek-ai/dsh-experimental-plugin-market-bundle`，然後在 Index sources 加 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`（用 jsDelivr 那份，GitHub Pages 會逾時）。

## 7. 選用：GitHub Releases（擁有者習慣每版給朋友一包）

`release/` 底下有 `鯨魚谷物語-試玩版-v0.23.zip` 等打包檔（`.gitignore` 忽略 `release/`，要另外上傳）：

```
repo → Releases → Draft a new release → tag v0.25.0
上傳 release\鯨魚谷物語-試玩版-v0.23.zip（單機版這版沒改，可以沿用 v0.23）與 release\dsh-whale-valley-0.25.0.tgz
```

再把 README 的「目前還沒有」改回 Releases 連結。

## 8. 陷阱與不要做的事

| 不要做 | 原因 |
|---|---|
| **不要用「本機資料夾」安裝插件**（`dsh plugin add <資料夾>`） | 2026-11-12 真的發生過：remove 時把整個專案資料夾清空（`docs/事故-20261112-專案資料夾被清空.md`）。用 tgz／npm／GitHub tar.gz |
| 不要把 `node_modules/`、`release/`、`.env`、`packs/*/assets/source/` 提交上去 | `.gitignore` 已經排除；`assets/source` 是 80 MB 原圖素材表 |
| 不要把 `lib/` 刪掉或當成產物忽略 | 這個專案**刻意提交 `lib/`**，讓 `github:` 安裝不用建置；`package.json` 的 `files` 也靠它 |
| 不要只發 npm 不更 GitHub | 兩邊版本會分叉，市場列的是 repo |
| 不要動 `pixel-stage.ts` 之類的大檔去「順手重構」 | 擁有者會和你輪流改同一個資料夾，用局部修改 |
| 不要把 API Key 寫進前端 | `test/ai.test.ts` 會掃原始碼；`npm run check:secrets` 也會 |
| 上架前先確認素材授權 | 上架＝公開 `packs/` 的圖；`packs/*/ASSETS.md` 是素材清單 |

## 9. 做完回報這些

1. GitHub `main` 的 `package.json` 版本（貼 raw URL 的內容片段）與 `lib/client.js` 大小
2. 臨時 profile 用 `github:` 安裝的結果（成功／失敗訊息）
3. `npm view dsh-whale-valley version` 的輸出
4. PR 連結
5. 任何你做不了或需要擁有者帳號的地方，寫清楚卡在哪一行

## 10. 附錄：V0.23～V0.25 改了什麼（寫 commit／PR 用）

**V0.23（Claude 做的，尚未上 GitHub）**
浮層改成啟動器卡片；全螢幕圖層（模式 A）與獨立視窗（模式 B）；host 新路由 `GET /play`、`/play/boot.js`、`/play/client.js`；`BRIDGE_METHODS` 多了 `slotList`/`slotSave`/`slotLoad`/`slotRemove`/`newGame`，存檔格 `slots/slot-1..3.json`；`npm run check:offline`。

**V0.24（DSH agent 做的）**
不用 `shell.overlay` 了：`src/client/dsh-entry.tsx` 改成註冊 `sidebar.panellist`（id `whale-valley`、order 30、`label` 走 `launch.label`）＋ `main`（key `whale-valley`）；新增 `WhaleIcon`（inline SVG）與 `WhaleValleyPanel`；`launcher.ts` 多了 `variant: 'card'|'panel'`；`locales` 多了 `launch.label`。

**V0.25（DSH agent 做的）**
發現 DSH 桌面版（Electron `lib/main.js`）的 `setWindowOpenHandler` 只放行 `https:`、其他一律 `deny`，所以 `window.open` 在桌面版一定被擋。改成 host 呼叫系統瀏覽器開 `--app=` 視窗：
- 新檔 `src/host/open-window.ts`（`launchGameWindow`：Chrome → Edge → 系統預設瀏覽器）
- `src/host/index.ts` 新路由 `POST /api/dsh-whale-valley/open-window`（body `{force}`；`lastClientAt` 40 秒內不重開；位址用 `webServer.getOrigin()`）
- `launcher.ts`：`mode`／`autoOpen`／`openWindow()`，`LauncherHandle.openWindow()` 變 `Promise<boolean>`
- `dsh-entry.tsx`：面板 `mode:'window'` + `autoOpen`，失敗才退回 `window.open`
- **玩法、存檔、host 橋接通道都沒改**

**驗證狀況**：`tsc --noEmit` 0 錯、單元測試 **221 全過**、`check:pixel`／`check:offline`／`check:secrets` 通過；DSH 實機（desktop profile）左側欄入口、`open-window` 回 `{mode:"app",browser:"Chrome"}`、視窗內遊戲有在呼叫 host 通道、DSH 不被遮住，全部確認過。
