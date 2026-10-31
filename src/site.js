/* ApkSwift: skrip halaman publik. Isi halaman sudah ada di HTML; skrip ini hanya menambah cari, salin, bagikan, dan efek. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- pesan singkat ---------- */
  function toast(m) {
    var t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = m; t.hidden = false; clearTimeout(t._h);
    t._h = setTimeout(function () { t.hidden = true; }, 2800);
  }
  function copy(text, msg) {
    function fallback() {
      var a = document.createElement("textarea");
      a.value = text; a.setAttribute("readonly", ""); a.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(a); a.select();
      var done = false; try { done = document.execCommand("copy"); } catch (e) {}
      a.remove();
      if (done) toast(msg); else window.prompt("Salin link ini:", text);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast(msg); }, fallback);
    else fallback();
  }

  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-copy]");
    if (c) copy(c.dataset.copy, "Link unduhan APK disalin.");
    var s = e.target.closest("[data-share]");
    if (s) {
      var url = location.href.split("#")[0], name = s.dataset.share;
      if (navigator.share) navigator.share({ title: name, text: "Unduh " + name + " (APK)", url: url }).catch(function () {});
      else copy(url, "Link halaman aplikasi disalin. Tempel ke WhatsApp atau media lain.");
    }
    var a = e.target.closest("a.go[download]");
    if (a && !a.dataset.busy) {
      var t = a.querySelector("span");
      if (t) {
        var old = t.textContent; a.dataset.busy = "1"; t.textContent = "Unduhan dimulai";
        setTimeout(function () { t.textContent = old; delete a.dataset.busy; }, 2600);
      }
    }
  });

  /* ---------- beranda: cari dan filter kategori ---------- */
  var list = $("#list");
  if (list) {
    var q = $("#q"), feat = $("#feat"), secTitle = $("#secTitle"), secCount = $("#secCount"), sec = $("#sec"), nores = $("#nores"), cat = "";
    var apply = function () {
      var term = q.value.trim().toLowerCase(), active = !!(term || cat), shown = 0;
      $$(".row", list).forEach(function (r) {
        var match = (!cat || r.dataset.cat === cat) && (!term || r.dataset.search.indexOf(term) > -1);
        var visible = match && (active || r.dataset.first !== "1");
        r.hidden = !visible; if (visible) shown++;
      });
      if (feat) feat.hidden = active;
      secTitle.firstChild.nodeValue = active ? "Hasil" : "Aplikasi lainnya";
      secCount.textContent = shown;
      sec.hidden = shown === 0;
      list.hidden = shown === 0;
      nores.hidden = !(active && shown === 0);
    };
    q.addEventListener("input", apply);
    q.form.addEventListener("submit", function (e) { e.preventDefault(); });
    var chips = $("#chips");
    if (chips) chips.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-cat]"); if (!b) return;
      cat = b.dataset.cat;
      $$("button", chips).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      apply();
    });
    try { var p = new URLSearchParams(location.search).get("q"); if (p) q.value = p; } catch (e) {}
    apply();
  }

  /* ---------- mode perbaikan: dibaca langsung dari Firestore (hanya satu dokumen kecil) ---------- */
  var fs = document.documentElement.dataset.fs;
  var idle = window.requestIdleCallback || function (f) { setTimeout(f, 1500); };
  if (fs && window.fetch) idle(function () {
    fetch(fs).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var f = d && d.fields, main = $("#main");
      if (f && f.maint && f.maint.booleanValue && main) {
        var p = document.createElement("p"); p.className = "empty";
        p.textContent = (f.msg && f.msg.stringValue) || "Situs sedang diperbaiki, coba lagi nanti.";
        main.textContent = ""; main.appendChild(p);
      }
    }).catch(function () {});
  });

  /* ---------- reaksi kursor (mouse/touchpad saja) ---------- */
  if (window.matchMedia && matchMedia("(hover:hover) and (pointer:fine)").matches && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
    var slots = [
      { sel: ".btn,.chips button,.row,.back,.devbar button,.brand", cur: null },
      { sel: ".feat,.dhead", cur: null }
    ], raf = 0, lx = 0, ly = 0;
    var clear = function (el) { ["--mx", "--my", "--px", "--py"].forEach(function (k) { el.style.removeProperty(k); }); };
    var paint = function () {
      raf = 0;
      slots.forEach(function (sl) {
        var el = sl.cur; if (!el) return;
        var r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
        var x = lx - r.left, y = ly - r.top;
        el.style.setProperty("--mx", x.toFixed(1) + "px"); el.style.setProperty("--my", y.toFixed(1) + "px");
        el.style.setProperty("--px", Math.max(-1, Math.min(1, x / r.width * 2 - 1)).toFixed(3));
        el.style.setProperty("--py", Math.max(-1, Math.min(1, y / r.height * 2 - 1)).toFixed(3));
      });
    };
    document.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      lx = e.clientX; ly = e.clientY;
      slots.forEach(function (sl) {
        var t = e.target.closest ? e.target.closest(sl.sel) : null;
        if (t !== sl.cur) { if (sl.cur) clear(sl.cur); sl.cur = t; }
      });
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    document.addEventListener("mouseleave", function () { slots.forEach(function (sl) { if (sl.cur) { clear(sl.cur); sl.cur = null; } }); });
  }
})();
