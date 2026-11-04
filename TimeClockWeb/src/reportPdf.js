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

// 把已排好版的報表（每個 .page 是一張 A4）轉成 PDF 檔
export async function pagesToPdf(pages, paper, fileName) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);
  const pdf = new jsPDF({ orientation: paper.landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], { scale: 3, backgroundColor: "#ffffff", logging: false });
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
