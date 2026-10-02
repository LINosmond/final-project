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
function writePunches_(punches) {
  var sh = getPunchSheet_();
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
  if (exp > Date.now()) return true;
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
  for (var i = 0; i < existing.length; i++) byId[existing[i].id] = existing[i];
  for (var j = 0; j < incoming.length; j++) {
    if ((incoming[j].phone == null || incoming[j].phone === "") && byId[incoming[j].id]) {
      incoming[j].phone = byId[incoming[j].id].phone;
    }
  }
  return incoming;
}

// 台北時間的「上個月」，格式 YYYY-MM
function prevMonthKey_() {
  var parts = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-M").split("-");
  var y = Number(parts[0]), m = Number(parts[1]) - 1;
  if (m < 1) { m = 12; y -= 1; }
  return y + "-" + (m < 10 ? "0" + m : m);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    var requiredKey = getApiKey();
    if (requiredKey && body.apiKey !== requiredKey) {
      return jsonResponse_({ ok: false, error: "unauthorized" });
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
        if (wantsPunches) migratePunchesIfNeeded_(sheet);
        var values = {};
        for (var k = 0; k < wantKeys.length; k++) {
          var wk = wantKeys[k];
          if (wk === "punches") {
            values[wk] = JSON.stringify(readPunches_());
          } else if (ADMIN_ONLY_READ[wk] && !isAdmin) {
            values[wk] = null; // 受保護資料：非管理員一律讀不到
          } else if (wk === "employees" && !isAdmin) {
            var rawEmps = map.hasOwnProperty(wk) ? map[wk] : null;
            values[wk] = rawEmps == null ? null : JSON.stringify(stripPhones_(JSON.parse(rawEmps || "[]")));
          } else {
            values[wk] = map.hasOwnProperty(wk) ? map[wk] : null;
          }
        }
        return jsonResponse_({ ok: true, values: values });
      }

      if (action === "appendPunch") {
        migratePunchesIfNeeded_(sheet);
        var entry = body.entry;
        var punches = readPunches_();
        // 依 id 去重：前端送出失敗自動重試時，若上一筆其實已寫入，不會重複附加
        var already = false;
        for (var pi = 0; pi < punches.length; pi++) {
          if (punches[pi].id === entry.id) { already = true; break; }
        }
        if (!already) {
          var psh = getPunchSheet_();
          var newRow = psh.getLastRow() + 1;
          psh.getRange(newRow, 1, 1, PUNCH_COLS).setNumberFormat("@").setValues([punchToRow_(entry)]);
          punches.push(entry);
        }
        return jsonResponse_({ ok: true, punches: punches });
      }

      if (action === "findOrCreateEmployee") {
        var name = body.name;
        var phone = body.phone;
        if (!name || !phone) {
          return jsonResponse_({ ok: false, error: "missing name or phone" });
        }
        var employees = JSON.parse(readValue_(sheet, "employees") || "[]");
        var existing = null;
        for (var i = 0; i < employees.length; i++) {
          if (employees[i].name === name) { existing = employees[i]; break; }
        }
        if (existing) {
          // 手機號碼（密碼）不對時，不回傳該員工的手機號碼，也避免被拿來猜密碼
          if (throttleBlocked_("login:" + name)) return jsonResponse_({ ok: false, error: "too many attempts" });
          if (String(existing.phone) !== String(phone)) {
            throttleFail_("login:" + name);
            var masked = {}; for (var mk in existing) { if (mk !== "phone") masked[mk] = existing[mk]; }
            return jsonResponse_({ ok: true, created: false, employee: masked, employees: stripPhones_(employees) });
          }
          return jsonResponse_({ ok: true, created: false, employee: existing, employees: stripPhones_(employees) });
        }
        // 新申請的帳號預設為「待審核（pending）」，需管理員通過後才會變成 active、才能打卡並進入名冊
        var emp = { id: Utilities.getUuid(), name: name, phone: phone, status: "pending" };
        employees.push(emp);
        writeValue_(sheet, "employees", JSON.stringify(employees));
        return jsonResponse_({ ok: true, created: true, employee: emp, employees: stripPhones_(employees) });
      }

      // 管理員審核：approve = 通過（狀態改 active）；reject = 拒絕（從名冊移除）。
      if (action === "reviewEmployee") {
        if (!isAdmin) return jsonResponse_({ ok: false, error: "forbidden" });
        var reviewId = body.id;
        var decision = body.decision;
        if (!reviewId || (decision !== "approve" && decision !== "reject")) {
          return jsonResponse_({ ok: false, error: "missing id or invalid decision" });
        }
        var emps = JSON.parse(readValue_(sheet, "employees") || "[]");
        var kept = [];
        for (var j = 0; j < emps.length; j++) {
          if (emps[j].id === reviewId) {
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
        return jsonResponse_({ ok: true, employees: kept });
      }

      // 管理員登入驗證：密碼只在伺服器比對
      if (action === "adminLogin") {
        if (!getAdminPassword_()) return jsonResponse_({ ok: false, error: "admin password not configured" });
        if (!isAdmin) return jsonResponse_({ ok: true, admin: false });
        return jsonResponse_({ ok: true, admin: true, token: body.adminToken && tokenOk_(String(body.adminToken)) ? String(body.adminToken) : issueToken_() });
      }

      if (action === "adminLogout") {
        if (body.adminToken) PropertiesService.getScriptProperties().deleteProperty("admintok:" + String(body.adminToken));
        return jsonResponse_({ ok: true });
      }

      // 員工查看自己上個月的薪資：身分由伺服器用「姓名＋手機號碼」驗證，完全不採信前端傳來的員工 ID；
      // 管理員關閉開關時，這裡也會擋（不是只有前端把分頁藏起來）。
      if (action === "getMySalary") {
        var gName = String(body.name || ""), gPhone = String(body.phone || "");
        if (!gName || !gPhone) return jsonResponse_({ ok: false, error: "unauthorized" });
        if (throttleBlocked_("login:" + gName)) return jsonResponse_({ ok: false, error: "too many attempts" });
        var gEmps = JSON.parse(readValue_(sheet, "employees") || "[]");
        var me = null;
        for (var gi = 0; gi < gEmps.length; gi++) {
          if (gEmps[gi].name === gName && String(gEmps[gi].phone) === gPhone) { me = gEmps[gi]; break; }
        }
        if (!me || me.status === "pending") {
          throttleFail_("login:" + gName);
          return jsonResponse_({ ok: false, error: "unauthorized" });
        }
        if (readValue_(sheet, "salaryVisible") !== "true") return jsonResponse_({ ok: false, error: "disabled" });
        var pub = JSON.parse(readValue_(sheet, "salaryPublished") || "{}");
        var ymKey = prevMonthKey_();
        var mine = pub[ymKey] && pub[ymKey][me.id] ? pub[ymKey][me.id] : null;
        return jsonResponse_({ ok: true, ym: ymKey, record: mine });
      }

      // 一般 key-value 動作（get / set / delete）。punches 特別導向獨立分頁。
      var key = body.key;
      if (!key) {
        return jsonResponse_({ ok: false, error: "missing key" });
      }

      if (action === "get") {
        if (key === "punches") {
          migratePunchesIfNeeded_(sheet);
          return jsonResponse_({ ok: true, value: JSON.stringify(readPunches_()) });
        }
        if (ADMIN_ONLY_READ[key] && !isAdmin) return jsonResponse_({ ok: true, value: null });
        var v = readValue_(sheet, key);
        if (key === "employees" && !isAdmin && v != null) v = JSON.stringify(stripPhones_(JSON.parse(v || "[]")));
        return jsonResponse_({ ok: true, value: v });
      }

      if ((action === "set" || action === "delete") && !isAdmin) {
        return jsonResponse_({ ok: false, error: "forbidden" });
      }

      if (action === "set") {
        if (key === "employees") {
          var incoming; try { incoming = JSON.parse(body.value || "[]"); } catch (e3) { incoming = []; }
          var oldEmps = JSON.parse(readValue_(sheet, "employees") || "[]");
          writeValue_(sheet, key, JSON.stringify(mergePhones_(incoming, oldEmps)));
          return jsonResponse_({ ok: true });
        }
        if (key === "punches") {
          var arr;
          try { arr = JSON.parse(body.value || "[]"); } catch (e2) { arr = []; }
          writePunches_(arr);
          return jsonResponse_({ ok: true });
        }
        writeValue_(sheet, key, body.value);
        return jsonResponse_({ ok: true });
      }

      if (action === "delete") {
        if (key === "punches") {
          writePunches_([]);
          return jsonResponse_({ ok: true });
        }
        var row = findRow_(sheet, key);
        if (row !== -1) sheet.deleteRow(row);
        return jsonResponse_({ ok: true });
      }

      return jsonResponse_({ ok: false, error: "unknown action: " + action });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

// 方便部署後直接用瀏覽器開網址測試是否部署成功
function doGet(e) {
  return jsonResponse_({ ok: true, message: "TimeClock API is running. 請用 POST 呼叫。" });
}
