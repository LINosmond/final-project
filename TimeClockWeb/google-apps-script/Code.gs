// 部署方式請見 README.md。
// 這支腳本把 Google 試算表當成一個簡單的 key-value 資料庫，
// 對應網站前端的 storage.get / storage.set / storage.delete。
//
// 「員工登入建立帳號」與「打卡」這兩個動作額外提供 findOrCreateEmployee / appendPunch
// 兩個原子操作：在同一個 LockService 鎖之內完成「讀取整包資料 -> 修改 -> 寫回」，
// 避免兩個裝置幾乎同時操作時，後寫入的一方把先寫入的資料整包覆蓋掉。

var SHEET_NAME = "KV";

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
        // 一次把整張表讀進記憶體，回傳前端要求的多個 key，
        // 讓進站只需一次請求（而不是每個 key 各打一次），大幅縮短載入時間。
        var allData = sheet.getDataRange().getValues();
        var map = {};
        for (var r = 1; r < allData.length; r++) {
          map[allData[r][0]] = String(allData[r][1]);
        }
        var wantKeys = body.keys || [];
        var values = {};
        for (var k = 0; k < wantKeys.length; k++) {
          values[wantKeys[k]] = map.hasOwnProperty(wantKeys[k]) ? map[wantKeys[k]] : null;
        }
        return jsonResponse_({ ok: true, values: values });
      }

      if (action === "appendPunch") {
        var punches = JSON.parse(readValue_(sheet, "punches") || "[]");
        punches.push(body.entry);
        writeValue_(sheet, "punches", JSON.stringify(punches));
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
      // 在同一把鎖內讀取整包 employees 再修改寫回，避免與其他人幾乎同時申請時互相覆蓋。
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

      // 一般 key-value 動作（get / set / delete），供其他資料（員工清單管理、打卡紀錄管理、
      // 國定假日、地點限制、超時倍率等）使用
      var key = body.key;
      if (!key) {
        return jsonResponse_({ ok: false, error: "missing key" });
      }

      if (action === "get") {
        var v = readValue_(sheet, key);
        return jsonResponse_({ ok: true, value: v });
      }

      if (action === "set") {
        writeValue_(sheet, key, body.value);
        return jsonResponse_({ ok: true });
      }

      if (action === "delete") {
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
