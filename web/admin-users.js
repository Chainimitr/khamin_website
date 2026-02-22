// web/admin-users.js
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

let USERS = [];
let ACTIVE = null;

function setBusy(id, busy, textBusy) {
  const btn = $(id);
  if (!btn) return;
  btn.disabled = !!busy;
  if (textBusy != null)
    btn.textContent = busy ? textBusy : btn.dataset.label || btn.textContent;
}

async function ensureSuperAdmin() {
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

    $("#who").textContent =
      `เข้าสู่ระบบแล้ว: ${j.name || j.username || "เจ้าหน้าที่"}`;

    if (!j.isSuper) {
      alert("หน้านี้ให้สิทธิ์เฉพาะแอดมินหลัก (Super Admin) เท่านั้น");
      location.href = "admin.html";
      return false;
    }

    return true;
  } catch {
    location.href = "login.html";
    return false;
  }
}

function renderUsers() {
  const listHint = $("#listHint");
  const box = $("#usersBox");
  const list = $("#usersList");

  if (!list) return;
  list.innerHTML = "";

  if (!USERS.length) {
    if (listHint) listHint.textContent = "ยังไม่มีผู้ใช้";
    if (box) box.hidden = true;
    return;
  }

  if (listHint) listHint.textContent = "";
  if (box) box.hidden = false;

  USERS.forEach((u) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.style.alignItems = "center";
    row.innerHTML = `
      <div class="item-main">
        <div class="item-code">
          <b>${escapeHtml(u.username)}</b> ${u.isSuper ? "⭐" : ""}
        </div>
        <div class="item-sub muted">${escapeHtml(u.name || "-")}</div>
      </div>
      <div class="item-right" style="display:flex; gap:8px; align-items:center; justify-content:flex-end;">
        <button class="btn small ghost" type="button" data-act="edit">จัดการ</button>
      </div>
    `;

    row.querySelector('[data-act="edit"]').addEventListener("click", () => {
      openEditor(u.username);
    });

    list.appendChild(row);
  });
}

function openEditor(username) {
  ACTIVE = USERS.find((x) => x.username === username) || null;
  if (!ACTIVE) return;

  $("#editBox").hidden = false;
  $("#editUsername").value = ACTIVE.username;
  $("#editName").value = ACTIVE.name || "";
  $("#editPassword").value = "";
  $("#editHint").textContent = "";

  const delBtn = $("#deleteBtn");
  if (delBtn) delBtn.disabled = !!ACTIVE.isSuper;
  if (ACTIVE.isSuper) $("#editHint").textContent = "⭐ บัญชีนี้เป็นแอดมินหลัก (ห้ามลบ)";
}

function closeEditor() {
  ACTIVE = null;
  $("#editBox").hidden = true;
  $("#editUsername").value = "";
  $("#editName").value = "";
  $("#editPassword").value = "";
  $("#editHint").textContent = "";
}

async function loadUsers() {
  $("#listHint").textContent = "กำลังโหลด...";
  $("#usersBox").hidden = true;

  setBusy("#reloadBtn", true, "กำลังโหลด...");
  try {
    const r = await fetch("/api/admin/users", {
      cache: "no-store",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));

    if (!r.ok || !j.ok) {
      const msg =
        j.message ||
        (r.status === 401
          ? "ยังไม่ได้เข้าสู่ระบบ"
          : r.status === 403
            ? "ไม่มีสิทธิ์เข้าหน้านี้"
            : "โหลดรายการไม่ได้");
      $("#listHint").textContent = msg;
      return;
    }

    USERS = j.users || [];
    renderUsers();
  } catch {
    $("#listHint").textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
  } finally {
    setBusy("#reloadBtn", false);
  }
}

async function createUser() {
  const u = ($("#newUsername").value || "").trim();
  const p = ($("#newPassword").value || "").trim();
  const n = ($("#newName").value || "").trim();

  $("#createHint").textContent = "";

  if (!u || !p) {
    $("#createHint").textContent = "กรุณากรอก username และ password";
    toast("กรุณากรอก username และ password");
    return;
  }

  setBusy("#createBtn", true, "กำลังเพิ่ม...");
  try {
    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ username: u, password: p, name: n }),
    });
    const j = await r.json().catch(() => ({}));

    if (!r.ok || !j.ok) {
      $("#createHint").textContent = j.message || "เพิ่มผู้ใช้ไม่สำเร็จ";
      toast("เพิ่มผู้ใช้ไม่สำเร็จ");
      return;
    }

    $("#newUsername").value = "";
    $("#newPassword").value = "";
    $("#newName").value = "";

    toast("เพิ่มผู้ใช้แล้ว");
    await loadUsers();
  } catch {
    $("#createHint").textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
    toast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  } finally {
    setBusy("#createBtn", false);
  }
}

async function saveUser() {
  if (!ACTIVE) return;

  const username = ACTIVE.username;
  const name = ($("#editName").value || "").trim();
  const password = ($("#editPassword").value || "").trim();

  $("#editHint").textContent = "กำลังบันทึก...";
  setBusy("#saveBtn", true, "กำลังบันทึก...");

  try {
    const payload = { name };
    if (password) payload.password = password;

    const r = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify(payload),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      $("#editHint").textContent = j.message || "บันทึกไม่สำเร็จ";
      toast("บันทึกไม่สำเร็จ");
      return;
    }

    $("#editHint").textContent = "";
    toast("บันทึกแล้ว");

    await loadUsers();
    openEditor(username);
  } catch {
    $("#editHint").textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
    toast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  } finally {
    setBusy("#saveBtn", false);
  }
}

async function deleteUser() {
  if (!ACTIVE) return;
  if (ACTIVE.isSuper) return;

  const ok = confirm(`ต้องการลบผู้ใช้ "${ACTIVE.username}" ใช่หรือไม่?`);
  if (!ok) return;

  $("#editHint").textContent = "กำลังลบ...";
  setBusy("#deleteBtn", true, "กำลังลบ...");

  try {
    const r = await fetch(`/api/admin/users/${encodeURIComponent(ACTIVE.username)}`, {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      $("#editHint").textContent = j.message || "ลบไม่สำเร็จ";
      toast("ลบไม่สำเร็จ");
      return;
    }

    toast("ลบผู้ใช้แล้ว");
    closeEditor();
    await loadUsers();
  } catch {
    $("#editHint").textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
    toast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  } finally {
    setBusy("#deleteBtn", false);
  }
}

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

(async function init() {
  const ok = await ensureSuperAdmin();
  if (!ok) return;

  ["#createBtn", "#reloadBtn", "#saveBtn", "#deleteBtn"].forEach((id) => {
    const el = $(id);
    if (el) el.dataset.label = el.textContent;
  });

  $("#createBtn")?.addEventListener("click", createUser);
  $("#reloadBtn")?.addEventListener("click", loadUsers);

  $("#saveBtn")?.addEventListener("click", saveUser);
  $("#deleteBtn")?.addEventListener("click", deleteUser);
  $("#cancelBtn")?.addEventListener("click", closeEditor);

  $("#logoutBtn")?.addEventListener("click", logout);

  await loadUsers();
})();