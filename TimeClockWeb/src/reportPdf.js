// 從手機主畫面圖示打開的網站（網頁 App）不能列印，也跳不到 Safari。
// 改在手機上直接把報表做成 PDF，用 iPhone 的分享選單「列印」或「儲存到檔案」。

export function isStandaloneApp() {
  try {
    return navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  } catch (e) {
    return false;
  }
}

// 紙張：A4，報表 @page 的邊界（mm）
export function paperOf(css) {
  const page = (css.match(/@page\s*\{([^}]*)\}/) || [])[1] || "";
  const landscape = /landscape/.test(page);
  const m = page.match(/margin\s*:\s*([\d.]+)mm/);
  return { landscape, margin: m ? Number(m[1]) : 6, w: landscape ? 297 : 210, h: landscape ? 210 : 297 };
}

// 一頁報表的圖片放進紙張：寬度貼齊可印範圍，太高就等比例縮小，水平置中
export function placeOnPaper(paper, imgW, imgH) {
  const maxW = paper.w - paper.margin * 2, maxH = paper.h - paper.margin * 2;
  const k = Math.min(maxW / imgW, maxH / imgH);
  const w = imgW * k, h = imgH * k;
  return { x: (paper.w - w) / 2, y: paper.margin, w, h };
}

// 找出圖片裡「不是白色」的範圍（rgba 陣列），回傳 {left, top, right, bottom}；整張白色回傳 null
export function contentBox(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      const k = (yy * width + xx) * 4;
      if (data[k] < 235 || data[k + 1] < 235 || data[k + 2] < 235) {
        if (xx < left) left = xx;
        if (xx > right) right = xx;
        if (yy < top) top = yy;
        if (yy > bottom) bottom = yy;
      }
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

// 把截圖裁到有內容的範圍，四周留 pad 像素白邊；整張空白回傳 null
function trimWhite(canvas, pad) {
  const b = contentBox(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  if (!b) return null;
  const sx = Math.max(0, b.left - pad), sy = Math.max(0, b.top - pad);
  const sw = Math.min(canvas.width, b.right + pad + 1) - sx, sh = Math.min(canvas.height, b.bottom + pad + 1) - sy;
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const g = out.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, sw, sh);
  g.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

// 排版用的隱形 iframe 尺寸：比 A4 橫印（281mm ≈ 1062px）寬，iPhone 窄螢幕也不會把報表擠歪
const FRAME_W = 1600, FRAME_H = 1200;

// 報表 HTML 做成 PDF 檔，每個 .page 一張 A4。
// 報表放進看不到的寬 iframe 裡單獨排版再截圖：在主畫面裡截的話，iPhone 螢幕窄、主畫面有覆蓋層和捲動，會偏移或整張空白。
// 報表裡的程式（fitPages 縮放）不執行：PDF 工具處理縮放會讓表格框線錯位，而且它晚 0.3～0.5 秒才跑，
// 會在截圖途中把縮放加回去。改用原尺寸截圖，放進 PDF 時再等比例縮小。
export async function reportHtmlToPdf(html) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${FRAME_W}px;height:${FRAME_H}px;border:0;`;
  document.body.appendChild(frame);
  try {
    await new Promise((ok) => { frame.onload = ok; frame.srcdoc = html.replace(/<script\b[\s\S]*?<\/script>/gi, ""); });
    const doc = frame.contentDocument;
    doc.querySelectorAll(".noprint").forEach((x) => x.remove());
    if (doc.fonts) await doc.fonts.ready;
    const paper = paperOf(Array.from(doc.querySelectorAll("style"), (s) => s.textContent).join("\n"));
    const orientation = paper.landscape ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
    let pages = Array.from(doc.querySelectorAll(".page"));
    if (!pages.length) pages = [doc.body];
    // 一頁截完就放進 PDF 並釋放，不同時留著好幾頁的畫布（iPhone 畫布記憶體很少）
    for (let i = 0; i < pages.length; i++) {
      const canvas = await capturePage(html2canvas, pages[i]);
      const p = placeOnPaper(paper, canvas.width, canvas.height);
      if (i > 0) pdf.addPage("a4", orientation);
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", p.x, p.y, p.w, p.h);
      canvas.width = canvas.height = 0;
    }
    const title = (doc.querySelector("h1")?.textContent || "報表").replace(/[\\/:*?"<>|\s]+/g, " ").trim();
    return new File([pdf.output("blob")], title + ".pdf", { type: "application/pdf" });
  } finally {
    frame.remove();
  }
}

// 截一頁並裁掉四周空白。iPhone 畫布記憶體不夠時會靜靜地給出整張空白：
// 截到空白就降到 1 倍解析度重試，還是空白就說清楚（附尺寸，方便查原因）
async function capturePage(html2canvas, el) {
  const w = Math.ceil(el.scrollWidth), h = Math.ceil(el.scrollHeight);
  const first = Math.min(2, Math.sqrt(6e6 / (w * h)));
  const tried = [];
  for (const scale of first > 1 ? [first, 1] : [first]) {
    const shot = await html2canvas(el, { scale, backgroundColor: "#ffffff", logging: false, windowWidth: FRAME_W, windowHeight: FRAME_H });
    tried.push(`${shot.width}x${shot.height}`);
    const page = trimWhite(shot, Math.round(8 * scale));
    shot.width = shot.height = 0;
    if (page) return page;
  }
  throw new Error(`報表截圖是空白（內容 ${w}x${h}，試過 ${tried.join("、")}）`);
}

// 用分享選單送出 PDF（裡面有「列印」「儲存到檔案」）；不支援分享時改成下載
export async function sharePdf(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (e) {
      if (e && e.name === "AbortError") return; // 使用者自己關掉分享選單
      throw e;
    }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
