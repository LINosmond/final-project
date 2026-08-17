# 網頁版（Tampermonkey 竄改猴）

不佔用滑鼠鍵盤的做法：腳本跑在瀏覽器裡，**直接操作網頁的輸入框**，
你可以一邊做別的事，只要那個分頁開著就好。

## 和「滑鼠版」差在哪

| | 滑鼠版（`create_accounts.py`） | 網頁版（本資料夾） |
|--|--|--|
| 原理 | 用固定螢幕座標點滑鼠、模擬打字 | 直接找網頁輸入框填值（DOM） |
| 佔用滑鼠鍵盤 | 會（跑的時候不能碰電腦） | **不會** |
| 需要校正座標 | 要 | 不用（用選擇器，會自動猜） |
| 適用 | 任何視窗，連非網頁也行 | 只限網頁 |

## 安裝步驟

1. 瀏覽器裝擴充套件 **Tampermonkey**（Chrome / Edge 商店搜「Tampermonkey」）。
2. Tampermonkey 圖示 → **新增腳本** → 把 `register.user.js` 整份貼進去。
3. 改腳本開頭的 **`@match`** 為你的註冊頁網址（結尾保留 `/*`）。
4. 改 **`CONFIG.registerUrl`** 為同一個註冊頁網址（送出後自動翻頁抓下一組會用到）。
5. 把 **`ACCOUNTS`** 那段換成你的帳號資料（格式同 `accounts.txt`）。
6. 存檔 → 打開註冊頁 → 右下角出現小面板 → 按 **「自動填 4 組」**。

## 抓不到欄位時

腳本會自動猜常見的帳號／密碼／信箱欄，但有些網站命名特殊。
在該欄位上按右鍵 → **檢查**，看它的 `id` 或 `name`，填到 `CONFIG.selectors`：

```js
selectors: {
  account: "#username",
  password: "input[name='pwd']",
  email:    "input[type='email']",
  submit:   "button.register-btn",
}
```

## 運作方式

- 進度存在 Tampermonkey（跨翻頁記得），按「自動填 4 組」會填 4 組後自動停。
- 每組送出後，預設回到 `registerUrl` 抓新的空表單再填下一組（`CONFIG.afterSubmit` 可改）。
- 若送出後表單會自己清空、不換頁，把 `afterSubmit` 改成 `"none"`。
- 「重設進度」把已填清單清空，從第一組重來。

## 限制

- 圖形驗證碼、Email/簡訊驗證這類要人判斷的步驟，腳本不會做——那部分你自己完成後，
  再按面板繼續即可。
- 需要那個分頁維持開著。想「完全背景、連分頁都不用開」，就得改用 Playwright 無頭瀏覽器
  （較進階，需要 Python），需要的話再跟我說。
