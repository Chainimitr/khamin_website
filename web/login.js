// web/login.js
const $ = (q) => document.querySelector(q);

function toast(msg) {
  const el = $("#toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

async function checkMe() {
  try {
    const r = await fetch("/api/me", {
      cache: "no-store",
      credentials: "include",
    });
    return await r.json();
  } catch {
    return { ok: true, isOfficer: false };
  }
}

function openLoginBox() {
  const box = $("#loginBox");
  const already = $("#alreadyBox");
  if (already) already.style.display = "none";
  if (box) box.classList.add("show");
  setTimeout(() => $("#username")?.focus(), 180);
}
function closeLoginBox() {
  $("#loginBox")?.classList.remove("show");
}

function setRole(role) {
  try {
    sessionStorage.setItem("role", role);
    sessionStorage.setItem("role_at", String(Date.now()));
  } catch {}
}
function clearRole() {
  try {
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("role_at");
  } catch {}
}

async function doLogin(username, password) {
  const hint = $("#loginHint");
  if (hint) hint.textContent = "กำลังเข้าสู่ระบบ...";

  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      if (hint) hint.textContent = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
      toast("เข้าสู่ระบบไม่สำเร็จ");
      return;
    }

    setRole("officer");
    toast("เข้าสู่ระบบสำเร็จ");
    location.href = "admin.html";
  } catch {
    if (hint) hint.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
    toast("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
}

async function logout() {
  try {
    await fetch("/api/logout", {
      method: "POST",
      cache: "no-store",
      credentials: "include",
    });
  } catch {}
  clearRole();
  toast("ออกจากระบบแล้ว");
  location.reload();
}

(async function init() {
  const me = await checkMe();

  if (me?.ok && me.isOfficer) {
    setRole("officer");
    const already = $("#alreadyBox");
    if (already) already.style.display = "block";
    $("#who").textContent = `เข้าสู่ระบบแล้ว: ${me.username || "เจ้าหน้าที่"}`;
    closeLoginBox();
  } else {
    closeLoginBox();
  }

  $("#btnCitizen")?.addEventListener("click", () => {
    setRole("citizen");
    location.href = "index.html";
  });

  $("#btnOfficer")?.addEventListener("click", () => {
    openLoginBox();
    toast("กรุณาเข้าสู่ระบบเจ้าหน้าที่");
  });

  $("#btnCloseLogin")?.addEventListener("click", closeLoginBox);

  $("#loginForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = $("#username")?.value?.trim();
    const password = $("#password")?.value?.trim();
    if (!username || !password) return toast("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
    doLogin(username, password);
  });

  $("#btnLogout")?.addEventListener("click", logout);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLoginBox();
  });
})();