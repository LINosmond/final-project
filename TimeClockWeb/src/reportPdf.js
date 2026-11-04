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

// 把截圖裁到有內容的範圍，四周留 pad 像素白邊
function trimWhite(canvas, pad) {
  const b = contentBox(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  if (!b) return canvas;
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

// 把已排好版的報表（每個 .page 是一張 A4）轉成 PDF 檔
export async function pagesToPdf(pages, paper, fileName) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);
  const pdf = new jsPDF({ orientation: paper.landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  for (let i = 0; i < pages.length; i++) {
    // iPhone 螢幕比報表窄，直接截報表會整張往左偏、切掉左邊。改成：用寬的虛擬視窗、指定座標，
    // 四周多截一圈空白，再裁到實際有內容的範圍，放上紙張時置中。
    const el = pages[i], r = el.getBoundingClientRect(), PAD = 200;
    const x = r.left + window.scrollX - PAD, y = r.top + window.scrollY - 20;
    const w = Math.ceil(r.width) + PAD * 2, h = Math.ceil(r.height) + 40;
    const scale = Math.min(3, Math.sqrt(12e6 / (w * h))); // iPhone 畫布上限約 1600 萬像素，留餘裕
    const shot = await html2canvas(el.ownerDocument.body, {
      scale, backgroundColor: "#ffffff", logging: false,
      x, y, width: w, height: h, scrollX: 0, scrollY: 0,
      windowWidth: Math.max(1600, Math.ceil(x + w)), windowHeight: Math.max(1200, Math.ceil(y + h)),
      onclone: (d) => { d.documentElement.style.background = "#fff"; d.body.style.background = "#fff"; },
      ignoreElements: (n) => n.nodeType === 1 && n.parentNode === el.ownerDocument.body && !n.contains(el),
    });
    const canvas = trimWhite(shot, Math.round(8 * scale));
    const p = placeOnPaper(paper, canvas.width, canvas.height);
    if (i > 0) pdf.addPage("a4", paper.landscape ? "landscape" : "portrait");
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", p.x, p.y, p.w, p.h);
  }
  return new File([pdf.output("blob")], fileName, { type: "application/pdf" });
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
