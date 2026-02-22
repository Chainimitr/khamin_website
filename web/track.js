// web/track.js
const $ = (q) => document.querySelector(q);

function toast(msg) {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtTH(iso) {
  try {
    return new Date(iso).toLocaleString("th-TH");
  } catch {
    return "-";
  }
}

function badgeTone(status) {
  const s = String(status || "");
  if (s.includes("เสร็จ")) return "ok";
  if (s.includes("กำลัง") || s.includes("ดำเนิน") || s.includes("ลงพื้นที่"))
    return "warn";
  if (s.includes("ยกเลิก") || s.includes("ไม่รับ")) return "danger";
  return "info";
}

// ---------- lightbox ----------
function openLightbox(src, title = "ดูรูปภาพ") {
  const titleEl = $("#imgTitle");
  const img = $("#imgBig");
  const ov = $("#imgOverlay");
  if (!ov || !img || !titleEl) return;

  titleEl.textContent = title;
  img.src = src;
  ov.classList.add("show");
}
function closeLightbox() {
  $("#imgOverlay")?.classList.remove("show");
}

// ---------- ui ----------
function setEmptyState(showEmpty) {
  const empty = $("#emptyHint");
  const wrap = $("#detailWrap");
  if (empty) empty.hidden = !showEmpty;
  if (wrap) wrap.hidden = showEmpty;
}

function renderTimeline(list) {
  const wrap = $("#timelineUI");
  if (!wrap) return;

  wrap.innerHTML = "";
  const arr = Array.isArray(list) ? list : [];

  if (arr.length === 0) {
    wrap.innerHTML = `<div class="hint">— ยังไม่มี Timeline —</div>`;
    return;
  }

  arr.forEach((t, idx) => {
    const row = document.createElement("div");
    row.className = "t-row";
    row.innerHTML = `
      <div class="t-dot">${idx + 1}</div>
      <div class="t-body">
        <div class="t-title">${escapeHtml(t.title || "-")}</div>
        <div class="t-time muted">${escapeHtml(t.time || "-")}</div>
        ${t.note ? `<div class="t-note">${escapeHtml(t.note)}</div>` : ""}
      </div>
    `;
    wrap.appendChild(row);
  });
}

function renderThumbs(containerEl, images, prefix) {
  if (!containerEl) return;

  containerEl.innerHTML = "";
  const arr = Array.isArray(images) ? images : [];

  if (arr.length === 0) {
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.padding = "10px 12px";
    hint.style.border = "1px dashed rgba(122, 77, 22, 0.25)";
    hint.style.borderRadius = "12px";
    hint.style.background = "rgba(255, 197, 51, 0.08)";
    hint.textContent = "— ไม่มีรูป —";
    containerEl.appendChild(hint);
    return;
  }

  arr.forEach((src, idx) => {
    const t = document.createElement("div");
    t.className = "thumb";
    t.innerHTML = `
      <img src="${src}" alt="${prefix}-${idx}">
      <div class="cap">${prefix} #${idx + 1}</div>
    `;
    t.addEventListener("click", () => openLightbox(src, `${prefix} #${idx + 1}`));
    containerEl.appendChild(t);
  });
}

function fillResultBox(item) {
  $("#resultBox").style.display = "block";

  $("#resCode").textContent = item.code || "-";
  $("#resUpdated").textContent = fmtTH(item.updatedAt);
  $("#resVillage").textContent = item.village || "-";
  $("#resTopic").textContent = item.topic || "-";
  $("#resLatLng").textContent = `${item.lat || "-"}, ${item.lng || "-"}`;
  $("#resDetail").textContent = item.detail || "-";

  const badge = $("#resStatusBadge");
  badge.className = `badge ${badgeTone(item.status)}`;
  badge.textContent = item.status || "-";
}

function clearAll() {
  $("#codeInput").value = "";
  $("#searchHint").textContent = "";
  $("#resultBox").style.display = "none";
  setEmptyState(true);
  $("#timelineUI").innerHTML = "";
  $("#beforeUI").innerHTML = "";
  $("#afterUI").innerHTML = "";
  toast("ล้างแล้ว");
}

// ---------- fetch ----------
async function loadTrack(code) {
  const hint = $("#searchHint");
  hint.textContent = "กำลังค้นหา...";

  setEmptyState(true);
  $("#resultBox").style.display = "none";

  try {
    const r = await fetch(`/api/track/${encodeURIComponent(code)}`, {
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));

    if (!r.ok || !j.ok) {
      hint.textContent =
        r.status === 404 ? "ไม่พบเลขคำร้องนี้" : (j.message || "ค้นหาไม่สำเร็จ");
      toast("ไม่พบข้อมูล");
      return;
    }

    hint.textContent = "";
    fillResultBox(j.item);

    setEmptyState(false);
    renderTimeline(j.item.timeline || []);
    renderThumbs($("#beforeUI"), j.item.imagesBefore || [], "ก่อน");
    renderThumbs($("#afterUI"), j.item.imagesAfter || [], "หลัง");

    toast("โหลดข้อมูลแล้ว");
  } catch {
    hint.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
    toast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
}

// ---------- bind ----------
function bindEvents() {
  $("#searchBtn")?.addEventListener("click", () => {
    const code = ($("#codeInput").value || "").trim().toUpperCase();
    if (!code) return toast("กรุณากรอกเลขคำร้อง");
    loadTrack(code);
  });

  $("#codeInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("#searchBtn")?.click();
    }
  });

  $("#clearBtn")?.addEventListener("click", clearAll);

  $("#closeImgBtn")?.addEventListener("click", closeLightbox);
  $("#imgOverlay")?.addEventListener("click", (e) => {
    if (e.target === $("#imgOverlay")) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
}

// init: ถ้ามี query ?code=xxxx ให้ค้นหาอัตโนมัติ
(function init() {
  bindEvents();
  setEmptyState(true);

  const params = new URLSearchParams(location.search);
  const code = (params.get("code") || "").trim().toUpperCase();
  if (code) {
    $("#codeInput").value = code;
    loadTrack(code);
  }
})();