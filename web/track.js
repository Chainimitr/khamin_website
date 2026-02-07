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

function openOverlay(el) {
  el?.classList.add("show");
}
function closeOverlay(el) {
  el?.classList.remove("show");
}

function badgeTone(status) {
  const s = String(status || "");
  if (s.includes("เสร็จ")) return "ok";
  if (s.includes("กำลัง") || s.includes("ดำเนิน") || s.includes("ลงพื้นที่"))
    return "warn";
  if (s.includes("ยกเลิก") || s.includes("ไม่รับ")) return "danger";
  return "info";
}

function renderBadge(status) {
  const el = $("#resBadge");
  if (!el) return;
  el.textContent = status || "-";
  el.className = "badge " + badgeTone(status);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showBox() {
  const empty = $("#resultEmpty");
  const box = $("#resultBox");
  if (empty) empty.style.display = "none";
  if (box) {
    box.style.display = "block"; // ✅ สำคัญ: ให้ชนะ inline style ที่ตั้งไว้ใน html
  }
}

function hideBox() {
  const empty = $("#resultEmpty");
  const box = $("#resultBox");
  if (empty) empty.style.display = "block";
  if (box) box.style.display = "none";
}

function renderTimeline(steps) {
  const wrap = $("#timeline");
  if (!wrap) return;

  wrap.innerHTML = "";

  const arr = Array.isArray(steps) ? steps : [];
  if (arr.length === 0) {
    wrap.innerHTML = `<div class="muted">— ยังไม่มี Timeline —</div>`;
    return;
  }

  arr.forEach((s, idx) => {
    const item = document.createElement("div");
    item.className = "t-item";
    item.innerHTML = `
      <div class="t-dot">${idx + 1}</div>
      <div class="t-body">
        <div class="t-title">${escapeHtml(s.title || "-")}</div>
        <div class="t-time muted">${escapeHtml(s.time || "-")}</div>
        ${s.note ? `<div class="t-note">${escapeHtml(s.note)}</div>` : ""}
      </div>
    `;
    wrap.appendChild(item);
  });
}

function renderGallery(selector, images, labelIfEmpty = "— ไม่มีรูป —") {
  const wrap = $(selector);
  if (!wrap) return;

  wrap.innerHTML = "";
  const arr = Array.isArray(images) ? images : [];

  if (arr.length === 0) {
    // ✅ ให้ดูเนียนกับ grid thumbs
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.padding = "10px 12px";
    hint.style.border = "1px dashed rgba(122, 77, 22, 0.25)";
    hint.style.borderRadius = "12px";
    hint.style.background = "rgba(255, 197, 51, 0.08)";
    hint.textContent = labelIfEmpty;
    wrap.appendChild(hint);
    return;
  }

  arr.forEach((src, idx) => {
    const box = document.createElement("div");
    box.className = "thumb";
    box.innerHTML = `
      <img src="${src}" alt="รูป ${idx + 1}">
      <div class="cap">รูปที่ ${idx + 1}</div>
    `;
    box.addEventListener("click", () => openLightbox(src, `รูปที่ ${idx + 1}`));
    wrap.appendChild(box);
  });
}

function openLightbox(src, title) {
  const t = $("#imgTitle");
  const img = $("#imgBig");
  if (t) t.textContent = title || "ดูรูปภาพ";
  if (img) img.src = src;
  openOverlay($("#imgOverlay"));
}

function showResult(item) {
  showBox();

  $("#resCode").textContent = item.code || "-";
  $("#resVillage").textContent = item.village || "-";
  $("#resTopic").textContent = item.topic || "-";
  $("#resCoords").textContent =
    item.lat && item.lng ? `${item.lat}, ${item.lng}` : "-";

  renderBadge(item.status);
  renderTimeline(item.timeline || []);

  renderGallery(
    "#beforeGallery",
    item.imagesBefore || [],
    "— ไม่มีรูปก่อนดำเนินการ —",
  );
  renderGallery(
    "#afterGallery",
    item.imagesAfter || [],
    "— ยังไม่มีรูปหลังดำเนินการ —",
  );
}

function showNotFound(code) {
  showBox();

  $("#resCode").textContent = code || "-";
  $("#resVillage").textContent = "-";
  $("#resTopic").textContent = "-";
  $("#resCoords").textContent = "-";

  renderBadge("ไม่พบเลขคำร้อง");

  renderTimeline([
    {
      title: "ไม่พบข้อมูล",
      time: "—",
      note: "ตรวจสอบเลขคำร้องให้ถูกต้อง หรือสอบถามเจ้าหน้าที่",
    },
  ]);

  renderGallery("#beforeGallery", [], "— ไม่มีรูป —");
  renderGallery("#afterGallery", [], "— ไม่มีรูป —");
}

async function fetchTrack(code) {
  const c = String(code || "")
    .trim()
    .toUpperCase();
  if (!c) return;

  $("#trackHint").textContent = "กำลังค้นหา...";

  try {
    // ✅ server.js รองรับ endpoint นี้
    const r = await fetch(`/api/track/${encodeURIComponent(c)}`);
    const j = await r.json().catch(() => ({}));

    $("#trackHint").textContent = "";

    if (!r.ok || !j.ok) {
      showNotFound(c);
      toast("ไม่พบเลขคำร้อง");
      return;
    }

    showResult(j.item);
    toast("แสดงผลการติดตามแล้ว");
  } catch (err) {
    $("#trackHint").textContent =
      "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ให้เปิดผ่าน http://localhost:3000 ไม่ใช่ file://)";
    toast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
}

(function init() {
  // สถานะเริ่มต้น
  hideBox();

  $("#trackForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    fetchTrack($("#trackCode").value);
  });

  $("#btnClear")?.addEventListener("click", () => {
    $("#trackCode").value = "";
    location.href = "track.html";
  });

  $("#closeImgBtn")?.addEventListener("click", () =>
    closeOverlay($("#imgOverlay")),
  );

  $("#imgOverlay")?.addEventListener("click", (e) => {
    if (e.target === $("#imgOverlay")) closeOverlay($("#imgOverlay"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay($("#imgOverlay"));
  });

  // รับ code จาก query
  const params = new URLSearchParams(location.search);
  const qCode = params.get("code");
  if (qCode) {
    $("#trackCode").value = qCode;
    fetchTrack(qCode);
  }
})();
