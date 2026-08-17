# 帳號自動建立器（account-creator）

在**網頁**上，用**固定座標**點每個欄位，從**文字檔**逐行讀帳號資料，
自動把「帳號 / 密碼 / 信箱」填進註冊表單。**一次填 4 組**，下次再跑會自動接續填下一批。

> 只做「自動輸入」這件事：把你原本要手動一個一個打的字，改成照座標自動點、自動填。
> 座標是固定的，所以校正後**網頁視窗不能再移動或改大小**，不然會點錯位置。

## 兩種版本，挑一種

| 版本 | 說明 | 適合 |
|------|------|------|
| **滑鼠版**（本資料夾，下方說明） | 用固定螢幕座標模擬滑鼠點擊＋打字。跑的時候會佔用你的滑鼠鍵盤。 | 任何視窗都能用，連非網頁也行 |
| **網頁版**（[`userscript/`](userscript/)，Tampermonkey 竄改猴） | 腳本跑在瀏覽器裡直接填輸入框，**不佔用滑鼠鍵盤**，你能同時做別的事。 | 就是網頁註冊、想邊做別的事 |

想「不佔用電腦」就看 **[`userscript/`](userscript/)**；以下是滑鼠版的用法。

---

## 一、安裝（第一次）

需要 Python 3。在本資料夾開命令列（或 PowerShell），執行：

```
pip install -r requirements.txt
```

---

## 二、準備帳號資料

把 `accounts.example.txt` 另存成 **`accounts.txt`**，填你自己的資料。
每行一組，欄位用 **Tab 或多個空白** 分開，順序：

```
帳號    密碼    邮箱    API链接
qqsd01  11111111  agwa6461@outlook.com  http://query.paopaodw.com/boobar?email=agwa6461@outlook.com----ukem7855
qqsd02  11111111  ztfk6673@outlook.com  http://query.paopaodw.com/boobar?email=ztfk6673@outlook.com----ctcf2759
```

- 第一行的標題（含「帳號」）會自動略過；空行、`#` 開頭的行也會略過。
- `API链接` 可留空。程式會自動從連結尾端 `----xxxx` 解析出**信箱密碼**，
  若你的表單需要填信箱密碼，見下方「進階」。

---

## 三、校正（記住欄位座標）

1. 先把**註冊網頁**開好，擺到你之後要固定的位置與大小。
2. 執行校正：雙擊 **`校正.bat`**（或 `python calibrate.py`）。
3. 依提示把滑鼠移到「帳號框 → 密碼框 → 信箱框 →（送出鈕）」上，各按一次 **Enter**。
4. 完成後會產生 `config.json`（你的座標設定）。

換了螢幕解析度、或視窗位置跑掉，就重跑一次校正。

---

## 四、執行

**強烈建議先空跑**，確認「會點哪裡、填什麼」都對（不會真的動滑鼠）：

```
python create_accounts.py --dry-run      （或雙擊 空跑.bat）
```

沒問題後正式跑，一次填 4 組：

```
python create_accounts.py                （或雙擊 執行.bat）
```

跑的時候會先倒數幾秒，請在這期間把視窗切到註冊網頁。
**按 Esc 可隨時中止**；把滑鼠猛甩到螢幕左上角也會緊急停止。

填完 4 組後再跑一次，就會**自動接著填下一批**（進度記在 `progress.json`）。

### 常用指令

| 指令 | 作用 |
|------|------|
| `python create_accounts.py --dry-run` | 空跑，只印出會做什麼，不動滑鼠鍵盤 |
| `python create_accounts.py` | 填下一批（預設 4 組） |
| `python create_accounts.py --count 2` | 這次只填 2 組 |
| `python create_accounts.py --all` | 一次把剩下的全部填完 |
| `python create_accounts.py --reset` | 清掉進度，下次從第一組重新開始 |
| `python create_accounts.py --file 帳號.txt` | 用指定的資料檔 |

---

## 五、進階設定（`config.json`）

`options` 區塊可調整行為：

| 設定 | 說明 |
|------|------|
| `batch_size` | 一次填幾組（預設 4） |
| `fill_mailbox_password` | 表單若還要填「信箱密碼」，設 `true`，並在校正時記下該欄座標 |
| `press_enter_to_submit` | 填完直接按 Enter 送出（沒有送出鈕時可用） |
| `clear_before_type` | 填字前先全選清空欄位（預設 `true`，避免殘留舊字） |
| `use_clipboard_paste` | 用剪貼簿貼上（預設 `true`，`@` 等符號不會被輸入法打錯） |

`timing` 區塊可調各種等待秒數：頁面慢就把 `after_submit`、`between_accounts` 調大。

---

## 六、注意

- 這是**固定座標**自動化：校正後別移動或縮放網頁視窗，否則會點錯地方。先 `--dry-run` 再正式跑。
- `config.json`、`accounts.txt`、`progress.json` 屬個人資料，已在 `.gitignore` 內、不會進版控。
- 每個網站的註冊規則不同（例如驗證碼、Email 驗證）：本工具只負責「自動輸入欄位」，
  遇到圖形驗證碼／簡訊驗證這類需要人判斷的步驟，請自行處理後再繼續。
