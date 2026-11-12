# 發布到 GitHub（給作者）

倉庫：<https://github.com/long432120-blip/dsh-whale-valley>
以下指令都在 **Windows PowerShell** 裡跑；專案資料夾是桌面的 `dsh-whale-pet`（資料夾名字跟倉庫不一樣沒關係）。

## 0. 先準備（只要做一次）

1. 安裝 [Git for Windows](https://git-scm.com/download/win)（裝的時候預設選項就好，它會一起裝「Git Credential Manager」，第一次推送會跳出瀏覽器讓你登入 GitHub；沒有跳出來的話看第 2 節的「Personal Access Token」）
2. 到 GitHub →「Settings」→「Emails」：
   - 勾「**Keep my email addresses private**」
   - 勾「**Block command line pushes that expose my email**」
   - 記下上面那行 `…@users.noreply.github.com` 的信箱（通常長得像 `12345678+long432120-blip@users.noreply.github.com`），下面會用到。這樣提交紀錄不會露出你的真實 email。

## 1. 發布前檢查

```powershell
cd "$env:USERPROFILE\Desktop\dsh-whale-pet"

npm test                          # 全部要 pass
npx tsx scripts/check-pixel.ts    # 角色包檢查
npm run build                     # 重新編譯 lib/（lib/ 會一起提交）
npm run check:secrets             # 要看到「✅ 沒有找到 API Key…」
```

`check:secrets` 有列出東西就**先不要推**，把那幾行處理掉再跑一次。

## 2. 第一次推送

```powershell
git init -b main
git config user.name "long432120-blip"
git config user.email "你的noreply信箱@users.noreply.github.com"

git add .
git status                        # 看一下清單（見下面「不該出現的東西」）
npm run check:secrets             # 這次只看「要提交的檔案」，再確認一次

git commit -m "鯨魚谷物語 v0.22：第一次開源"
git remote add origin https://github.com/long432120-blip/dsh-whale-valley.git
git push -u origin main
```

`git status` 裡**不該出現**：`node_modules/`、`.env`、`release/`、`packs/whale-girl-pixel/assets/source/`、`demo/pixel-standalone.html`、`demo/music/`、`*.tgz`。
有出現就是 `.gitignore` 沒生效，先停下來，不要 commit。

如果 `git push` 說遠端已經有東西（例如建 repo 時勾了 README）：

```powershell
git pull --rebase origin main
git push -u origin main
```

### `git push` 要你輸入密碼怎麼辦（Personal Access Token）

GitHub 從 2021 年 8 月起**不接受帳號密碼推送**，「Password」那一欄要填的是 **Personal Access Token（PAT）**。

- **大部分情況不用自己弄**：Git for Windows 內建的 Git Credential Manager 會跳出瀏覽器視窗，按「Sign in with your browser」登入 GitHub 就好，之後會自動記住。
- **如果終端機直接問 `Username` / `Password`**：
  1. GitHub 右上角頭像 →「Settings」→ 最下面「Developer settings」→「Personal access tokens」→「**Fine-grained tokens**」→「Generate new token」
  2. Token name：`dsh-whale-valley push`；Expiration：選 30 或 90 天（不要選永不過期）
  3. Repository access：「**Only select repositories**」→ 選 `dsh-whale-valley`
  4. Permissions → Repository permissions →「**Contents**」改成「**Read and write**」（Metadata 會自動變成 Read-only，這樣就夠了）
  5. 「Generate token」→ **馬上複製**（只會顯示這一次）
  6. 回到終端機：Username 填 `long432120-blip`，Password **貼上 Token**（貼上時畫面不會顯示任何字，是正常的，直接按 Enter）
- **Token 就是密碼**：不要貼進程式碼、`.env` 以外的檔案、聊天室或截圖；也**不要**用 `https://<token>@github.com/...` 這種把 Token 寫進網址的寫法（會留在 `.git/config` 裡）。
- 推送被拒、顯示 `403` 或 `Write access to repository not granted`：通常是 Token 沒選到這個倉庫，或 Contents 只給了 Read-only，回去改 Token 設定就好。
- 不用了就到同一頁按「Delete」作廢。

## 3. 打包 DSH 插件和試玩版

```powershell
npm run build
npm pack                          # 產生 dsh-whale-valley-0.22.1.tgz
npm run demo:standalone           # 產生 demo/pixel-standalone.html 和 demo/music/
```

試玩版的壓縮檔：把 `demo/pixel-standalone.html` 改名成 `鯨魚谷物語.html`，跟 `demo/music/`、`怎麼玩.txt` 放進
`鯨魚谷物語-試玩版-v0.22` 資料夾再壓縮。（`release/` 資料夾裡已經有做好的一份，可以直接用。）

## 4. 建立 Release（上傳 .tgz 和試玩版）

先確認手上有這兩個檔（都在 `release\` 資料夾裡）：

- `release\dsh-whale-valley-0.22.1.tgz`（DSH 插件）
- `release\鯨魚谷物語-試玩版-v0.22.zip`（免安裝試玩版）

然後在 GitHub 網頁上：

1. 打開倉庫首頁 → 右邊欄「**Releases**」→「**Create a new release**」（或「Draft a new release」）
2. 「**Choose a tag**」輸入 `v0.22.1` → 按「**Create new tag: v0.22.1 on publish**」；Target 保持 `main`
3. **Release title**：`鯨魚谷物語 v0.22.1`
4. 說明欄貼上（可以自己改）：

   ```
   第一次公開！🐋

   ## 下載
   - 🎮 只想玩：下載「鯨魚谷物語-試玩版-v0.22.zip」→ 整包解壓縮 → 雙擊「鯨魚谷物語.html」（Chrome / Edge）
   - 🧩 DSH 使用者：下載 dsh-whale-valley-0.22.1.tgz，然後
     dsh plugin --profile web add ./dsh-whale-valley-0.22.1.tgz
     或直接 dsh plugin --profile web add github:long432120-blip/dsh-whale-valley

   ## 這一版有什麼
   - 和鯨魚娘一起生活：釣魚、種田、牧場、小鎮、酒館、四季天氣、睡前日記
   - 串門（邀請碼）、交易所與擺攤、寵物領養、聊天室（目前是本地模擬）
   - 繁體／简体切換
   - AI 對話（選用，用你自己的 DeepSeek Key，只存在你的瀏覽器）

   美術素材大多是 AI 生成（ChatGPT、豆包），詳見 ASSETS.md。
   ```

5. 把上面兩個檔案**拖進**下方「Attach binaries by dropping them here」的框框，等進度條跑完（zip 約 15 MB、tgz 約 19 MB）
6. 「Set as the latest release」保持勾選；不要勾「Set as a pre-release」（想標成測試版再勾）
7. 按「**Publish release**」

發布後到 Releases 頁面確認：兩個附件都在、檔名正確，點下去能下載。GitHub 也會自動附上「Source code (zip / tar.gz)」，那是原始碼，不用管它。

## 5. 倉庫設定建議（網頁上點一點）

**About（首頁右邊的齒輪）**

- Description：`🐋 和鯨魚娘一起過日子的像素小鎮｜DeepSeek Harness 桌寵插件，也能單機開瀏覽器玩`
- Website：可以先留空（之後有試玩網頁再填）
- Topics：`dsh-plugin`、`deepseek-harness`、`pixel-art`、`virtual-pet`、`desktop-pet`、`farming-sim`、`game`、`typescript`
- 「Include in the home page」的 Releases 勾著

**Settings → General → Features**

| 功能 | 建議 | 原因 |
|---|---|---|
| Issues | ✅ 開 | 玩家回報 bug 的主要管道（README 已經指向 Issues） |
| Discussions | ✅ 開（選用） | 心得、角色包分享、提問放這裡，Issues 只留 bug 和功能建議，比較好整理 |
| Wiki | ❌ 關 | 說明都在 `docs/`，兩邊會不同步 |
| Projects | ❌ 關 | 一個人開發用不到 |
| Sponsorships | 看你 | 想收贊助才開 |

**Settings → General → Social preview**（別人在 B 站、Discord、微信貼你的倉庫網址時顯示的大圖）

- 按「Edit」→「Upload an image…」→ 選 `release\social-preview.jpg`（我做好的，1280×640、約 220 KB）
- 規格：PNG / JPG / GIF、**小於 1 MB**、至少 640×320，**1280×640 最清楚**
- 倉庫要是 **Public**，預覽圖才會被別的網站抓到

**Settings → Code security（Advanced Security）**

- **Secret scanning**、**Push protection**：打開（萬一有人推了 Key 會被擋下來）
- **Private vulnerability reporting**：打開（讓人可以私下回報安全問題）
- **Dependabot alerts**：打開

**Settings → Branches（選用）**

- 一個人開發可以先不設。之後有人送 PR 再對 `main` 加規則：「Require a pull request before merging」。

## 6. 之後每次更新

```powershell
cd "$env:USERPROFILE\Desktop\dsh-whale-pet"
npm test
npm run build                     # 改了 src/ 一定要重跑，lib/ 要跟著提交
npm run check:secrets

git status                        # 看改了哪些
git add .
git commit -m "修正：這次改了什麼"
git push

# 要發新版本時（例如 v0.23.0）：改 package.json 的 version、重新打包（第 3 步），
# 再到網頁上建 Release（同第 4 步，tag 填 v0.23.0）。也可以先在終端機建 tag：
git tag v0.23.0
git push origin v0.23.0
```

## 萬一不小心推了 Key

1. **先到 DeepSeek 後台把那把 Key 刪掉（作廢）**，再申請一把新的。這一步最重要：推上去的東西就算刪掉，歷史紀錄裡還在，別人可能已經抓走了。
2. 把檔案裡的 Key 拿掉、`git commit`、`git push`。
3. 想連歷史紀錄都清乾淨，再參考 GitHub 的「Removing sensitive data from a repository」說明。
