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
          return jsonResponse_({ ok: true, created: false, employee: existing, employees: employees });
        }
        // 新申請的帳號預設為「待審核（pending）」，需管理員通過後才會變成 active、才能打卡並進入名冊
        var emp = { id: Utilities.getUuid(), name: name, phone: phone, status: "pending" };
        employees.push(emp);
        writeValue_(sheet, "employees", JSON.stringify(employees));
        return jsonResponse_({ ok: true, created: true, employee: emp, employees: employees });
      }

      // 管理員審核：approve = 通過（狀態改 active）；reject = 拒絕（從名冊移除）。
      if (action === "reviewEmployee") {
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
        var v = readValue_(sheet, key);
        return jsonResponse_({ ok: true, value: v });
      }

      if (action === "set") {
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
