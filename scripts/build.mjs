#!/usr/bin/env node
/*
 * Generator situs ApkSwift.
 * Membaca daftar aplikasi dari Firestore (REST, baca-saja) lalu menulis situs statis ke folder public/:
 *   index.html                beranda
 *   app/<id>/index.html       satu halaman per aplikasi (judul, deskripsi, unduhan di HTML, data terstruktur)
 *   developer/index.html      halaman developer (login), noindex
 *   sitemap.xml, robots.txt, 404.html, build-hash.txt, assets/*
 *
 * Pakai:  node scripts/build.mjs [--out public] [--site-url https://apkswift.web.app]
 * Uji:    node scripts/build.mjs --mock data.json --out /tmp/out [--inline] [--explicit-index]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const read = (p) => readFileSync(join(ROOT, p));
const sha = (buf, n = 8) => createHash("sha256").update(buf).digest("hex").slice(0, n);

const INLINE = flag("inline");               // CSS, JS, gambar disisipkan ke tiap halaman (untuk pratinjau)
const EXPLICIT_INDEX = flag("explicit-index"); // tautan memakai index.html eksplisit (untuk pratinjau tanpa server)
const OUT = resolve(opt("out", join(ROOT, "public")));
const SITE_URL = (process.env.SITE_URL || opt("site-url", "https://apkswift.web.app")).replace(/\/+$/, "");
const FS_BASE = process.env.FIRESTORE_BASE || "https://firestore.googleapis.com";

/* ---------- konfigurasi: satu sumber, diambil dari blok CONFIG di halaman developer ---------- */
const devSrc = read("src/developer.html").toString("utf8");
const grab = (k) => { const m = devSrc.match(new RegExp(k + ':\\s*"([^"]*)"')); if (!m) throw new Error("CONFIG." + k + " tidak ditemukan di src/developer.html"); return m[1]; };
const CFG = { project: grab("projectId"), apiKey: grab("apiKey"), siteName: grab("siteName"), tagline: grab("tagline"), footer: grab("footer") };

/* ---------- baca data Firestore ---------- */
function decValue(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decValue);
  if ("mapValue" in v) return decFields(v.mapValue.fields || {});
  return null;
}
function decFields(f) { const o = {}; for (const k of Object.keys(f)) o[k] = decValue(f[k]); return o; }

async function getJson(url, allow404 = false) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json", referer: SITE_URL + "/" } });
      if (r.status === 404 && allow404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
      return await r.json();
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1500 * (i + 1))); }
  }
  throw new Error("Gagal membaca Firestore (" + url.replace(/key=[^&]+/, "key=***") + "): " + last.message);
}
async function loadData() {
  if (opt("mock")) { const j = JSON.parse(readFileSync(opt("mock"), "utf8")); return { apps: j.apps || [], site: j.site || {} }; }
  const base = FS_BASE + "/v1/projects/" + CFG.project + "/databases/(default)/documents";
  const apps = []; let token = "";
  do {
    const j = await getJson(base + "/apps?pageSize=300&key=" + CFG.apiKey + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
    for (const d of j.documents || []) { const o = decFields(d.fields || {}); o.id = decodeURIComponent(d.name.split("/").pop()); apps.push(o); }
    token = j.nextPageToken || "";
  } while (token);
  const sj = await getJson(base + "/config/site?key=" + CFG.apiKey, true);
  return { apps, site: sj ? decFields(sj.fields || {}) : {} };
}

/* ---------- pembantu tampilan (sama dengan halaman developer) ---------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;
function hue(s) { let h = 0; const P = [158, 196, 220, 256, 290, 334, 8, 24]; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997; return P[h % P.length]; }
const latest = (a) => (a.versions && a.versions[0]) || {};
const safeId = (id) => String(id).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "app";
const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/[\s,.;:]+\S*$/, "") + "…"; };
function ghRelUrl(repo, tag, name) { return "https://github.com/" + repo + "/releases/download/" + enc(tag) + "/" + enc(name); }
function dlUrl(u) {   // link berkas-di-repo (apk/<tag>/<nama>) diubah ke link Releases
  const m = String(u || "").match(/^https:\/\/(?:raw\.githubusercontent\.com\/([^\/]+\/[^\/]+)\/[^\/]+|github\.com\/([^\/]+\/[^\/]+)\/raw\/[^\/]+)\/apk\/([^\/]+)\/([^\/?#]+)/);
  return m ? ghRelUrl(m[1] || m[2], decodeURIComponent(m[3]), decodeURIComponent(m[4])) : u;
}
const SWOOSH = '<svg class="swoosh" viewBox="0 0 800 320" preserveAspectRatio="xMaxYMid slice" aria-hidden="true"><path pathLength="1" d="M-20 262C180 304 330 118 520 150S760 252 840 36"/><path pathLength="1" d="M-20 300C220 334 380 160 560 190S780 282 840 118"/><path pathLength="1" d="M-20 222C160 252 300 68 500 100S760 192 840 -22"/></svg>';
const DL_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>';
const SHIELD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>';
const BACK_ICON = '<i><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg></i>';
const LD_CAT = { pendidikan: "EducationalApplication", keuangan: "FinanceApplication", alat: "UtilitiesApplication", game: "GameApplication", hiburan: "EntertainmentApplication", kesehatan: "HealthApplication", produktivitas: "BusinessApplication" };

/* ---------- berkas keluaran ---------- */
const files = new Map();                         // path -> Buffer
const put = (p, data) => files.set(p, Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"));
const MIME = { webp: "image/webp", png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif" };
function dataUri(u) {
  const m = String(u || "").match(/^data:image\/(webp|png|jpeg|jpg|gif);base64,([A-Za-z0-9+/=]+)$/);
  return m ? { ext: m[1] === "jpeg" ? "jpg" : m[1], buf: Buffer.from(m[2], "base64") } : null;
}
function addImage(stem, img) {                   // kembalikan {path, uri}: path untuk situs, uri untuk pratinjau inline
  const path = "assets/" + stem + "." + sha(img.buf) + "." + img.ext;
  if (!INLINE) put(path, img.buf);
  return { path, uri: "data:" + MIME[img.ext] + ";base64," + img.buf.toString("base64") };
}

/* ---------- jalur relatif antar halaman ---------- */
function paths(depth, abs = false) {
  const up = abs ? "/" : "../".repeat(depth);
  const idx = EXPLICIT_INDEX && !abs ? "index.html" : "";
  return {
    home: (up + idx) || "./",
    app: (id) => up + "app/" + enc(safeId(id)) + "/" + idx,
    file: (p) => up + p,
  };
}

/* ---------- potongan HTML ---------- */
function headHtml(o) {
  const { depth, abs, title, desc, canonical, robots, image, type = "website", ld = [], ctx } = o;
  const P = paths(depth, abs);
  const css = "<style>\n" + ctx.css + "</style>";
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="theme-color" content="#f2f7f5" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#06191a" media="(prefers-color-scheme: dark)">',
    "<title>" + esc(title) + "</title>",
    '<meta name="description" content="' + esc(desc) + '">',
    robots ? '<meta name="robots" content="' + robots + '">' : "",
    '<link rel="canonical" href="' + esc(canonical) + '">',
    '<meta property="og:locale" content="id_ID">',
    '<meta property="og:site_name" content="' + esc(ctx.siteName) + '">',
    '<meta property="og:type" content="' + type + '">',
    '<meta property="og:title" content="' + esc(title) + '">',
    '<meta property="og:description" content="' + esc(desc) + '">',
    '<meta property="og:url" content="' + esc(canonical) + '">',
    image ? '<meta property="og:image" content="' + esc(image) + '">' : "",
    '<meta name="twitter:card" content="summary">',
    '<link rel="icon" type="image/webp" href="' + esc(INLINE ? ctx.logo.uri : P.file(ctx.logo.path)) + '">',
    ...(ctx.fonts
      ? ctx.fonts.preload.map((u) => '<link rel="preload" as="font" type="font/woff2" crossorigin href="' + esc(P.file(u.replace(/^\//, ""))) + '">')
      : ['<link rel="preconnect" href="https://fonts.googleapis.com">', '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
         '<link rel="stylesheet" href="' + FONT_URL + '" media="print" onload="this.media=\'all\'">']),
    css,
    ...ld.map((j) => '<script type="application/ld+json">' + JSON.stringify(j).replace(/</g, "\\u003c") + "</script>"),
  ].filter(Boolean).join("\n");
}
function page(o) {
  const { depth, abs, ctx, body } = o;
  const P = paths(depth, abs);
  const js = INLINE ? "<script>\n" + ctx.js + "</script>" : '<script src="' + P.file(ctx.jsPath) + '" defer></script>';
  const fsAttr = ctx.fsUrl ? ' data-fs="' + esc(ctx.fsUrl) + '"' : "";
  return "<!doctype html>\n<html lang=\"id\"" + fsAttr + ">\n<head>\n" + headHtml(o) + "\n</head>\n<body>\n" + body + "\n" + js + "\n</body>\n</html>\n";
}
function header(ctx, depth, isHome, abs = false) {
  const P = paths(depth, abs);
  const logo = INLINE ? ctx.logo.uri : P.file(ctx.logo.path);
  return '<header class="top"><div class="wrap">\n  <div class="id"><a class="brand" href="' + P.home + '" aria-label="Beranda ' + esc(ctx.siteName) + '"><span class="mark"><img src="' + esc(logo) + '" alt="" width="54" height="54"></span></a>\n    <div>' +
    (isHome ? '<h1 id="siteName">' + esc(ctx.siteName) + "</h1>" : '<div class="nm">' + esc(ctx.siteName) + "</div>") + '<p id="tag">' + esc(ctx.tagline) + "</p></div></div>\n" +
    '  <form role="search" action="' + P.home + '" method="get"><input id="q" name="q" type="search" placeholder="Cari aplikasi" aria-label="Cari aplikasi" enterkeyhint="search" autocomplete="off"></form>\n</div></header>';
}
function icon(a, ctx, depth, alt = "", lazy = false) {
  const im = ctx.icons.get(a.id);
  if (im) return '<img class="ico" alt="' + esc(alt) + '" width="58" height="58"' + (lazy ? ' loading="lazy" decoding="async"' : "") + ' src="' + esc(INLINE ? im.uri : paths(depth).file(im.path)) + '">';
  return '<span class="ico" style="--h:' + hue(a.id) + '">' + esc((a.name || "?").charAt(0).toUpperCase()) + "</span>";
}

/* ---------- beranda ---------- */
function homePage(ctx) {
  const { apps } = ctx, P = paths(0), cats = [];
  apps.forEach((a) => { if (a.cat && !cats.includes(a.cat)) cats.push(a.cat); });
  let body = header(ctx, 0, true) + '\n<div class="wrap">\n<main id="main">\n';
  if (!apps.length) body += '<p class="empty">Belum ada aplikasi.</p>\n';
  else {
    if (cats.length) body += '<div class="chips" id="chips"><button type="button" data-cat="" aria-pressed="true">Semua</button>' + cats.map((c) => '<button type="button" data-cat="' + esc(c) + '" aria-pressed="false">' + esc(c) + "</button>").join("") + "</div>\n";
    const f = apps[0], l = latest(f);
    body += '<a class="feat" id="feat" href="' + P.app(f.id) + '" style="--h:' + hue(f.id) + '">' + SWOOSH + '<div class="ft"><span class="badge">Terbaru</span><h2>' + esc(f.name) + "</h2><p>" + esc(f.desc || "") + '</p><span class="btn go">' + DL_ICON + "Lihat dan unduh " + esc(l.v || "") + '</span></div><div class="fi">' + icon(f, ctx, 0) + "</div></a>\n";
    const rest = apps.length - 1;
    body += '<h2 class="sec" id="sec"' + (rest ? "" : " hidden") + '><span id="secTitle">Aplikasi lainnya</span><small id="secCount">' + rest + '</small></h2>\n<div class="list" id="list"' + (rest ? "" : " hidden") + ">\n" +
      apps.map((a, i) => '<a class="row" href="' + P.app(a.id) + '" style="--h:' + hue(a.id) + '" data-cat="' + esc(a.cat || "") + '" data-search="' + esc((a.name + " " + (a.cat || "") + " " + (a.desc || "")).toLowerCase()) + '"' + (i === 0 ? ' data-first="1" hidden' : "") + ">" +
        icon(a, ctx, 0, "", i > 0) + '<span class="t"><b>' + esc(a.name) + "</b><span>" + esc(a.desc || a.cat || "") + '</span></span><span class="ver">v' + esc(latest(a).v || "") + "</span></a>").join("\n") + "\n</div>\n" +
      '<p class="empty" id="nores" hidden>Tidak ada aplikasi yang cocok. Coba kata kunci lain.</p>\n';
  }
  body += '</main>\n<footer id="foot">' + esc(ctx.footer) + "</footer>\n</div>";
  const names = apps.slice(0, 6).map((a) => a.name).join(", ");
  const desc = cut(ctx.tagline + (names ? " Aplikasi: " + names + "." : "") + " Unduh APK langsung dari GitHub Releases.", 158);
  const ld = [{ "@context": "https://schema.org", "@type": "WebSite", name: ctx.siteName, url: SITE_URL + "/", inLanguage: "id" },
    { "@context": "https://schema.org", "@type": "ItemList", itemListElement: apps.map((a, i) => ({ "@type": "ListItem", position: i + 1, url: SITE_URL + "/app/" + enc(safeId(a.id)) + "/", name: a.name })) }];
  return page({ depth: 0, ctx, body, title: ctx.siteName + " | " + ctx.tagline.replace(/\.$/, ""), desc, canonical: SITE_URL + "/", image: SITE_URL + "/" + ctx.logo.path, ld });
}

/* ---------- halaman satu aplikasi ---------- */
function appPage(a, ctx) {
  const depth = 2, P = paths(depth), l = latest(a), url = dlUrl(l.url) || "";
  const fromGithub = /^https:\/\/github\.com\//.test(url);
  const vers = (a.versions || []).filter((x) => x && x.v);
  let body = header(ctx, depth, false) + '\n<div class="wrap">\n<main id="main">\n<a class="back" href="' + P.home + '" aria-label="Kembali ke halaman awal">' + BACK_ICON + "Semua aplikasi</a>\n<article>\n" +
    '<section class="dhead" style="--h:' + hue(a.id) + '">' + SWOOSH + '<div class="dtop">' + icon(a, ctx, depth, "Ikon " + a.name) + "<div><h1>" + esc(a.name) + "</h1><p>" + esc(a.cat || "Aplikasi Android") + "</p></div></div>" +
    '<div class="cta"><a class="btn go" href="' + esc(url) + '" download rel="noopener">' + DL_ICON + '<span aria-live="polite">Unduh APK ' + esc(l.v || "") + (l.size ? " (" + esc(l.size) + ")" : "") + "</span></a>" +
    '<button type="button" class="btn ghost" data-share="' + esc(a.name) + '">Bagikan</button><button type="button" class="btn ghost" data-copy="' + esc(url) + '">Salin link APK</button></div>' +
    (fromGithub ? '<p class="src">' + SHIELD + "Berkas diunduh langsung dari GitHub Releases pengembang.</p>" : "") + "</section>\n" +
    '<dl class="spec"><div><dt>Versi terbaru</dt><dd>' + esc(l.v || "-") + "</dd></div><div><dt>Ukuran berkas</dt><dd>" + esc(l.size || "-") + "</dd></div><div><dt>Terakhir diperbarui</dt><dd>" + esc(l.date || "-") + "</dd></div><div><dt>Package</dt><dd>" + esc(a.pkg || a.id) + "</dd></div></dl>\n" +
    '<h2 class="hd">Tentang aplikasi</h2><p class="desc">' + esc(a.desc || "") + "</p>\n" +
    '<details class="how"><summary>Cara memasang di HP</summary><ol><li>Ketuk Unduh APK dan tunggu sampai selesai.</li><li>Buka berkas yang terunduh. Jika diminta, izinkan pemasangan dari sumber ini.</li><li>Ketuk Pasang, lalu buka aplikasinya.</li></ol></details>\n' +
    '<h2 class="hd">Riwayat versi</h2><div class="vlist">' + vers.map((x, i) => '<div class="vrow' + (i === 0 ? " cur" : "") + '"><div class="t"><b>' + esc(x.v) + "</b><small>" + esc(x.date || "") + (x.size ? ", " + esc(x.size) : "") + "</small>" + (x.log ? '<p class="desc">' + esc(x.log) + "</p>" : "") +
      '</div><div class="vact"><a class="btn ghost" href="' + esc(dlUrl(x.url) || "") + '" download rel="noopener">Unduh</a></div></div>').join("") + "</div>\n</article>\n</main>\n<footer id=\"foot\">" + esc(ctx.footer) + "</footer>\n</div>";
  const canonical = SITE_URL + "/app/" + enc(safeId(a.id)) + "/";
  const im = ctx.icons.get(a.id);
  const image = SITE_URL + "/" + (im ? im.path : ctx.logo.path);
  const desc = cut((a.desc ? a.desc + " " : "") + "Unduh APK " + a.name + (l.v ? " versi " + l.v : "") + (l.size ? " (" + l.size + ")" : "") + " langsung dari GitHub Releases.", 158);
  const ld = [{
    "@context": "https://schema.org", "@type": "SoftwareApplication", name: a.name, url: canonical, image,
    operatingSystem: "ANDROID", applicationCategory: LD_CAT[String(a.cat || "").toLowerCase()] || "UtilitiesApplication",
    description: a.desc || undefined, softwareVersion: l.v || undefined, downloadUrl: url || undefined, fileSize: l.size || undefined,
    dateModified: a.updated ? new Date(a.updated).toISOString() : undefined, inLanguage: "id",
    offers: { "@type": "Offer", price: "0", priceCurrency: "IDR" },
  }, {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: ctx.siteName, item: SITE_URL + "/" }, { "@type": "ListItem", position: 2, name: a.name, item: canonical }],
  }];
  return page({ depth, ctx, body, title: "Unduh " + a.name + " APK" + (l.v ? " v" + l.v : "") + " | " + ctx.siteName, desc, canonical, image, ld, type: "website" });
}

/* ---------- 404 ---------- */
function notFoundPage(ctx) {
  const body = header(ctx, 0, false, true) + '\n<div class="wrap"><main id="main" class="nf"><h1>Halaman tidak ditemukan</h1><p>Alamat ini tidak ada atau aplikasinya sudah dihapus.</p><a class="btn go" href="/">' + DL_ICON + "Lihat semua aplikasi</a></main></div>";
  return page({ depth: 0, abs: true, ctx, body, title: "Halaman tidak ditemukan | " + ctx.siteName, desc: "Halaman tidak ditemukan.", canonical: SITE_URL + "/404", robots: "noindex" });
}

/* ---------- halaman developer ---------- */
function devPage(ctx) {
  const P = paths(1);
  let html = devSrc;
  html = html.replace('<link rel="stylesheet" href="{{CSS}}">', "<style>\n" + ctx.css + "</style>");
  html = html.replace("{{HOME}}", P.home);
  if (html.includes("{{")) throw new Error("Penanda {{...}} tersisa di halaman developer");
  return html;
}

/* ---------- font: diunduh saat build lalu disajikan dari domain sendiri (tanpa permintaan ke Google saat pengunjung membuka situs) ---------- */
const FONT_URL = process.env.FONT_CSS_URL || "https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@600;700&display=swap";
async function loadFonts() {
  if ((opt("mock") && !process.env.FONT_CSS_URL) || INLINE) return null;
  try {
    const r = await fetch(FONT_URL, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const raw = await r.text(), local = new Map(), faces = [];
    for (const m of raw.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)) {
      if (m[1] !== "latin") continue;
      let face = m[2];
      const u = face.match(/url\(([^)]+)\)/);
      if (!u) continue;
      const src = u[1].replace(/['"]/g, "");
      if (!local.has(src)) {
        const f = await fetch(src); if (!f.ok) throw new Error("font HTTP " + f.status);
        const buf = Buffer.from(await f.arrayBuffer()), name = "assets/font-" + sha(buf) + ".woff2";
        put(name, buf); local.set(src, name);
      }
      faces.push(face.replace(u[1], "/" + local.get(src)));
    }
    if (faces.length < 4) throw new Error("font latin kurang dari 4");
    const css = faces.join("\n").replace(/\s+/g, " ").replace(/unicode-range:[^;}]*;?/g, "") + "\n";
    // muat lebih awal hanya yang dipakai di layar pertama: teks isi (400) dan judul (700)
    const pre = [...new Set(faces.filter((f) => /font-family:\s*'?(Onest|Unbounded)/.test(f) && /font-weight:\s*(400|700)/.test(f)).map((f) => f.match(/url\(([^)]+)\)/)[1].replace(/['"]/g, "")))];
    return { css, preload: pre };
  } catch (e) {
    console.warn("Font tidak bisa di-self-host, pakai Google Fonts: " + e.message);
    return null;
  }
}

/* ---------- utama ---------- */
const data = await loadData();
const valid = [];
for (const a of data.apps) {
  if (!a || !a.id || !a.name || !Array.isArray(a.versions) || !a.versions.length || !a.versions[0].url) { console.warn("Lewati dokumen tidak lengkap:", a && a.id); continue; }
  valid.push(a);
}
valid.sort((x, y) => (y.updated || 0) - (x.updated || 0) || String(x.id).localeCompare(String(y.id)));
const seen = new Set();
for (const a of valid) { const k = safeId(a.id); if (seen.has(k)) throw new Error("ID halaman bentrok: " + k); seen.add(k); }

const fonts = await loadFonts();
const css = (fonts ? fonts.css : "") + read("src/site.css").toString("utf8"), js = read("src/site.js").toString("utf8");
const cssPath = "", jsPath = "assets/site." + sha(js) + ".js";
if (!INLINE) put(jsPath, js);
const logoSrc = dataUri(data.site.logo) || { ext: "webp", buf: read("src/logo.webp") };
const ctx = {
  apps: valid, css, js, cssPath, jsPath, fonts,
  siteName: data.site.name || CFG.siteName, tagline: CFG.tagline, footer: data.site.footer || CFG.footer,
  logo: addImage("logo", logoSrc), icons: new Map(),
  fsUrl: opt("mock") || INLINE ? "" : FS_BASE + "/v1/projects/" + CFG.project + "/databases/(default)/documents/config/site?key=" + CFG.apiKey,
};
for (const a of valid) { const im = dataUri(a.icon); if (im) ctx.icons.set(a.id, addImage("icon-" + safeId(a.id), im)); }

put("index.html", homePage(ctx));
for (const a of valid) put("app/" + safeId(a.id) + "/index.html", appPage(a, ctx));
put("developer/index.html", devPage(ctx));
put("404.html", notFoundPage(ctx));
const lastmod = (t) => (t ? new Date(t).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
const newest = valid.reduce((m, a) => Math.max(m, a.updated || 0), 0);
put("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  [["/", newest]].concat(valid.map((a) => ["/app/" + enc(safeId(a.id)) + "/", a.updated])).map(([p, t]) => "  <url><loc>" + SITE_URL + p + "</loc><lastmod>" + lastmod(t) + "</lastmod></url>").join("\n") + "\n</urlset>\n");
put("robots.txt", "User-agent: *\nAllow: /\n\nSitemap: " + SITE_URL + "/sitemap.xml\n");

const h = createHash("sha256");
for (const p of [...files.keys()].sort()) { h.update(p); h.update(files.get(p)); }
put("build-hash.txt", h.digest("hex").slice(0, 16) + "\n");

rmSync(OUT, { recursive: true, force: true });
for (const [p, buf] of files) { const dest = join(OUT, p); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf); }
console.log("Situs dibuat: " + OUT + " (" + valid.length + " aplikasi, " + files.size + " berkas, hash " + files.get("build-hash.txt").toString().trim() + ")");
