const CHANNEL = "timeclock-api-v1";

function connectionError(message = "Google 資料連線暫時失敗，請稍後重試。", code = "NETWORK_ERROR") {
  return Object.assign(new Error(message), { code, retryable: true });
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(connectionError("連線逾時，請確認網路後再試。", "TIMEOUT"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(connectionError("連線逾時，請確認網路後再試。", "TIMEOUT"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

// 經 HtmlService 內的 google.script.run 傳輸，避免 ContentService 一次性網址失效。
// 密碼、憑證和資料只透過 postMessage 傳给已驗證的 Google frame，不放入網址。
export function createAppsScriptBridge({ apiUrl, window, document, readyTimeoutMs = 35000 }) {
  let ready, resolveReady, rejectReady, iframe, readyTimer, bridgeId, connection;
  let sequence = 0;
  const pending = new Map();
  const receive = (event) => {
    const packet = event.data;
    if (!packet || packet.channel !== CHANNEL || packet.bridgeId !== bridgeId) return;
    if (!/^https:\/\/(?:[a-z0-9-]+-)?script\.googleusercontent\.com$/.test(event.origin)) return;
    if (packet.type === "ready" && !connection && event.source) {
      connection = { source: event.source, origin: event.origin };
      window.clearTimeout(readyTimer);
      resolveReady(connection);
      return;
    }
    if (!connection || event.source !== connection.source || event.origin !== connection.origin) return;
    if (packet.type !== "result") return;
    const request = pending.get(packet.requestId);
    if (!request) return;
    pending.delete(packet.requestId);
    request.cleanup();
    if (packet.failed) request.reject(connectionError());
    else request.resolve(packet.data);
  };
  window.addEventListener("message", receive);

  function connect() {
    if (ready) return ready;
    bridgeId = window.crypto.randomUUID();
    ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const url = new URL(apiUrl);
    url.searchParams.set("bridge", "1");
    url.searchParams.set("bridgeId", bridgeId);
    url.searchParams.set("parentOrigin", window.location.origin);
    iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.title = "TimeClock 資料連線";
    iframe.src = url.href;
    iframe.onerror = () => rejectReady(connectionError());
    readyTimer = window.setTimeout(() => rejectReady(connectionError()), readyTimeoutMs);
    document.body.appendChild(iframe);
    ready = ready.catch((error) => {
      window.clearTimeout(readyTimer);
      iframe.remove();
      ready = null;
      connection = null;
      throw error;
    });
    return ready;
  }

  return {
    async request(payload, signal) {
      const target = await withAbort(connect(), signal);
      if (signal?.aborted) throw connectionError("連線逾時，請確認網路後再試。", "TIMEOUT");
      return new Promise((resolve, reject) => {
        const requestId = String(++sequence);
        const abort = () => {
          pending.delete(requestId);
          cleanup();
          reject(connectionError("連線逾時，請確認網路後再試。", "TIMEOUT"));
        };
        const cleanup = () => signal?.removeEventListener("abort", abort);
        pending.set(requestId, { resolve, reject, cleanup });
        signal?.addEventListener("abort", abort, { once: true });
        try {
          target.source.postMessage({ channel: CHANNEL, bridgeId, type: "request", requestId, payload }, target.origin);
        } catch {
          pending.delete(requestId);
          cleanup();
          reject(connectionError());
        }
      });
    },
    dispose() {
      window.removeEventListener("message", receive);
      window.clearTimeout(readyTimer);
      rejectReady?.(connectionError());
      iframe?.remove();
      for (const request of pending.values()) { request.cleanup(); request.reject(connectionError()); }
      pending.clear();
    },
  };
}
