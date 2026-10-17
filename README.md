# Little Fighter 2 網頁連線版

用瀏覽器玩**原版** LF2：原版角色、招式、背景和音效。支援最多 4 人（加上電腦最多 8 個角色）連線，由伺服器同步，另外有**闖關模式**（Stage 1-1 到 5-5）。

## 怎麼同步的

```
玩家A ─┐                          ┌─> 玩家A
玩家B ─┤ 只送按鍵 →  伺服器       ┤ 每秒 30 次送出畫面變化
玩家C ─┤        （F.LF 引擎在這裡跑  ├─> 玩家B …
玩家D ─┘          全部遊戲邏輯）    └─> 玩家D
```

- 伺服器跑完整的 LF2 遊戲邏輯（[F.LF](https://github.com/Project-F/F.LF) 引擎，照原版規則重寫的開源版本）
- 瀏覽器只送按鍵，並用 F.LF 自己的畫圖程式把伺服器送來的畫面畫出來
- 所有人看到的畫面都以伺服器為準，不會不同步，也不是 P2P

## 啟動

需要 Node.js 18 以上。

```bash
npm install
npm start               # 預設 port 3000，可用 PORT=8080 npm start 改
```

打開 http://localhost:3000 ，輸入暱稱進入房間，按「複製邀請連結」傳給朋友。

### 讓朋友連進來（選一種）

1. **同一個 Wi-Fi**：朋友打開 `http://你的區網IP:3000`。
2. **Cloudflare Tunnel**（免費、不用設路由器）：執行 `cloudflared tunnel --url http://localhost:3000`，把它給的 `https://….trycloudflare.com` 網址傳給朋友。
3. **路由器開 port 3000** 或部署到支援 WebSocket 的 Node 主機（Render、Railway、Fly.io…）。

伺服器離大家越近越好；全部人都在台灣的話，放在自己家裡就很順。

## 模式

- **對戰模式**：選角色、隊伍（同隊不互打）和場地，可以加電腦並選 AI。
- **闖關模式**：所有玩家同一隊，從選定的關卡一路打到 5-5。
  - 關卡內容（每一波出哪些敵人、幾隻、boss、士兵）來自原版 `stage.dat`
  - 敵人數量會依照玩家人數增加，跟原版一樣
  - 清完一波會出現「GO →」，鏡頭和可走範圍往右推進
  - 血量會帶到下一關；在上一關倒下的玩家會以 200 HP 復活
  - 全部玩家倒下就是 Game Over

## 角色

| 來源 | 角色 |
|---|---|
| F.LF 原本就有 | Davis、Dennis、Woody、Firen、Freeze、Louis、Rudolf、Henry、John、Deep、Bandit |
| 從原版資料轉入 | Julian、Firzen、Louis EX、Bat、Justin、Knight、Jan、Monk、Sorcerer、Jack、Mark、Hunter |

## 操作

| 動作 | 按鍵 |
|---|---|
| 移動 | WASD 或方向鍵 |
| 攻擊 / 跳 / 防禦 | J K L，或 Z X C |
| 跑步 | 連按兩下 ← 或 → |
| 招式 | 跟原版一樣，例如 防→攻（D>A）、防↑跳（D^J） |

## 從自己的 LF2 重新匯入資料

`packs/LF2_19` 裡已經放好轉換後的資料。如果想用自己電腦上的 LF2（例如換成別的版本或 mod），可以重新匯入：

```bash
npm run import-lf2 -- "C:\Games\LF2"     # 資料夾裡要有 data\ 和 sprite\
```

它會解密 `.dat`、把 `.bmp` 轉成 `.png`，並產生 `packs/LF2_19/extra.json`（新增的角色和物品）和 `stage.json`（關卡）。

## 目前的限制

- 只有角色、武器和招式球；**牛奶和啤酒只能撿起來丟，不能喝**；關卡裡的囚犯（criminal）沒有實作。
- 沒有生存模式（Survival）：找到的 stage.dat 裡的生存關是別人改過的版本，不是原版。
- 原版背景音樂沒有放進來（只有音效）。
- 新匯入的角色有少數動作在 F.LF 引擎裡可能和原版不完全一樣。
- 你的角色要等按鍵送到伺服器再回來才會動：延遲 50 ms 內幾乎感覺不到，太遠會覺得卡。

## 專案結構

- `server/index.js`：HTTP 和 WebSocket 伺服器、房間、30 FPS 遊戲迴圈
- `server/engine.js`：在 Node 裡載入 F.LF 引擎（瀏覽器專用的部分換成 stub）
- `server/netsprite.js`：伺服器版的 sprite，記錄畫面變化送給玩家
- `server/runner.js`：跑一場對戰
- `server/stage.js`：闖關模式（關卡、波次、boss、過關）
- `public/`：瀏覽器端（大廳、輸入、把畫面還原出來）
- `engine/`：F.LF 引擎（有少量修改，見下方）
- `packs/LF2_19/`：遊戲資料
- `tools/convert-lf2.js`：從原版 LF2 匯入資料

### 對 F.LF 引擎的修改

- `LF/background.js`、`LF/mechanics.js`：闖關模式的鏡頭跟隨和可走範圍
- `LF/character.js`：幾個在原版資料下會當掉的地方加上保護（沒有 super punch 的角色、被非角色抓住、沒有攻擊者的倒地、丟人時下一格沒有 cpoint）
- `LF/match.js`：AI 腳本出錯時不會讓整場停掉

## 授權

F.LF 引擎以 GPL-3.0 授權，本專案沿用 GPL-3.0（見 `LICENSE`）。LF2 的角色圖片、資料和音效版權屬於原作者 Marti Wong 和 Starsky Wong，請只用於個人娛樂。喜歡 LF2 的話，可以支持原作者的 [Little Fighter 2 Remastered](https://lf2.net)。
