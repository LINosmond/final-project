// 部署方式請見 README.md。
// 這支腳本把 Google 試算表當成後端資料庫，對應網站前端的 storage.get / storage.set / storage.delete。
//
// 【重要】打卡紀錄（punches）改為存在獨立的「Punches」分頁、一筆一列，
// 而不是塞在單一儲存格。因為 Google 試算表單一儲存格上限是 5 萬字，
// 舊做法（所有打卡塞在一格 JSON）用久了會超過上限而寫不進去、導致「打卡儲存失敗」。
// 改成一列一筆後就沒有這個限制，並會在第一次執行時自動把舊資料搬過去（不會掉資料）。
//
// 其餘資料（employees / holidays / companyLocation / otMultiplier 等）資料量小，
// 仍用 KV 工作表（key / value / updatedAt）以單格 JSON 儲存。

var SHEET_NAME = "KV";
var PUNCH_SHEET = "Punches";
var PUNCH_COLS = 6; // id, employeeId, employeeName, type, ts, actualTs

// 建議在「專案設定 -> Script Properties」新增 API_KEY，
// 前端 .env 的 VITE_SHEETS_API_KEY 要填同一組值，用來擋掉隨機掃描的請求。
// 注意：這只是基本防護，不是真正的身份驗證——任何看得到前端原始碼的人
// 都看得到這把 key，請勿把它當成保護薪資等敏感資料的唯一手段。
function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty("API_KEY") || "";
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["key", "value", "updatedAt"]);
  }
  return sheet;
}

function findRow_(sheet, key) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) return i + 1; // 換成 1-based 的列號
  }
  return -1;
}

function readValue_(sheet, key) {
  var row = findRow_(sheet, key);
  if (row === -1) return null;
  return String(sheet.getRange(row, 2).getValue());
}

function writeValue_(sheet, key, value) {
  var row = findRow_(sheet, key);
  if (row === -1) {
    sheet.appendRow([key, value, new Date().toISOString()]);
    // 把剛新增那一列的 value 欄強制設成純文字，避免 Google 試算表
    // 自動把 JSON 字串誤判成數字或日期而改變內容
    sheet.getRange(sheet.getLastRow(), 2).setNumberFormat("@");
  } else {
    var range = sheet.getRange(row, 2);
    range.setNumberFormat("@");
    range.setValue(value);
    sheet.getRange(row, 3).setValue(new Date().toISOString());
  }
}

// ===== 打卡紀錄：獨立分頁、一筆一列（無單格 5 萬字上限）=====

function getPunchSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PUNCH_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PUNCH_SHEET);
    sh.appendRow(["id", "employeeId", "employeeName", "type", "ts", "actualTs"]);
    // 整區設純文字，避免試算表把 uuid / 13 位時間戳誤判而改格式
    sh.getRange(1, 1, sh.getMaxRows(), PUNCH_COLS).setNumberFormat("@");
  }
  return sh;
}

// 讀出所有打卡紀錄（每列一筆 -> 物件陣列），格式與舊版前端相容
function readPunches_() {
  var sh = getPunchSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var data = sh.getRange(2, 1, last - 1, PUNCH_COLS).getValues();
  return punchRowsToObjects_(data);
}

function punchRowsToObjects_(data) {
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (String(row[0]) === "" && String(row[4]) === "") continue; // 跳過空列
    var obj = {
      id: String(row[0]),
      employeeId: String(row[1]),
      employeeName: String(row[2]),
      type: String(row[3]),
      ts: Number(row[4]),
    };
    if (row[5] !== "" && row[5] !== null) obj.actualTs = Number(row[5]);
    out.push(obj);
  }
  return out;
}

function punchToRow_(p) {
  return [
    String(p.id || ""),
    String(p.employeeId || ""),
    String(p.employeeName || ""),
    String(p.type || ""),
    (p.ts != null ? String(p.ts) : ""),
    (p.actualTs != null ? String(p.actualTs) : ""),
  ];
}

// 整批覆寫打卡紀錄（管理員補登、還原備份時用）：清掉舊列再重寫
function writePunches_(punches, existingSheet) {
  var sh = existingSheet || getPunchSheet_();
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, PUNCH_COLS).clearContent();
  if (punches && punches.length) {
    var rows = [];
    for (var i = 0; i < punches.length; i++) rows.push(punchToRow_(punches[i]));
    sh.getRange(2, 1, rows.length, PUNCH_COLS).setNumberFormat("@").setValues(rows);
  }
}

// 首次執行新版時，把舊的 KV「punches」單格資料搬到 Punches 分頁
// （只有 Punches 還沒任何列時做一次；舊格資料 <= 5 萬字，讀得到、可正常搬移）
function migratePunchesIfNeeded_(kvSheet) {
  var sh = getPunchSheet_();
  if (sh.getLastRow() > 1) return; // 已有列資料，不用搬
  var blob = readValue_(kvSheet, "punches");
  if (!blob || blob === "[]") return;
  var arr;
  try { arr = JSON.parse(blob); } catch (e) { return; }
  if (arr && arr.length) writePunches_(arr);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}


// ===== 身分驗證與存取控管 =====
// 管理員密碼存在「專案設定 -> Script Properties」的 ADMIN_PASSWORD（前端程式碼裡不再放密碼）。
// 沒設定時，所有管理員動作一律拒絕（fail closed）。
// 受保護資料：salary / declaration / salaryPublished 只有管理員讀得到；所有寫入（set/delete/審核）都要管理員。
// 員工讀到的員工名單會被拿掉手機號碼（手機就是登入密碼，不能外流）。
var ADMIN_ONLY_READ = { salary: true, declaration: true, salaryPublished: true };
// 洗車紀錄表（每月一個 key：carwash-YYYY-MM）同樣只有管理員讀得到
function adminOnlyKey_(k) { return !!ADMIN_ONLY_READ[k] || /^carwash-/.test(String(k)); }

function getAdminPassword_() {
  return PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD") || "";
}

// 簡單防暴力破解：同一個對象 10 分鐘內失敗 10 次就暫時鎖定
function throttleKey_(id) { return "fail:" + id; }
function throttleBlocked_(id) {
  var n = Number(CacheService.getScriptCache().get(throttleKey_(id)) || 0);
  return n >= 10;
}
function throttleFail_(id) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get(throttleKey_(id)) || 0) + 1;
  cache.put(throttleKey_(id), String(n), 600);
}

// 管理員登入成功後發一個隨機憑證（30 天有效），之後的請求只帶憑證、不帶密碼。
// 憑證驗證不受「猜錯密碼鎖定」影響，所以別人故意輸錯密碼，也無法把已登入的管理員鎖在外面。
var ADMIN_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function tokenOk_(token) {
  if (!token || !getAdminPassword_()) return false;
  var props = PropertiesService.getScriptProperties();
  var exp = Number(props.getProperty("admintok:" + token) || 0);
  if (exp > Date.now()) {
    // 使用中自動延長：剩不到 29 天就延回 30 天（每天最多寫一次），常用的管理員不會被登出
    if (exp - Date.now() < ADMIN_TOKEN_TTL_MS - 24 * 60 * 60 * 1000) {
      props.setProperty("admintok:" + token, String(Date.now() + ADMIN_TOKEN_TTL_MS));
    }
    return true;
  }
  if (exp) props.deleteProperty("admintok:" + token);
  return false;
}
function issueToken_() {
  var token = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty("admintok:" + token, String(Date.now() + ADMIN_TOKEN_TTL_MS));
  return token;
}

function adminOk_(body) {
  if (body.adminToken && tokenOk_(String(body.adminToken))) return true;
  var pw = getAdminPassword_();
  if (!pw || body.adminPassword == null || body.adminPassword === "") return false;
  if (throttleBlocked_("admin")) return false;
  if (String(body.adminPassword) === pw) return true;
  throttleFail_("admin");
  return false;
}

function stripPhones_(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].status === "archived") {
      // Retain only an identity tombstone so a saved employee session can be
      // stopped explicitly, without exposing the former employee's data.
      out.push({ id: list[i].id, status: "archived" });
      continue;
    }
    var c = {};
    for (var k in list[i]) { if (k !== "phone") c[k] = list[i][k]; }
    out.push(c);
  }
  return out;
}

// 管理員整包寫入員工名單時，若前端送來的資料缺手機號碼（例如剛登入、還沒讀到完整名單），
// 以伺服器上原本的手機號碼補回，避免把密碼清掉。
function mergePhones_(incoming, existing) {
  var byId = {};
  var included = {};
  for (var i = 0; i < existing.length; i++) byId[existing[i].id] = existing[i];
  for (var j = 0; j < incoming.length; j++) {
    included[incoming[j].id] = true;
    // A stale reorder/save must not unarchive or discard an archived account.
    // Only the dedicated restore operation may return it to active status.
    if (byId[incoming[j].id] && byId[incoming[j].id].status === "archived") {
      incoming[j] = byId[incoming[j].id];
      continue;
    }
    if ((incoming[j].phone == null || incoming[j].phone === "") && byId[incoming[j].id]) {
      incoming[j].phone = byId[incoming[j].id].phone;
    }
  }
  for (var a = 0; a < existing.length; a++) {
    if (existing[a].status === "archived" && !included[existing[a].id]) incoming.push(existing[a]);
  }
  return incoming;
}

function withoutArchivedPunches_(punches, employees) {
  var archived = {};
  for (var i = 0; i < employees.length; i++) {
    if (employees[i].status === "archived") archived[employees[i].id] = true;
  }
  return punches.filter(function(p) { return !archived[p.employeeId]; });
}

// 上班打卡：選的半點比伺服器現在時間早超過 6 分鐘就拒絕（與前端 canPickEarlierSlot 同一條規則）。
// 多給 2 分鐘緩衝，容許網路延遲與自動重試；下班不限制。
// 23:30 之後只剩 23:30 一個選項（沒有更晚的半點），維持可以打卡。
var CLOCK_IN_EARLIER_GRACE_MS = 6 * 60 * 1000;
var CLOCK_IN_SERVER_SLACK_MS = 2 * 60 * 1000;
function clockInTooLate_(entry, nowMs) {
  if (entry.type !== "in") return false;
  var ts = Number(entry.ts);
  if (!isFinite(ts)) return true;
  var diff = nowMs - ts;
  if (diff <= CLOCK_IN_EARLIER_GRACE_MS + CLOCK_IN_SERVER_SLACK_MS) return false;
  var hm = Utilities.formatDate(new Date(ts), "Asia/Taipei", "HH:mm");
  if (hm === "23:30" && diff < 30 * 60 * 1000 + CLOCK_IN_SERVER_SLACK_MS) return false;
  return true;
}

// 台北時間的「上個月」，格式 YYYY-MM
function prevMonthKey_() {
  var parts = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-M").split("-");
  var y = Number(parts[0]), m = Number(parts[1]) - 1;
  if (m < 1) { m = 12; y -= 1; }
  return y + "-" + (m < 10 ? "0" + m : m);
}


// ===== 洗車紀錄表：直接用這份 Google 試算表的分頁「洗車 YYYY-MM」填寫 =====
// 版面比照原本 Excel：A 日期、B 星期、C~Q 每位員工的洗車數量（第 2 列為姓名）、R 單日合計；
// C1 為每單位洗車獎金（預設 8）。右側 T~Z 為洗車收入：日期、班（早／晚）、80/100/180/250 台數、金額。
var CW_FIRST_EMP_COL = 3, CW_MAX_EMP = 15, CW_TOTAL_COL = 18, CW_SALES_COL = 20;
var CW_PRICES = [80, 100, 180, 250], CW_SHIFTS = ["早", "晚"];
var CW_DEFAULT_RATE = 8;
// 範本版面（複製試算表裡的「範本」分頁）：A1「M月」、C1:J1 八位員工姓名、K1「單日合計」；
// 第 3~33 列＝1~31 號（A 日期、C~J 數量、K =SUM(Cn:Jn)*單價）；第 36 列 C~J 為獎金 =SUM(..)*單價。
// 洗車收入：左塊 1~15 號在第 3~32 列、右塊 16~31 號在第 3~34 列，每天早、晚兩列。
var CW_TPL_NAME = "範本", CW_TPL_MAX_EMP = 8, CW_TPL_TOTAL_COL = 11, CW_TPL_BONUS_ROW = 36;
var CW_TPL_LEFT_COLS = [18, 20, 22, 24];   // R T V X：80/100/180/250 台數（左塊 1~15 號）
var CW_TPL_RIGHT_COLS = [33, 35, 37, 39];  // AG AI AK AM：80/100/180/250 台數（右塊 16~31 號）

function cwSheetName_(ym) { return "洗車 " + ym; }
function cwCol_(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function cwDays_(ym) { var p = ym.split("-"); return new Date(Number(p[0]), Number(p[1]), 0).getDate(); }
// 目前在職員工姓名，順序同網站「薪資」分頁：employees 陣列原順序（管理員可在帳號名冊上下移動），
// 只排除待審核（pending）與已封存（archived），與前端 isCurrentEmployee 相同；沒有姓名的略過
function cwActiveNames_(kvSheet) {
  var list = JSON.parse(readValue_(kvSheet, "employees") || "[]"), out = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].status !== "pending" && list[i].status !== "archived" && list[i].name) out.push(list[i].name);
  }
  return out;
}

// 這個分頁是不是範本版面（K1 為「單日合計」；舊版面 K1 是空的，「單日合計」在 R2）
function cwIsTemplateLayout_(sh) {
  return String(sh.getRange(1, CW_TPL_TOTAL_COL, 1, 1).getValues()[0][0] || "").trim() === "單日合計";
}
// 某日在範本收入區的位置：{ row: 早班列（晚班為下一列）, cols: 四種價格的台數欄 }
function cwTplSalesPos_(d) {
  return d <= 15 ? { row: 3 + (d - 1) * 2, cols: CW_TPL_LEFT_COLS } : { row: 3 + (d - 16) * 2, cols: CW_TPL_RIGHT_COLS };
}
// 把姓名補進空的姓名格（不動已有的），回傳放不下的姓名
function cwFillNames_(sh, row, firstCol, max, names) {
  var cur = sh.getRange(row, firstCol, 1, max).getValues()[0].map(function (v) { return String(v || "").trim(); });
  var overflow = [];
  for (var n = 0; n < names.length; n++) {
    if (cur.indexOf(names[n]) >= 0) continue;
    var slot = cur.indexOf("");
    if (slot < 0) { overflow.push(names[n]); continue; }
    cur[slot] = names[n];
    sh.getRange(row, firstCol + slot, 1, 1).setValues([[names[n]]]);
  }
  return overflow;
}
// 複製「範本」分頁成新月份：填月份、日期、姓名，單價公式改成 CW_DEFAULT_RATE，清掉該月沒有的日子
// 列印用分頁：網站管理員畫面的「列印」按鈕用。range 是要印的範圍（同原本 Excel 的列印範圍）
var PRINT_FORMS_ = {
  handwritten: { name: "手抄版", range: "A1:S38" },
  attendance: { name: "出勤表", range: "A1:J34", monthly: true }
};
function printPdfUrl_(ss, sh, range) {
  var base = ss.getUrl().replace(/\/edit.*$/, "");
  return base + "/export?format=pdf&gid=" + sh.getSheetId() + "&range=" + encodeURIComponent(range) +
    "&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED" +
    "&horizontal_alignment=CENTER&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4";
}

// 新的洗車分頁排在最後一個洗車分頁後面，不要跑到列印用分頁（手抄版、出勤表）後面；排序失敗不影響使用
function cwPlaceSheet_(ss, sh) {
  try {
    var last = 0;
    ss.getSheets().forEach(function (x) { if (x.getSheetId() !== sh.getSheetId() && /^洗車 /.test(x.getName())) last = Math.max(last, x.getIndex()); });
    if (last && sh.getIndex() !== last + 1) { ss.setActiveSheet(sh); ss.moveActiveSheet(last + 1); }
  } catch (e) { /* 排序失敗不影響使用 */ }
}

function cwCreateFromTemplate_(ss, tpl, name, y, m, days, names) {
  var sh = tpl.copyTo(ss);
  sh.setName(name);
  cwPlaceSheet_(ss, sh);
  sh.getRange(1, 1, 1, 1).setValues([[m + "月"]]);
  var head = [];
  for (var c = 0; c < CW_TPL_MAX_EMP; c++) head.push(names[c] || "");
  sh.getRange(1, CW_FIRST_EMP_COL, 1, CW_TPL_MAX_EMP).setValues([head]);
  var dates = [];
  for (var d = 1; d <= 31; d++) dates.push([d <= days ? new Date(y, m - 1, d) : ""]);
  sh.getRange(3, 1, 31, 1).setValues(dates);
  // 該月沒有的日子連星期欄（=An）也清空，不然會顯示成空日期的星期
  if (days < 31) sh.getRange(3 + days, 2, 31 - days, 1).setValues(dates.slice(days));
  // 單價公式：K3:K33 與第 36 列 C~J 的乘數換成預設單價，其他公式不動
  var lastEmp = cwCol_(CW_FIRST_EMP_COL + CW_TPL_MAX_EMP - 1), kf = [], bf = [];
  for (var r = 3; r <= 33; r++) kf.push(["=SUM(C" + r + ":" + lastEmp + r + ")*" + CW_DEFAULT_RATE]);
  sh.getRange(3, CW_TPL_TOTAL_COL, 31, 1).setFormulas(kf);
  for (var c2 = 0; c2 < CW_TPL_MAX_EMP; c2++) {
    var col = cwCol_(CW_FIRST_EMP_COL + c2);
    bf.push("=SUM(" + col + "1:" + col + "33)*" + CW_DEFAULT_RATE);
  }
  sh.getRange(CW_TPL_BONUS_ROW, CW_FIRST_EMP_COL, 1, CW_TPL_MAX_EMP).setFormulas([bf]);
  // 新月份從空白開始：清掉 1~31 號的數量與收入台數這些輸入格（範本若殘留舊資料也不會帶過來；
  // 該月沒有的日子如 2 月 29~31 號，上面已清空日期），公式保留
  var blankRow = [], blankCol = function (n) { var a = []; for (var i = 0; i < n; i++) a.push([""]); return a; };
  for (var c3 = 0; c3 < CW_TPL_MAX_EMP; c3++) blankRow.push("");
  var blanks = [];
  for (var d2 = 1; d2 <= 31; d2++) blanks.push(blankRow);
  sh.getRange(3, CW_FIRST_EMP_COL, 31, CW_TPL_MAX_EMP).setValues(blanks);
  // 收入台數欄與右邊一欄是合併格，只寫每欄左上那格
  for (var k = 0; k < CW_PRICES.length; k++) {
    sh.getRange(3, CW_TPL_LEFT_COLS[k], 30, 1).setValues(blankCol(30));
    sh.getRange(3, CW_TPL_RIGHT_COLS[k], 32, 1).setValues(blankCol(32));
  }
  return sh;
}

// 建立（或補齊）某月的洗車分頁；已存在時只把新員工補進空的姓名欄，不動已填的資料。
// 試算表有「範本」分頁就複製它；沒有就用舊的自建版面。回傳 { sheet, overflow: [姓名欄放不下的人] }
function cwEnsureSheet_(ss, kvSheet, ym) {
  var name = cwSheetName_(ym), sh = ss.getSheetByName(name);
  var days = cwDays_(ym), p = ym.split("-"), y = Number(p[0]), m = Number(p[1]);
  var all = cwActiveNames_(kvSheet);
  if (sh && cwIsTemplateLayout_(sh)) {
    return { sheet: sh, overflow: cwFillNames_(sh, 1, CW_FIRST_EMP_COL, CW_TPL_MAX_EMP, all) };
  }
  var tpl = sh ? null : ss.getSheetByName(CW_TPL_NAME);
  if (tpl) {
    return { sheet: cwCreateFromTemplate_(ss, tpl, name, y, m, days, all), overflow: all.slice(CW_TPL_MAX_EMP) };
  }
  var names = all.slice(0, CW_MAX_EMP);
  var last = 2 + days, lastEmpCol = CW_FIRST_EMP_COL + CW_MAX_EMP - 1;
  if (!sh) {
    sh = ss.insertSheet(name);
    cwPlaceSheet_(ss, sh);
    var WD = ["日", "一", "二", "三", "四", "五", "六"];
    sh.getRange(1, 1, 1, 3).setValues([[y + "年" + m + "月", "每單位", CW_DEFAULT_RATE]]);
    var head = ["日期", "星期"];
    for (var c = 0; c < CW_MAX_EMP; c++) head.push(names[c] || "");
    head.push("單日合計");
    sh.getRange(2, 1, 1, head.length).setValues([head]);
    var rows = [];
    for (var d = 1; d <= days; d++) {
      var r = 2 + d, row = [m + "/" + d, WD[new Date(y, m - 1, d).getDay()]];
      for (var c2 = 0; c2 < CW_MAX_EMP; c2++) row.push("");
      row.push("=SUM(C" + r + ":" + cwCol_(lastEmpCol) + r + ")*$C$1");
      rows.push(row);
    }
    sh.getRange(3, 1, days, head.length).setValues(rows);
    var sumRow = ["數量合計", ""], bonusRow = ["洗車獎金", ""];
    for (var c3 = 0; c3 < CW_MAX_EMP; c3++) {
      var col = cwCol_(CW_FIRST_EMP_COL + c3);
      sumRow.push("=SUM(" + col + "3:" + col + last + ")");
      bonusRow.push("=ROUND(" + col + (last + 1) + "*$C$1,0)");
    }
    sumRow.push(""); bonusRow.push("=SUM(C" + (last + 2) + ":" + cwCol_(lastEmpCol) + (last + 2) + ")");
    sh.getRange(last + 1, 1, 2, head.length).setValues([sumRow, bonusRow]);
    // 洗車收入
    var sHead = ["日期", "班"].concat(CW_PRICES).concat(["金額"]);
    sh.getRange(2, CW_SALES_COL, 1, sHead.length).setValues([sHead]);
    var sRows = [], pc = CW_SALES_COL + 2;
    for (var d2 = 1; d2 <= days; d2++) {
      for (var k = 0; k < CW_SHIFTS.length; k++) {
        var rr = 3 + (d2 - 1) * 2 + k;
        var f = "=" + CW_PRICES.map(function (pr, i) { return cwCol_(pc + i) + "$2*" + cwCol_(pc + i) + rr; }).join("+");
        sRows.push([m + "/" + d2, CW_SHIFTS[k], "", "", "", "", f]);
      }
    }
    sh.getRange(3, CW_SALES_COL, sRows.length, sHead.length).setValues(sRows);
    var endRow = 3 + sRows.length;
    sh.getRange(endRow, CW_SALES_COL, 1, sHead.length).setValues([["總計", "", "", "", "", "", "=SUM(" + cwCol_(CW_SALES_COL + 6) + "3:" + cwCol_(CW_SALES_COL + 6) + (endRow - 1) + ")"]]);
    try { sh.setFrozenRows(2); sh.setFrozenColumns(2); } catch (eFmt) { /* 格式設定失敗不影響使用 */ }
    return { sheet: sh, overflow: all.slice(CW_MAX_EMP) };
  }
  return { sheet: sh, overflow: cwFillNames_(sh, 2, CW_FIRST_EMP_COL, CW_MAX_EMP, all) };
}

// 讀某月的洗車分頁，轉成 { rate, units: { 員工ID: { 日: 數量 } }, sales: { 日: { 早: { 80: 台數 } } }, unknown: [對不到的姓名] }
function cwRead_(ss, kvSheet, ym) {
  var sh = ss.getSheetByName(cwSheetName_(ym));
  if (!sh) return null;
  var days = cwDays_(ym);
  var emps = JSON.parse(readValue_(kvSheet, "employees") || "[]"), idByName = {};
  for (var i = 0; i < emps.length; i++) if (emps[i] && emps[i].name) idByName[emps[i].name] = emps[i].id;
  if (cwIsTemplateLayout_(sh)) return cwReadTemplate_(sh, days, idByName);
  var rate = Number(sh.getRange(1, 3, 1, 1).getValues()[0][0]) || CW_DEFAULT_RATE;
  var grid = sh.getRange(2, CW_FIRST_EMP_COL, days + 1, CW_MAX_EMP).getValues();
  var units = {}, unknown = [];
  for (var c = 0; c < CW_MAX_EMP; c++) {
    var nm = String(grid[0][c] || "").trim();
    if (!nm) continue;
    var id = idByName[nm];
    if (!id) { unknown.push(nm); continue; }
    for (var d = 1; d <= days; d++) {
      var v = Number(grid[d][c]);
      if (isFinite(v) && v !== 0) { units[id] = units[id] || {}; units[id][d] = v; }
    }
  }
  var sales = {};
  var sg = sh.getRange(3, CW_SALES_COL + 1, days * 2, 1 + CW_PRICES.length).getValues();
  for (var r = 0; r < sg.length; r++) {
    var day = Math.floor(r / 2) + 1, shift = String(sg[r][0] || CW_SHIFTS[r % 2]);
    for (var k = 0; k < CW_PRICES.length; k++) {
      var cnt = Number(sg[r][1 + k]);
      if (isFinite(cnt) && cnt !== 0) {
        sales[day] = sales[day] || {}; sales[day][shift] = sales[day][shift] || {};
        sales[day][shift][CW_PRICES[k]] = cnt;
      }
    }
  }
  return { rate: rate, units: units, sales: sales, unknown: unknown };
}

// 讀範本版面：姓名在第 1 列 C~J，數量第 3 列起（1 號＝第 3 列）；單價取 K3 公式結尾的「*數字」
function cwReadTemplate_(sh, days, idByName) {
  var f = String(sh.getRange(3, CW_TPL_TOTAL_COL, 1, 1).getFormulas()[0][0] || "");
  var mm = f.match(/\*\s*(\d+(?:\.\d+)?)\s*$/);
  var rate = mm ? Number(mm[1]) : CW_DEFAULT_RATE;
  var heads = sh.getRange(1, CW_FIRST_EMP_COL, 1, CW_TPL_MAX_EMP).getValues()[0];
  var grid = sh.getRange(3, CW_FIRST_EMP_COL, days, CW_TPL_MAX_EMP).getValues();
  var units = {}, unknown = [];
  for (var c = 0; c < CW_TPL_MAX_EMP; c++) {
    var nm = String(heads[c] || "").trim();
    if (!nm) continue;
    var id = idByName[nm];
    if (!id) { unknown.push(nm); continue; }
    for (var d = 0; d < days; d++) {
      var v = Number(grid[d][c]);
      if (isFinite(v) && v !== 0) { units[id] = units[id] || {}; units[id][d + 1] = v; }
    }
  }
  // 收入：左塊（R~X，第 3~32 列）與右塊（AG~AM，第 3~34 列）各讀一次
  var span = CW_TPL_LEFT_COLS[3] - CW_TPL_LEFT_COLS[0] + 1;
  var left = sh.getRange(3, CW_TPL_LEFT_COLS[0], 30, span).getValues();
  var right = sh.getRange(3, CW_TPL_RIGHT_COLS[0], 32, span).getValues();
  var sales = {};
  for (var day = 1; day <= days; day++) {
    var pos = cwTplSalesPos_(day), blk = day <= 15 ? left : right;
    for (var s = 0; s < CW_SHIFTS.length; s++) {
      for (var k = 0; k < CW_PRICES.length; k++) {
        var cnt = Number(blk[pos.row - 3 + s][pos.cols[k] - pos.cols[0]]);
        if (isFinite(cnt) && cnt !== 0) {
          sales[day] = sales[day] || {}; sales[day][CW_SHIFTS[s]] = sales[day][CW_SHIFTS[s]] || {};
          sales[day][CW_SHIFTS[s]][CW_PRICES[k]] = cnt;
        }
      }
    }
  }
  return { rate: rate, units: units, sales: sales, unknown: unknown };
}

function processRequest_(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    var requiredKey = getApiKey();
    if (requiredKey && body.apiKey !== requiredKey) {
      return ({ ok: false, error: "unauthorized" });
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = getSheet_();
      var isAdmin = adminOk_(body);

      if (action === "getAll") {
        var allData = sheet.getDataRange().getValues();
        var map = {};
        for (var r = 1; r < allData.length; r++) {
          map[allData[r][0]] = String(allData[r][1]);
        }
        var wantKeys = body.keys || [];
        var wantsPunches = false;
        for (var wp = 0; wp < wantKeys.length; wp++) {
          if (wantKeys[wp] === "punches") { wantsPunches = true; break; }
        }
        // Read the Punches sheet once, including its header. Avoid reopening it
        // and asking for the last row separately for migration and for reading.
        var allPunches;
        if (wantsPunches) {
          var punchSheet = getPunchSheet_();
          var punchRows = punchSheet.getDataRange().getValues();
          if (punchRows.length <= 1 && map.punches && map.punches !== "[]") {
            var legacyPunches;
            try { legacyPunches = JSON.parse(map.punches); } catch (migrationError) { legacyPunches = null; }
            if (Array.isArray(legacyPunches) && legacyPunches.length) {
              writePunches_(legacyPunches, punchSheet);
              punchRows = punchSheet.getDataRange().getValues();
            }
          }
          allPunches = punchRowsToObjects_(punchRows.slice(1));
        }
        var values = {};
        for (var k = 0; k < wantKeys.length; k++) {
          var wk = wantKeys[k];
          if (wk === "punches") {
            values[wk] = JSON.stringify(isAdmin ? allPunches : withoutArchivedPunches_(allPunches, JSON.parse(map.employees || "[]")));
          } else if (adminOnlyKey_(wk) && !isAdmin) {
            values[wk] = null; // 受保護資料：非管理員一律讀不到
          } else if (wk === "employees" && !isAdmin) {
            var rawEmps = map.hasOwnProperty(wk) ? map[wk] : null;
            values[wk] = rawEmps == null ? null : JSON.stringify(stripPhones_(JSON.parse(rawEmps || "[]")));
          } else {
            values[wk] = map.hasOwnProperty(wk) ? map[wk] : null;
          }
        }
        // admin：前端帶了管理員憑證時，告知憑證是否仍有效（過期就請管理員重新登入，避免讀到空薪資卻以為正常）
        return ({ ok: true, values: values, admin: isAdmin });
      }

      if (action === "appendPunch") {
        var entry = body.entry;
        if (!entry || !entry.employeeId) return { ok: false, error: "missing employee" };
        var punchEmployees = JSON.parse(readValue_(sheet, "employees") || "[]");
        var punchEmployee = null;
        for (var pe = 0; pe < punchEmployees.length; pe++) {
          if (punchEmployees[pe].id === entry.employeeId) { punchEmployee = punchEmployees[pe]; break; }
        }
        if (!punchEmployee || punchEmployee.status === "pending" || punchEmployee.status === "archived") {
          return { ok: false, error: punchEmployee && punchEmployee.status === "archived" ? "employee archived" : "employee unavailable" };
        }
        migratePunchesIfNeeded_(sheet);
        var punches = readPunches_();
        // 依 id 去重：前端送出失敗自動重試時，若上一筆其實已寫入，不會重複附加
        var already = false;
        for (var pi = 0; pi < punches.length; pi++) {
          if (punches[pi].id === entry.id) { already = true; break; }
        }
        if (!already) {
          if (clockInTooLate_(entry, Date.now())) return { ok: false, error: "clock-in too late" };
          var psh = getPunchSheet_();
          var newRow = psh.getLastRow() + 1;
          psh.getRange(newRow, 1, 1, PUNCH_COLS).setNumberFormat("@").setValues([punchToRow_(entry)]);
          punches.push(entry);
        }
        return ({ ok: true, punches: punches });
      }

      if (action === "findOrCreateEmployee") {
        var name = body.name;
        var phone = body.phone;
        if (!name || !phone) {
          return ({ ok: false, error: "missing name or phone" });
        }
        var employees = JSON.parse(readValue_(sheet, "employees") || "[]");
        var existing = null;
        for (var i = 0; i < employees.length; i++) {
          if (employees[i].name === name) { existing = employees[i]; break; }
        }
        if (existing) {
          // 手機號碼（密碼）不對時，不回傳該員工的手機號碼，也避免被拿來猜密碼
          if (throttleBlocked_("login:" + name)) return ({ ok: false, error: "too many attempts" });
          if (String(existing.phone) !== String(phone)) {
            throttleFail_("login:" + name);
            var masked = {}; for (var mk in existing) { if (mk !== "phone") masked[mk] = existing[mk]; }
            return ({ ok: true, created: false, employee: masked, employees: stripPhones_(employees) });
          }
          if (existing.status === "archived") return { ok: false, error: "employee archived" };
          return ({ ok: true, created: false, employee: existing, employees: stripPhones_(employees) });
        }
        // 新申請的帳號預設為「待審核（pending）」，需管理員通過後才會變成 active、才能打卡並進入名冊
        var emp = { id: Utilities.getUuid(), name: name, phone: phone, status: "pending" };
        employees.push(emp);
        writeValue_(sheet, "employees", JSON.stringify(employees));
        return ({ ok: true, created: true, employee: emp, employees: stripPhones_(employees) });
      }

      // 管理員審核：approve = 通過（狀態改 active）；reject = 拒絕（從名冊移除）。
      if (action === "setEmployeeArchived") {
        if (!isAdmin) return { ok: false, error: "forbidden" };
        if (!body.id || typeof body.archived !== "boolean") return { ok: false, error: "invalid archive request" };
        var archiveEmployees = JSON.parse(readValue_(sheet, "employees") || "[]");
        var archiveTarget = null;
        for (var ai = 0; ai < archiveEmployees.length; ai++) {
          if (archiveEmployees[ai].id === body.id) { archiveTarget = archiveEmployees[ai]; break; }
        }
        if (!archiveTarget) return { ok: false, error: "employee not found" };
        if (archiveTarget.status === "pending") return { ok: false, error: "employee pending" };
        var desiredStatus = body.archived ? "archived" : "active";
        if (archiveTarget.status !== desiredStatus) {
          archiveTarget.status = desiredStatus;
          if (body.archived) archiveTarget.archivedAt = new Date().toISOString();
          else delete archiveTarget.archivedAt;
          writeValue_(sheet, "employees", JSON.stringify(archiveEmployees));
        }
        return { ok: true, employees: archiveEmployees };
      }

      if (action === "reviewEmployee") {
        if (!isAdmin) return ({ ok: false, error: "forbidden" });
        var reviewId = body.id;
        var decision = body.decision;
        if (!reviewId || (decision !== "approve" && decision !== "reject")) {
          return ({ ok: false, error: "missing id or invalid decision" });
        }
        var emps = JSON.parse(readValue_(sheet, "employees") || "[]");
        var kept = [];
        for (var j = 0; j < emps.length; j++) {
          if (emps[j].id === reviewId) {
            if (emps[j].status === "archived") return { ok: false, error: "employee archived" };
            if (decision === "approve") {
              emps[j].status = "active";
              kept.push(emps[j]);
            }
            // reject：不 push，等於從名冊移除
          } else {
            kept.push(emps[j]);
          }
        }
        writeValue_(sheet, "employees", JSON.stringify(kept));
        return ({ ok: true, employees: kept });
      }

      // 管理員登入驗證：密碼只在伺服器比對
      // 洗車紀錄表（試算表分頁）：開啟（必要時建立）與讀取，限管理員
      if (action === "openCarwashSheet" || action === "getCarwash") {
        if (!isAdmin) return ({ ok: false, error: "forbidden" });
        var cwYm = String(body.ym || "");
        if (!/^\d{4}-\d{2}$/.test(cwYm)) return ({ ok: false, error: "bad month" });
        var ssCw = SpreadsheetApp.getActiveSpreadsheet();
        if (action === "openCarwashSheet") {
          var cwRes = cwEnsureSheet_(ssCw, sheet, cwYm);
          return ({ ok: true, url: ssCw.getUrl() + "#gid=" + cwRes.sheet.getSheetId(), overflow: cwRes.overflow });
        }
        return ({ ok: true, data: cwRead_(ssCw, sheet, cwYm) });
      }

      // 列印用分頁（手抄版、出勤表）：回傳 A4 一頁寬的 PDF 下載網址，限管理員。出勤表先換成指定月份。
      if (action === "printSheetUrl") {
        if (!isAdmin) return ({ ok: false, error: "forbidden" });
        var pf = PRINT_FORMS_[String(body.which || "")];
        if (!pf) return ({ ok: false, error: "bad form" });
        var ssPr = SpreadsheetApp.getActiveSpreadsheet(), shPr = ssPr.getSheetByName(pf.name);
        if (!shPr) return ({ ok: false, error: "找不到分頁：" + pf.name });
        if (pf.monthly) {
          var prYm = String(body.ym || "");
          if (!/^\d{4}-\d{2}$/.test(prYm)) return ({ ok: false, error: "bad month" });
          shPr.getRange("A1").setValue(Number(prYm.slice(5)));
          shPr.getRange("A4").setFormula("=DATE(" + Number(prYm.slice(0, 4)) + ",A1,1)");
        }
        SpreadsheetApp.flush();
        return ({ ok: true, url: printPdfUrl_(ssPr, shPr, pf.range) });
      }

      if (action === "adminLogin") {
        if (!getAdminPassword_()) return ({ ok: false, error: "admin password not configured" });
        if (!isAdmin) return ({ ok: true, admin: false });
        return ({ ok: true, admin: true, token: body.adminToken && tokenOk_(String(body.adminToken)) ? String(body.adminToken) : issueToken_() });
      }

      if (action === "adminLogout") {
        if (body.adminToken) PropertiesService.getScriptProperties().deleteProperty("admintok:" + String(body.adminToken));
        return ({ ok: true });
      }

      // 員工查看自己上個月的薪資：身分由伺服器用「姓名＋手機號碼」驗證，完全不採信前端傳來的員工 ID；
      // 管理員關閉開關時，這裡也會擋（不是只有前端把分頁藏起來）。
      if (action === "getMySalary") {
        var gName = String(body.name || ""), gPhone = String(body.phone || "");
        if (!gName || !gPhone) return ({ ok: false, error: "unauthorized" });
        if (throttleBlocked_("login:" + gName)) return ({ ok: false, error: "too many attempts" });
        var gEmps = JSON.parse(readValue_(sheet, "employees") || "[]");
        var me = null;
        for (var gi = 0; gi < gEmps.length; gi++) {
          if (gEmps[gi].name === gName && String(gEmps[gi].phone) === gPhone) { me = gEmps[gi]; break; }
        }
        if (!me || me.status === "pending" || me.status === "archived") {
          throttleFail_("login:" + gName);
          return ({ ok: false, error: "unauthorized" });
        }
        if (readValue_(sheet, "salaryVisible") !== "true") return ({ ok: false, error: "disabled" });
        var pub = JSON.parse(readValue_(sheet, "salaryPublished") || "{}");
        var ymKey = prevMonthKey_();
        var mine = pub[ymKey] && pub[ymKey][me.id] ? pub[ymKey][me.id] : null;
        return ({ ok: true, ym: ymKey, record: mine });
      }

      // 一般 key-value 動作（get / set / delete）。punches 特別導向獨立分頁。
      var key = body.key;
      if (!key) {
        return ({ ok: false, error: "missing key" });
      }

      if (action === "get") {
        if (key === "punches") {
          migratePunchesIfNeeded_(sheet);
          var readPunches = readPunches_();
          return ({ ok: true, value: JSON.stringify(isAdmin ? readPunches : withoutArchivedPunches_(readPunches, JSON.parse(readValue_(sheet, "employees") || "[]"))) });
        }
        if (adminOnlyKey_(key) && !isAdmin) return ({ ok: true, value: null });
        var v = readValue_(sheet, key);
        if (key === "employees" && !isAdmin && v != null) v = JSON.stringify(stripPhones_(JSON.parse(v || "[]")));
        return ({ ok: true, value: v });
      }

      if ((action === "set" || action === "delete") && !isAdmin) {
        return ({ ok: false, error: "forbidden" });
      }

      if (action === "set") {
        if (key === "employees") {
          var incoming; try { incoming = JSON.parse(body.value || "[]"); } catch (e3) { incoming = []; }
          var oldEmps = JSON.parse(readValue_(sheet, "employees") || "[]");
          writeValue_(sheet, key, JSON.stringify(mergePhones_(incoming, oldEmps)));
          return ({ ok: true });
        }
        if (key === "punches") {
          var arr;
          try { arr = JSON.parse(body.value || "[]"); } catch (e2) { arr = []; }
          writePunches_(arr);
          return ({ ok: true });
        }
        writeValue_(sheet, key, body.value);
        return ({ ok: true });
      }

      if (action === "delete") {
        if (key === "punches") {
          writePunches_([]);
          return ({ ok: true });
        }
        var row = findRow_(sheet, key);
        if (row !== -1) sheet.deleteRow(row);
        return ({ ok: true });
      }

      return ({ ok: false, error: "unknown action: " + action });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return ({ ok: false, error: String(err) });
  }
}

// 先結束資料交易、釋放鎖，再產生 HTTP 回應，避免傳輸阻塞其他使用者。
function doPost(e) {
  return jsonResponse_(processRequest_(e));
}

// 方便部署後直接用瀏覽器開網址測試是否部署成功
function doGet(e) {
  if (e && e.parameter && e.parameter.bridge === "1") {
    var id = String(e.parameter.bridgeId || "");
    var origin = String(e.parameter.parentOrigin || "");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(id) ||
      !(origin === "https://linosmond.github.io" || /^http:\/\/localhost:\d+$/.test(origin))) {
      return HtmlService.createHtmlOutput("Invalid bridge request");
    }
    var html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
      'const channel="timeclock-api-v1",bridgeId=' + JSON.stringify(id) + ',parentOrigin=' + JSON.stringify(origin) + ';' +
      'function send(packet){window.top.postMessage(Object.assign({channel:channel,bridgeId:bridgeId},packet),parentOrigin);}' +
      'window.addEventListener("message",function(event){' +
      'const packet=event.data;' +
      'if(event.origin!==parentOrigin||event.source!==window.top||!packet||packet.channel!==channel||packet.bridgeId!==bridgeId||packet.type!=="request")return;' +
      'google.script.run.withSuccessHandler(function(data){send({type:"result",requestId:packet.requestId,data:data});})' +
      '.withFailureHandler(function(){send({type:"result",requestId:packet.requestId,failed:true});})' +
      '.bridgeApi(JSON.stringify(packet.payload));' +
      '});send({type:"ready"});</script></body></html>';
    return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return jsonResponse_({ ok: true, message: "TimeClock API is running. 請用 POST 呼叫。" });
}

// 與 POST 共用全部密碼、憑證、權限、鎖與打卡去重檢查；只改變回傳通道。
function bridgeApi(contents) {
  if (typeof contents !== "string") return { ok: false, error: "invalid request" };
  return processRequest_({ postData: { contents: contents } });
}
