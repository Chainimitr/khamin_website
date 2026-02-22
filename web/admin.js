// web/admin.js
const $ = (q) => document.querySelector(q);

let ALL = [];
let ACTIVE = null;

// เก็บ objectURL ของพรีวิว เพื่อ revoke ตอนล้าง/เปลี่ยนรายการ
let PREVIEW_URLS = [];

// ---------- helpers ----------
function el(tag, cls) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  return x;
}

function toast(msg) {
  const t = $("#toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
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

// ---------- file -> dataURL ----------
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// ---------- auth ----------
async function ensureOfficer() {
  try {
    const r = await fetch("/api/me", {
      cache: "no-store",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok || !j.isOfficer) {
      location.href = "login.html";
      return false;
    }
    $("#who").textContent = `เข้าสู่ระบบแล้ว: ${j.name || j.username || "เจ้าหน้าที่"}`;
    return true;
  } catch {
    location.href = "login.html";
    return false;
  }
}

// ---------- load ----------
async function loadAll() {
  const listHint = $("#listHint");
  const list = $("#list");
  const itemsEl = $("#items");

  if (listHint) listHint.textContent = "กำลังโหลดรายการ...";
  if (list) list.hidden = true;
  if (itemsEl) itemsEl.innerHTML = "";

  ALL = [];
  ACTIVE = null;

  if ($("#detailBox")) $("#detailBox").hidden = true;
  if ($("#detailHint")) {
    $("#detailHint").hidden = false;
    $("#detailHint").textContent = "ยังไม่ได้เลือกคำร้อง";
  }

  revokePreviewUrls();
  clearSelectedAfterFiles(false);

  try {
    const r = await fetch("/api/admin/petitions", {
      cache: "no-store",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));

    if (!r.ok || !j.ok) {
      if (listHint) listHint.textContent = "โหลดไม่ได้ (สิทธิ์ไม่ถูกต้อง)";
      return;
    }

    ALL = j.items || [];
    renderList();
  } catch {
    if (listHint) listHint.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
  }
}

// ---------- filter ----------
function filteredItems() {
  const q = ($("#q")?.value || "").trim().toLowerCase();
  const sf = $("#statusFilter")?.value || "";

  return (ALL || []).filter((it) => {
    if (sf && String(it.status) !== sf) return false;
    if (!q) return true;

    const hay = [
      it.code,
      it.village,
      it.topic,
      it.detail,
      it.status,
      it.lat,
      it.lng,
    ]
      .map((x) => String(x ?? "").toLowerCase())
      .join(" | ");

    return hay.includes(q);
  });
}

// ---------- list ----------
function renderList() {
  const items = filteredItems();
  const itemsEl = $("#items");
  const listHint = $("#listHint");
  const list = $("#list");

  if (!itemsEl) return;

  itemsEl.innerHTML = "";

  if (items.length === 0) {
    if (listHint) listHint.textContent = "ไม่พบรายการตามเงื่อนไข";
    if (list) list.hidden = true;
    return;
  }

  if (listHint) listHint.textContent = "";
  if (list) list.hidden = false;

  items.forEach((it) => {
    const card = el("button", "item-row");
    card.type = "button";
    card.innerHTML = `
      <div class="item-main">
        <div class="item-code"><b>${escapeHtml(it.code)}</b></div>
        <div class="item-sub muted">
          ${escapeHtml(it.village || "-")} • ${escapeHtml(it.topic || "-")}
        </div>
      </div>
      <div class="item-right">
        <div class="badge ${badgeTone(it.status)}">${escapeHtml(it.status || "-")}</div>
        <div class="muted small">${fmtTH(it.updatedAt)}</div>
      </div>
    `;
    card.addEventListener("click", () => selectItem(it.code));
    itemsEl.appendChild(card);
  });
}

// ---------- render thumbs ----------
function renderThumbs(containerEl, images, prefix) {
  if (!containerEl) return;

  containerEl.innerHTML = "";
  const arr = Array.isArray(images) ? images : [];

  if (arr.length === 0) {
    const hint = el("div", "muted");
    hint.style.padding = "10px 12px";
    hint.style.border = "1px dashed rgba(122, 77, 22, 0.25)";
    hint.style.borderRadius = "12px";
    hint.style.background = "rgba(255, 197, 51, 0.08)";
    hint.textContent = "— ไม่มีรูป —";
    containerEl.appendChild(hint);
    return;
  }

  arr.forEach((src, idx) => {
    const t = el("div", "thumb");
    t.innerHTML = `
      <img src="${src}" alt="${prefix}-${idx}">
      <div class="cap">${prefix} #${idx + 1}</div>
    `;
    t.addEventListener("click", () =>
      openLightbox(src, `${prefix} #${idx + 1}`),
    );
    containerEl.appendChild(t);
  });
}

// ---------- select detail ----------
async function selectItem(code) {
  try {
    const r = await fetch(`/api/admin/petitions/${encodeURIComponent(code)}`, {
      cache: "no-store",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      alert(j.message || "โหลดรายละเอียดไม่สำเร็จ");
      return;
    }

    const it = j.item;
    ACTIVE = it;

    if ($("#detailHint")) $("#detailHint").hidden = true;
    if ($("#detailBox")) $("#detailBox").hidden = false;

    const detailUI = $("#detailUI");
    if (detailUI) {
      detailUI.innerHTML = `
        <div class="kv">
          <div class="k">เลขคำร้อง</div><div class="v"><b>${escapeHtml(it.code)}</b></div>
          <div class="k">สถานะ</div><div class="v"><span class="badge ${badgeTone(it.status)}">${escapeHtml(it.status)}</span></div>
          <div class="k">หมู่บ้าน</div><div class="v">${escapeHtml(it.village)}</div>
          <div class="k">ประเภท</div><div class="v">${escapeHtml(it.topic)}</div>
          <div class="k">พิกัด</div><div class="v">${escapeHtml(it.lat)}, ${escapeHtml(it.lng)}</div>
          <div class="k">อัปเดตล่าสุด</div><div class="v">${fmtTH(it.updatedAt)}</div>
          <div class="k">รายละเอียด</div><div class="v">${escapeHtml(it.detail)}</div>
        </div>
      `;
    }

    renderThumbs($("#beforeUI"), it.imagesBefore || [], "ก่อน");
    renderThumbs($("#afterSavedUI"), it.imagesAfter || [], "หลัง");

    revokePreviewUrls();
    clearSelectedAfterFiles(false);

    renderTimeline(it.timeline || []);

    if ($("#newStatus")) $("#newStatus").value = it.status || "รับเรื่องแล้ว";
    if ($("#note")) $("#note").value = "";
    if ($("#officer")) $("#officer").value = "";
  } catch {
    alert("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
}

// ---------- timeline ----------
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
    const row = el("div", "t-row");
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

// ---------- update status ----------
async function updateStatus() {
  if (!ACTIVE) return;

  const activeCode = ACTIVE.code;
  const status = $("#newStatus")?.value;
  const officer = ($("#officer")?.value || "").trim();
  const noteText = ($("#note")?.value || "").trim();
  const note =
    (officer ? `ผู้ดำเนินการ: ${officer}\n` : "") + (noteText ? noteText : "");

  try {
    const r = await fetch(
      `/api/admin/petitions/${encodeURIComponent(activeCode)}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ status, note }),
      },
    );

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      alert(j.message || "บันทึกไม่สำเร็จ (ตรวจสอบสิทธิ์หรือเซิร์ฟเวอร์)");
      return;
    }

    await loadAll();
    await selectItem(activeCode);
    toast("อัปเดตสถานะเรียบร้อย");
  } catch (e) {
    alert(e?.message || "เกิดข้อผิดพลาดหลังอัปเดต");
  }
}

// ---------- after images: preview selected ----------
function revokePreviewUrls() {
  for (const u of PREVIEW_URLS) {
    try {
      URL.revokeObjectURL(u);
    } catch {}
  }
  PREVIEW_URLS = [];
}

function clearSelectedAfterFiles(showToast = true) {
  const input = $("#afterImages");
  const prev = $("#afterPreview");
  if (input) input.value = "";
  if (prev) prev.innerHTML = `<div class="muted">— ยังไม่ได้เลือกรูป —</div>`;
  if (showToast) toast("ล้างรูปที่เลือกแล้ว");
}

function previewSelectedAfterFiles() {
  const input = $("#afterImages");
  const prev = $("#afterPreview");
  if (!input || !prev) return;

  revokePreviewUrls();

  const files = Array.from(input.files || []).filter((f) =>
    f.type.startsWith("image/"),
  );

  prev.innerHTML = "";
  if (files.length === 0) {
    prev.innerHTML = `<div class="muted">— ยังไม่ได้เลือกรูป —</div>`;
    return;
  }

  files.slice(0, 8).forEach((f, idx) => {
    const url = URL.createObjectURL(f);
    PREVIEW_URLS.push(url);

    const t = el("div", "thumb");
    t.innerHTML = `
      <img src="${url}" alt="selected-${idx}">
      <div class="cap">${escapeHtml(f.name)}</div>
    `;
    t.addEventListener("click", () =>
      openLightbox(url, `ไฟล์ที่เลือก #${idx + 1}`),
    );
    prev.appendChild(t);
  });

  toast(`เลือกรูปแล้ว ${Math.min(files.length, 8)} ไฟล์`);
}

// ---------- after images: save to server ----------
async function saveAfterImages() {
  if (!ACTIVE) return;

  const activeCode = ACTIVE.code;

  const input = $("#afterImages");
  const files = Array.from(input?.files || []).filter((f) =>
    f.type.startsWith("image/"),
  );

  if (files.length === 0) {
    alert("กรุณาเลือกไฟล์รูปหลังดำเนินการ");
    return;
  }

  const btn = $("#saveAfterBtn");

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "กำลังบันทึก...";
    }

    const imagesAfter = [];
    for (const f of files.slice(0, 8)) {
      const dataUrl = await fileToDataURL(f);
      imagesAfter.push(dataUrl);
    }

    const r = await fetch(
      `/api/admin/petitions/${encodeURIComponent(activeCode)}/after-images`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ imagesAfter }),
      },
    );

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      alert(j.message || "อัปโหลดรูปไม่สำเร็จ");
      return;
    }

    toast("บันทึกรูปหลังดำเนินการแล้ว");

    await loadAll();
    await selectItem(activeCode);

    revokePreviewUrls();
    clearSelectedAfterFiles(false);
  } catch (e) {
    alert(e?.message || "เกิดข้อผิดพลาดหลังบันทึกรูป");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "บันทึกรูปหลังดำเนินการ";
    }
  }
}

// ---------- delete ----------
async function deletePetition() {
  if (!ACTIVE) return;

  const ok = confirm(`ต้องการลบคำร้อง ${ACTIVE.code} ใช่หรือไม่?`);
  if (!ok) return;

  try {
    const r = await fetch(
      `/api/admin/petitions/${encodeURIComponent(ACTIVE.code)}`,
      {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      },
    );

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      alert(j.message || "ลบไม่สำเร็จ");
      return;
    }

    toast("ลบคำร้องเรียบร้อย");
    await loadAll();
  } catch {
    alert("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
}

// ---------- logout ----------
async function logout() {
  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
  } catch {}
  location.href = "login.html";
}

// ---------- bind ----------
function bindEvents() {
  $("#searchBtn")?.addEventListener("click", loadAll);
  $("#q")?.addEventListener("input", renderList);
  $("#statusFilter")?.addEventListener("change", renderList);

  $("#updateBtn")?.addEventListener("click", updateStatus);
  $("#deleteBtn")?.addEventListener("click", deletePetition);
  $("#logoutBtn")?.addEventListener("click", logout);

  $("#afterImages")?.addEventListener("change", previewSelectedAfterFiles);
  $("#clearAfterBtn")?.addEventListener("click", () => {
    revokePreviewUrls();
    clearSelectedAfterFiles(true);
  });
  $("#saveAfterBtn")?.addEventListener("click", saveAfterImages);

  $("#closeImgBtn")?.addEventListener("click", closeLightbox);
  $("#imgOverlay")?.addEventListener("click", (e) => {
    if (e.target === $("#imgOverlay")) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
}

// ---------- init ----------
(async function init() {
  const ok = await ensureOfficer();
  if (!ok) return;

  bindEvents();
  loadAll();
})();