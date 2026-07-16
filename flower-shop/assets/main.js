/* 花樣 LoveFor 花藝設計 — 互動腳本（無外部相依） */
(function () {
  "use strict";

  /* ---------- 行動選單 ---------- */
  var toggle = document.querySelector(".nav-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.querySelectorAll(".nav-links > a").forEach(function (a) {
      a.addEventListener("click", function () { document.body.classList.remove("nav-open"); });
    });
  }

  /* ---------- Header 陰影 ---------- */
  var header = document.querySelector(".site-header");
  var fabTop = document.querySelector(".fab .top");
  function onScroll() {
    if (header) header.classList.toggle("scrolled", window.scrollY > 12);
    if (fabTop) fabTop.classList.toggle("show", window.scrollY > 500);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- 進場動畫 ---------- */
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var items = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 回頂端 ---------- */
  var topBtn = document.querySelector(".fab .top");
  if (topBtn) topBtn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });

  /* ---------- 商品分類篩選 + 關鍵字搜尋 ---------- */
  var grid = document.querySelector("[data-catalog]");
  if (grid) {
    var chips = document.querySelectorAll(".chip");
    var search = document.querySelector("[data-search]");
    var cards = Array.prototype.slice.call(grid.querySelectorAll(".product"));
    var empty = grid.querySelector(".empty-note");
    var activeCat = "all";

    function applyFilter() {
      var q = (search && search.value ? search.value : "").trim().toLowerCase();
      var shown = 0;
      cards.forEach(function (card) {
        var cat = card.getAttribute("data-cat") || "";
        var name = (card.getAttribute("data-name") || "").toLowerCase();
        var text = card.textContent.toLowerCase();
        var okCat = activeCat === "all" || cat === activeCat;
        var okQ = !q || name.indexOf(q) > -1 || text.indexOf(q) > -1;
        var show = okCat && okQ;
        card.style.display = show ? "" : "none";
        if (show) shown++;
      });
      if (empty) empty.style.display = shown ? "none" : "";
    }
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
        chip.setAttribute("aria-pressed", "true");
        activeCat = chip.getAttribute("data-cat") || "all";
        applyFilter();
      });
    });
    if (search) search.addEventListener("input", applyFilter);
  }

  /* ---------- 詢價購物車（localStorage） ---------- */
  var KEY = "huayang_cart_v1";
  function readCart() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function writeCart(c) { localStorage.setItem(KEY, JSON.stringify(c)); }

  function cartCount() { return readCart().reduce(function (n, i) { return n + i.qty; }, 0); }
  function cartTotal() { return readCart().reduce(function (n, i) { return n + i.price * i.qty; }, 0); }

  function updateBadges() {
    var n = cartCount();
    document.querySelectorAll(".cart-btn .count").forEach(function (b) {
      b.textContent = n; b.setAttribute("data-n", n);
    });
  }

  function addToCart(name, price) {
    var cart = readCart();
    var found = cart.filter(function (i) { return i.name === name; })[0];
    if (found) found.qty += 1; else cart.push({ name: name, price: price, qty: 1 });
    writeCart(cart); updateBadges(); renderDrawer();
  }
  function setQty(name, delta) {
    var cart = readCart();
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].name === name) {
        cart[i].qty += delta;
        if (cart[i].qty <= 0) cart.splice(i, 1);
        break;
      }
    }
    writeCart(cart); updateBadges(); renderDrawer();
  }
  function removeItem(name) {
    writeCart(readCart().filter(function (i) { return i.name !== name; }));
    updateBadges(); renderDrawer();
  }

  // 加入按鈕
  document.querySelectorAll(".add-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      addToCart(btn.getAttribute("data-name"), parseInt(btn.getAttribute("data-price"), 10) || 0);
      var label = btn.textContent;
      btn.textContent = "已加入 ✓"; btn.classList.add("added");
      setTimeout(function () { btn.textContent = label; btn.classList.remove("added"); }, 1200);
    });
  });

  // 抽屜渲染
  var drawerBody = document.querySelector("[data-cart-body]");
  var drawerTotal = document.querySelector("[data-cart-total]");
  function renderDrawer() {
    if (!drawerBody) return;
    var cart = readCart();
    if (!cart.length) {
      drawerBody.innerHTML = '<div class="cart-empty">你的詢價清單是空的<br>去挑幾束喜歡的花吧 🌸</div>';
    } else {
      drawerBody.innerHTML = cart.map(function (i) {
        return '<div class="cart-item"><div class="thumb"></div><div class="ci-body">' +
          '<b>' + i.name + '</b><span>NT$ ' + i.price.toLocaleString() + ' 起</span>' +
          '<div class="qty"><button data-dec="' + i.name + '" aria-label="減少">−</button>' +
          '<span>' + i.qty + '</span><button data-inc="' + i.name + '" aria-label="增加">+</button></div>' +
          '</div><button class="ci-remove" data-rm="' + i.name + '">移除</button></div>';
      }).join("");
    }
    if (drawerTotal) drawerTotal.textContent = "NT$ " + cartTotal().toLocaleString();
    drawerBody.querySelectorAll("[data-inc]").forEach(function (b) { b.onclick = function () { setQty(b.getAttribute("data-inc"), 1); }; });
    drawerBody.querySelectorAll("[data-dec]").forEach(function (b) { b.onclick = function () { setQty(b.getAttribute("data-dec"), -1); }; });
    drawerBody.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { removeItem(b.getAttribute("data-rm")); }; });
  }

  // 開關抽屜
  function openCart() { document.body.classList.add("cart-open"); renderDrawer(); }
  function closeCart() { document.body.classList.remove("cart-open"); }
  document.querySelectorAll(".cart-btn").forEach(function (b) { b.addEventListener("click", openCart); });
  document.querySelectorAll("[data-cart-close], .overlay").forEach(function (b) { b.addEventListener("click", closeCart); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCart(); });

  updateBadges();

  /* ---------- 前往預約：把清單帶入聯絡表單 ---------- */
  var goInquiry = document.querySelector("[data-cart-inquiry]");
  if (goInquiry) goInquiry.addEventListener("click", function () {
    var cart = readCart();
    if (cart.length) {
      var list = cart.map(function (i) { return "・" + i.name + " ×" + i.qty; }).join("\n");
      sessionStorage.setItem("huayang_inquiry", "我想詢問以下花禮：\n" + list);
    }
    window.location.href = "contact.html#form";
  });

  // 聯絡頁自動帶入
  var msgField = document.getElementById("msg");
  if (msgField) {
    var pre = sessionStorage.getItem("huayang_inquiry");
    if (pre) { msgField.value = pre; sessionStorage.removeItem("huayang_inquiry"); }
  }

  /* ---------- 表單示範 ---------- */
  var form = document.querySelector("form[data-demo]");
  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    var note = form.querySelector(".form-result");
    if (note) { note.textContent = "感謝您的預約！我們會盡快與您聯繫。（此為前端示範，上線時可串接 Email／LINE／表單服務）"; note.style.color = "var(--berry-deep)"; }
    form.reset();
  });
})();
