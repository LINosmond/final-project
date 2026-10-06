// 打卡送出佇列：按下打卡先寫進手機儲存空間，再送伺服器。
// 斷線或 App 被關掉時那筆不會消失，恢復後重送；伺服器用 clientId 去重，所以重送不會變兩筆。
const KEY = "tc2:pendingPunch";
const MAX_AGE_MS = 12 * 3600 * 1000;

export function createPunchQueue({ storage, post, now = Date.now }) {
  const read = () => { try { const raw = storage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } };
  const write = (v) => { try { if (v) storage.setItem(KEY, JSON.stringify(v)); else storage.removeItem(KEY); } catch {} };

  return {
    // 只回傳屬於這位使用者、且還沒過期的待送打卡；別人的或太舊的直接丟掉
    load(userId) {
      const e = read();
      if (!e || !e.body || !e.body.clientId) { write(null); return null; }
      if (e.userId !== userId || now() - e.at > MAX_AGE_MS) { write(null); return null; }
      return e;
    },
    save(userId, body) {
      const e = { userId, body, at: now() };
      write(e);
      return e;
    },
    clear() { write(null); },
    // 嘗試送出。回傳 { ok, result } 或 { ok:false, retry, error }
    async flush(userId) {
      const e = this.load(userId);
      if (!e) return null;
      try {
        const result = await post(e.body);
        write(null);
        return { ok: true, result, entry: e };
      } catch (error) {
        const retry = !error.status || error.status >= 500;
        if (!retry) write(null); // 伺服器明確拒絕（順序錯、超出時間窗…），不再重送
        return { ok: false, retry, error, entry: e };
      }
    },
  };
}
