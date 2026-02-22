// web/index.js
const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));

function toast(msg) {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function openOverlay(el) { el?.classList.add("show"); }
function closeOverlay(el) { el?.classList.remove("show"); }

// หมู่บ้าน (แก้ได้ตามจริง)
const villages = [
  "หมู่ที่1 บ้านดงมะไฟ","หมู่ที่2 บ้านขมิ้น","หมู่ที่3 บ้านผักขะย่า","หมู่ที่4 บ้านโคกเลาะ",
  "หมู่ที่5 บ้านโคกเลาะน้อย","หมู่ที่6 บ้านโพนบก","หมู่ที่7 บ้านน้อยหัวคู","หมู่ที่8 บ้านพาน",
  "หมู่ที่9 บ้านประชาสุขสันต์","หมู่ที่10 บ้านพานพัฒนา","หมู่ที่11 บ้านนาเรือง",
  "หมู่ที่12 บ้านดงมะไฟพัฒนา","หมู่ที่13 บ้านดงมะไฟสามัคคี","หมู่ที่14 บ้านโคกเลาะกลาง",
];

function renderVillageChoices() {
  const grid = $("#villageGrid");
  if (!grid) return;
  grid.innerHTML = "";

  villages.forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice";
    btn.textContent = name;
    btn.addEventListener("click", () => {
      $("#village").value = name;
      closeOverlay($("#villageOverlay"));
      toast("เลือกหมู่บ้านแล้ว");
    });
    grid.appendChild(btn);
  });
}

// รูปแนบก่อนดำเนินการ
const inputImages = $("#imagesBefore");
const thumbs = $("#thumbs");
const imgOverlay = $("#imgOverlay");
const imgBig = $("#imgBig");

let imageStore = [];

function rebuildThumbs() {
  if (!thumbs) return;
  thumbs.innerHTML = "";

  if (imageStore.length === 0) {
    thumbs.innerHTML = `<div class="muted">ยังไม่มีรูปแนบ</div>`;
    return;
  }

  imageStore.forEach(({ file, url }, idx) => {
    const box = document.createElement("div");
    box.className = "thumb";
    box.innerHTML = `
      <img src="${url}" alt="รูปแนบคำร้อง">
      <div class="cap">${file.name}</div>
    `;
    box.addEventListener("click", () => openImageModal(idx));
    thumbs.appendChild(box);
  });
}

function addFiles(files) {
  const arr = Array.from(files || []);
  const imgs = arr.filter((f) => f.type.startsWith("image/"));

  if (imgs.length === 0) {
    toast("ไฟล์ที่เลือกไม่ใช่รูปภาพ");
    return;
  }

  imgs.forEach((file) => {
    const url = URL.createObjectURL(file);
    imageStore.push({ file, url });
  });

  rebuildThumbs();
  toast(`แนบรูปแล้ว ${imgs.length} ไฟล์`);
}

function clearAllImages() {
  imageStore.forEach((x) => URL.revokeObjectURL(x.url));
  imageStore = [];
  if (inputImages) inputImages.value = "";
  rebuildThumbs();
  toast("ล้างรูปทั้งหมดแล้ว");
}

function openImageModal(idx) {
  const item = imageStore[idx];
  if (!item) return;
  if (imgBig) imgBig.src = item.url;
  openOverlay(imgOverlay);
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function buildImagesBeforeDataURLs() {
  const files = imageStore.slice(0, 8).map((x) => x.file);
  const out = [];
  for (const f of files) out.push(await fileToDataURL(f));
  return out;
}

// แผนที่ Leaflet
let MAP = null;
let MARKER = null;

function initMap() {
  const latEl = $("#lat");
  const lngEl = $("#lng");
  if (!latEl || !lngEl) return;

  if (typeof L === "undefined") {
    toast("โหลดแผนที่ไม่สำเร็จ (Leaflet ไม่ทำงาน)");
    return;
  }

  const defaultCenter = [17.1546, 104.1348];
  MAP = L.map("map").setView(defaultCenter, 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(MAP);

  function setMarker(lat, lng) {
    const pos = [lat, lng];

    if (!MARKER) {
      MARKER = L.marker(pos, { draggable: true }).addTo(MAP);

      MARKER.on("dragend", () => {
        const p = MARKER.getLatLng();
        latEl.value = p.lat.toFixed(6);
        lngEl.value = p.lng.toFixed(6);
        toast("อัปเดตพิกัดจากการลากหมุดแล้ว");
      });
    } else {
      MARKER.setLatLng(pos);
    }

    latEl.value = lat.toFixed(6);
    lngEl.value = lng.toFixed(6);
  }

  MAP.on("click", (e) => {
    setMarker(e.latlng.lat, e.latlng.lng);
    toast("ปักหมุดแล้ว");
  });

  $("#btnUseMyLocation")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      toast("อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        MAP.setView([lat, lng], 16);
        setMarker(lat, lng);
        toast("ใช้ตำแหน่งปัจจุบันแล้ว");
      },
      () => toast("ไม่สามารถเข้าถึงตำแหน่งได้ (อาจไม่ได้อนุญาต)"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });

  $("#btnReset")?.addEventListener("click", () => {
    setTimeout(() => {
      $("#village").value = "";
      latEl.value = "";
      lngEl.value = "";

      if (MARKER && MAP) {
        MAP.removeLayer(MARKER);
        MARKER = null;
      }

      clearAllImages();
      $("#submitHint").textContent = "";
      toast("ล้างฟอร์มแล้ว");
    }, 0);
  });
}

// popup สำเร็จ
function showSuccessPopup(code) {
  const overlay = document.createElement("div");
  overlay.className = "overlay show";
  overlay.style.zIndex = "99999";

  overlay.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div class="modal-head">
        <strong>ส่งคำร้องสำเร็จ 🎉</strong>
        <button class="btn small" type="button" id="closeSuccessBtn">ปิด</button>
      </div>
      <div class="modal-body" style="text-align:center">
        <div style="font-size:60px; margin:10px 0">✅</div>
        <div style="font-size:16px; font-weight:900; color:#5b3a12">
          เลขคำร้องของคุณคือ
        </div>
        <div style="font-size:22px; font-weight:900; margin-top:10px">
          ${code}
        </div>

        <div class="muted" style="margin-top:10px">
          กรุณาจดเลขนี้ไว้ เพื่อติดตามสถานะ
        </div>

        <div class="footer-actions" style="justify-content:center; margin-top:14px">
          <a class="btn primary" href="track.html?code=${encodeURIComponent(code)}">ไปหน้าติดตามทันที</a>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#closeSuccessBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// ส่งคำร้องไป server
async function submitPetition() {
  const village = $("#village").value.trim();
  const topic = $("#topic").value.trim();
  const detail = $("#detail").value.trim();
  const lat = $("#lat").value.trim();
  const lng = $("#lng").value.trim();

  if (!village || !topic || !detail) {
    toast("กรุณากรอกข้อมูลให้ครบ");
    return;
  }
  if (!lat || !lng) {
    toast("กรุณาปักหมุดพิกัดบนแผนที่ก่อนส่ง");
    return;
  }

  const payload = {
    village,
    topic,
    detail,
    lat,
    lng,
    imagesBefore: await buildImagesBeforeDataURLs(),
  };

  $("#submitHint").textContent = "กำลังส่งคำร้อง...";
  $("#submitHint").style.fontWeight = "800";

  try {
    const r = await fetch("/api/petitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok || !j.ok) {
      $("#submitHint").textContent = "";
      alert(`ส่งคำร้องไม่สำเร็จ ❌\n\n${j.message || j.error || "unknown_error"}`);
      return;
    }

    $("#submitHint").textContent = `ส่งสำเร็จ เลขคำร้อง: ${j.code}`;
    toast("ส่งคำร้องสำเร็จ");
    showSuccessPopup(j.code);

    $("#petitionForm").reset();
    clearAllImages();
    $("#lat").value = "";
    $("#lng").value = "";

    if (MARKER && MAP) {
      MAP.removeLayer(MARKER);
      MARKER = null;
    }
  } catch (e) {
    console.error(e);
    $("#submitHint").textContent = "";
    toast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
}

// init
(function init() {
  renderVillageChoices();

  $("#btnPickVillage")?.addEventListener("click", () => openOverlay($("#villageOverlay")));

  $$("[data-close]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.close;
      closeOverlay(document.getElementById(id));
    });
  });

  [$("#villageOverlay"), $("#imgOverlay")].forEach((ov) => {
    if (!ov) return;
    ov.addEventListener("click", (e) => { if (e.target === ov) closeOverlay(ov); });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeOverlay($("#villageOverlay"));
      closeOverlay($("#imgOverlay"));
    }
  });

  inputImages?.addEventListener("change", (e) => addFiles(e.target.files));
  $("#btnClearImages")?.addEventListener("click", clearAllImages);

  $("#petitionForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitPetition();
  });

  window.addEventListener("load", () => {
    rebuildThumbs();
    initMap();
  });
})();