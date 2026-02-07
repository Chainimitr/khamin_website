// server/server.js
const path = require("path");
const fs = require("fs");
const express = require("express");
const cookieSignature = require("cookie-signature");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ ตรวจว่าอยู่บน Vercel ไหม
const IS_VERCEL = !!process.env.VERCEL;

// ✅ ต้องมี secret เพื่อเซ็นคุกกี้ (ตั้งใน Vercel Env)
const APP_SECRET = process.env.APP_SECRET || "dev_secret_change_me";

// ✅ สำคัญมากสำหรับ Vercel/Proxy (ทำให้ Secure cookie ทำงานถูก)
app.set("trust proxy", 1);

// ---- paths ----
const WEB_DIR = path.join(__dirname, "..", "web");

// ✅ บน Vercel เขียนไฟล์ในโปรเจกต์ไม่ได้ ต้องใช้ /tmp
const DATA_DIR = IS_VERCEL ? "/tmp/khamin-data" : path.join(__dirname, "data");

const PETITIONS_FILE = path.join(DATA_DIR, "petitions.json");
const ADMINS_FILE = path.join(DATA_DIR, "admins.json");

// ✅ กำหนดชื่อ Super Admin ตามที่ต้องการ
const SUPER_USERNAME = "Chainimitr";

// ✅ กันโปรเซสล้มเงียบ
process.on("uncaughtException", (err) =>
  console.error("❌ uncaughtException:", err),
);
process.on("unhandledRejection", (err) =>
  console.error("❌ unhandledRejection:", err),
);

// ---- middleware ----
app.use(express.json({ limit: "60mb" }));
app.use(express.urlencoded({ extended: true, limit: "60mb" }));

// ✅ log ทุก request
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - t0}ms)`,
    );
  });
  next();
});

// กัน API cache
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});

// ✅ เสิร์ฟเว็บ (static) + ตั้ง index ให้เป็น login.html
app.use(express.static(WEB_DIR, { index: "login.html" }));

// ---- cookie utils ----
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const parts = header
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);

  const out = {};
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = decodeURIComponent(p.slice(0, idx).trim());
    const v = decodeURIComponent(p.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const {
    httpOnly = true,
    sameSite = "Lax",
    maxAgeSeconds = 60 * 60 * 6,
    path = "/",
  } = opts;

  const seg = [];
  seg.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  seg.push(`Path=${path}`);
  seg.push(`Max-Age=${maxAgeSeconds}`);
  seg.push(`SameSite=${sameSite}`);

  // ✅ บน vercel เป็น https แนะนำใส่ Secure
  if (IS_VERCEL) seg.push("Secure");

  if (httpOnly) seg.push("HttpOnly");
  res.setHeader("Set-Cookie", seg.join("; "));
}

function clearCookie(res, name) {
  const seg = [];
  seg.push(`${encodeURIComponent(name)}=`);
  seg.push("Path=/");
  seg.push("Max-Age=0");
  seg.push("SameSite=Lax");
  if (IS_VERCEL) seg.push("Secure");
  seg.push("HttpOnly");
  res.setHeader("Set-Cookie", seg.join("; "));
}

// ---- signed session cookie helpers (แทน Map) ----
function signValue(str) {
  // cookie-signature.sign จะคืนค่าเป็น "<value>.<sig>"
  // เรา prefix ด้วย "s:" เพื่อบอกว่าเป็น signed cookie
  return "s:" + cookieSignature.sign(str, APP_SECRET);
}

function unsignValue(signed) {
  if (!signed) return null;
  if (!signed.startsWith("s:")) return null;
  const raw = signed.slice(2);
  const unsigned = cookieSignature.unsign(raw, APP_SECRET);
  return unsigned || null;
}

// payload: { u, n, o, s, exp }  (username, displayName, isOfficer, isSuper, expireMs)
function setSessionCookie(res, payload) {
  const json = JSON.stringify(payload);
  const signed = signValue(json);

  const COOKIE_NAME = "khamin_session";
  setCookie(res, COOKIE_NAME, signed, {
    maxAgeSeconds: 60 * 60 * 6,
    sameSite: "Lax",
    httpOnly: true,
    path: "/",
  });
}

function clearSessionCookie(res) {
  const COOKIE_NAME = "khamin_session";
  clearCookie(res, COOKIE_NAME);
}

function getSession(req) {
  const cookies = parseCookies(req);
  const signed = cookies.khamin_session;
  const raw = unsignValue(signed);
  if (!raw) return null;

  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;

    // exp เป็น epoch ms
    if (!p.exp || Date.now() > Number(p.exp)) return null;

    return {
      username: p.u,
      displayName: p.n,
      isOfficer: !!p.o,
      isSuper: !!p.s,
      exp: Number(p.exp),
    };
  } catch {
    return null;
  }
}

// ---- admins data helpers ----
function ensureAdminsFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(ADMINS_FILE)) {
    const seed = {
      users: [
        {
          username: SUPER_USERNAME,
          password: "1234",
          name: "แอดมินหลัก",
        },
      ],
    };
    fs.writeFileSync(ADMINS_FILE, JSON.stringify(seed, null, 2), "utf-8");
  }
}

function readAdmins() {
  ensureAdminsFile();
  try {
    const raw = fs.readFileSync(ADMINS_FILE, "utf-8");
    const j = JSON.parse(raw || "{}");
    if (!j.users || !Array.isArray(j.users)) j.users = [];
    return j;
  } catch {
    return { users: [] };
  }
}

function writeAdmins(j) {
  ensureAdminsFile();
  fs.writeFileSync(ADMINS_FILE, JSON.stringify(j, null, 2), "utf-8");
}

// ---- guards ----
function requireOfficer(req, res, next) {
  const s = getSession(req);
  if (!s || !s.isOfficer) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  req.user = s;
  next();
}

function requireSuperAdmin(req, res, next) {
  const s = getSession(req);
  if (!s || !s.isOfficer) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  if (String(s.username || "") !== SUPER_USERNAME) {
    return res.status(403).json({
      ok: false,
      error: "forbidden",
      message: `หน้านี้ให้สิทธิ์เฉพาะ super admin (${SUPER_USERNAME})`,
    });
  }

  req.user = s;
  next();
}

// ---- petitions helpers ----
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PETITIONS_FILE)) {
    fs.writeFileSync(
      PETITIONS_FILE,
      JSON.stringify({ items: [] }, null, 2),
      "utf-8",
    );
  }
}

function readPetitions() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(PETITIONS_FILE, "utf-8");
    if (!raw.trim()) return { items: [] };
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return { items: [] };
    if (!Array.isArray(j.items)) j.items = [];
    return j;
  } catch {
    fs.writeFileSync(
      PETITIONS_FILE,
      JSON.stringify({ items: [] }, null, 2),
      "utf-8",
    );
    return { items: [] };
  }
}

function writePetitions(j) {
  ensureDataFile();
  fs.writeFileSync(PETITIONS_FILE, JSON.stringify(j, null, 2), "utf-8");
}

function nextCode(items) {
  const y = new Date().getFullYear();
  const inYear = (items || []).filter((x) =>
    String(x.code || "").includes(`SKN-${y}-`),
  );
  const n = inYear.length + 1;
  const serial = String(n).padStart(6, "0");
  return `SKN-${y}-${serial}`;
}

// ---- pages ----
app.get("/", (req, res) => res.redirect("/login.html"));
app.get("/api/ping", (req, res) =>
  res.json({ ok: true, time: new Date().toISOString(), vercel: IS_VERCEL }),
);

// ---- auth ----
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const u = String(username || "").trim();
  const p = String(password || "").trim();

  const db = readAdmins();
  const found = (db.users || []).find(
    (x) => String(x.username) === u && String(x.password) === p,
  );

  if (!found) {
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }

  const isSuper = String(found.username) === SUPER_USERNAME;

  // ✅ เซ็ต session เป็น signed cookie
  const exp = Date.now() + 1000 * 60 * 60 * 6;
  setSessionCookie(res, {
    u: found.username,
    n: found.name || found.username,
    o: true,
    s: isSuper,
    exp,
  });

  return res.json({
    ok: true,
    isOfficer: true,
    username: found.username,
    name: found.name || found.username,
    isSuper,
  });
});

app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const s = getSession(req);
  if (!s) return res.json({ ok: true, isOfficer: false });

  res.json({
    ok: true,
    isOfficer: !!s.isOfficer,
    username: s.username,
    name: s.displayName || s.username,
    isSuper: !!s.isSuper,
  });
});

// ---- citizen submit ----
app.post("/api/petitions", (req, res) => {
  try {
    const { village, topic, detail, lat, lng, imagesBefore } = req.body || {};
    const v = String(village ?? "").trim();
    const t = String(topic ?? "").trim();
    const d = String(detail ?? "").trim();
    const la = String(lat ?? "").trim();
    const ln = String(lng ?? "").trim();

    if (!v || !t || !d || !la || !ln) {
      return res.status(400).json({
        ok: false,
        error: "missing_fields",
        message:
          "กรุณากรอกข้อมูลให้ครบ (หมู่บ้าน/ประเภท/รายละเอียด/ปักหมุดพิกัด)",
      });
    }

    const db = readPetitions();
    const code = nextCode(db.items);

    const nowISO = new Date().toISOString();
    const nowTH = new Date().toLocaleString("th-TH");
    const before = Array.isArray(imagesBefore) ? imagesBefore.slice(0, 8) : [];

    const item = {
      code,
      village: v,
      topic: t,
      detail: d,
      lat: la,
      lng: ln,
      status: "รับเรื่องแล้ว",
      createdAt: nowISO,
      updatedAt: nowISO,
      imagesBefore: before,
      imagesAfter: [],
      timeline: [
        {
          title: "รับเรื่องแล้ว",
          time: nowTH,
          note: "ระบบรับคำร้องเรียบร้อย",
        },
      ],
    };

    db.items.unshift(item);
    writePetitions(db);
    return res.json({ ok: true, code });
  } catch (err) {
    console.error("❌ POST /api/petitions ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
});

// ---- citizen track ----
app.get("/api/track/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const db = readPetitions();
  const item = db.items.find(
    (x) => String(x.code || "").toUpperCase() === code,
  );
  if (!item) return res.status(404).json({ ok: false, error: "not_found" });

  res.json({
    ok: true,
    item: {
      code: item.code,
      village: item.village,
      topic: item.topic,
      detail: item.detail,
      lat: item.lat,
      lng: item.lng,
      status: item.status,
      updatedAt: item.updatedAt,
      timeline: item.timeline || [],
      imagesBefore: item.imagesBefore || [],
      imagesAfter: item.imagesAfter || [],
    },
  });
});

// ---- admin petitions ----
app.get("/api/admin/petitions", requireOfficer, (req, res) => {
  const db = readPetitions();
  res.json({ ok: true, items: db.items });
});

app.patch("/api/admin/petitions/:code/status", requireOfficer, (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const { status, note } = req.body || {};

  const db = readPetitions();
  const idx = db.items.findIndex(
    (x) => String(x.code || "").toUpperCase() === code,
  );
  if (idx < 0) return res.status(404).json({ ok: false, error: "not_found" });

  const nowISO = new Date().toISOString();
  const nowTH = new Date().toLocaleString("th-TH");

  db.items[idx].status = String(status || db.items[idx].status);
  db.items[idx].updatedAt = nowISO;

  if (!Array.isArray(db.items[idx].timeline)) db.items[idx].timeline = [];
  db.items[idx].timeline.push({
    title: db.items[idx].status,
    time: nowTH,
    note: note ? String(note) : "",
  });

  writePetitions(db);
  res.json({ ok: true });
});

app.patch(
  "/api/admin/petitions/:code/after-images",
  requireOfficer,
  (req, res) => {
    const code = String(req.params.code || "").toUpperCase();
    const { imagesAfter } = req.body || {};

    const db = readPetitions();
    const idx = db.items.findIndex(
      (x) => String(x.code || "").toUpperCase() === code,
    );
    if (idx < 0) return res.status(404).json({ ok: false, error: "not_found" });

    if (!Array.isArray(imagesAfter)) {
      return res.status(400).json({
        ok: false,
        error: "imagesAfter_must_be_array",
        message: "imagesAfter ต้องเป็น array",
      });
    }

    db.items[idx].imagesAfter = imagesAfter.slice(0, 8);
    db.items[idx].updatedAt = new Date().toISOString();
    writePetitions(db);
    res.json({ ok: true });
  },
);

app.delete("/api/admin/petitions/:code", requireOfficer, (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const db = readPetitions();
  const before = db.items.length;

  db.items = db.items.filter(
    (x) => String(x.code || "").toUpperCase() !== code,
  );
  if (db.items.length === before)
    return res.status(404).json({ ok: false, error: "not_found" });

  writePetitions(db);
  res.json({ ok: true });
});

// ---- admin users ----
app.get("/api/admin/users", requireSuperAdmin, (req, res) => {
  const db = readAdmins();
  const users = (db.users || []).map((u) => ({
    username: u.username,
    name: u.name || "",
    isSuper: String(u.username) === SUPER_USERNAME,
  }));
  res.json({ ok: true, users });
});

app.post("/api/admin/users", requireSuperAdmin, (req, res) => {
  const { username, password, name } = req.body || {};
  const u = String(username || "").trim();
  const p = String(password || "").trim();
  const n = String(name || "").trim();

  if (!u || !p) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      message: "ต้องกรอก username และ password",
    });
  }

  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(u)) {
    return res.status(400).json({
      ok: false,
      error: "bad_username",
      message: "username ต้องเป็น a-z A-Z 0-9 . _ - และยาว 3-30 ตัว",
    });
  }

  if (u.toLowerCase() === SUPER_USERNAME.toLowerCase()) {
    return res.status(400).json({
      ok: false,
      error: "reserved_username",
      message: `ชื่อผู้ใช้นี้ถูกสงวนไว้สำหรับ super admin (${SUPER_USERNAME})`,
    });
  }

  const db = readAdmins();
  const exists = (db.users || []).some(
    (x) => String(x.username).toLowerCase() === u.toLowerCase(),
  );
  if (exists) {
    return res.status(409).json({
      ok: false,
      error: "username_exists",
      message: "มี username นี้แล้ว",
    });
  }

  db.users.push({ username: u, password: p, name: n });
  writeAdmins(db);

  res.json({ ok: true });
});

app.patch("/api/admin/users/:username", requireSuperAdmin, (req, res) => {
  const target = String(req.params.username || "").trim();
  const { password, name } = req.body || {};

  const db = readAdmins();
  const idx = (db.users || []).findIndex(
    (x) => String(x.username).toLowerCase() === target.toLowerCase(),
  );
  if (idx < 0) return res.status(404).json({ ok: false, error: "not_found" });

  if (typeof name === "string") db.users[idx].name = name.trim();
  if (typeof password === "string" && password.trim()) {
    db.users[idx].password = password.trim();
  }

  writeAdmins(db);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:username", requireSuperAdmin, (req, res) => {
  const target = String(req.params.username || "").trim();

  if (target.toLowerCase() === SUPER_USERNAME.toLowerCase()) {
    return res.status(400).json({
      ok: false,
      error: "cannot_delete_super",
      message: `ห้ามลบแอดมินหลัก (${SUPER_USERNAME})`,
    });
  }

  const db = readAdmins();
  const before = db.users.length;

  db.users = (db.users || []).filter(
    (x) => String(x.username).toLowerCase() !== target.toLowerCase(),
  );
  if (db.users.length === before)
    return res.status(404).json({ ok: false, error: "not_found" });

  writeAdmins(db);
  res.json({ ok: true });
});

// ---- error handlers ----
app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({
      ok: false,
      error: "payload_too_large",
      message:
        "ไฟล์รูปใหญ่เกินกำหนด (ลองลดจำนวนรูป/ขนาดรูป หรือบีบอัดรูปก่อนอัปโหลด)",
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      ok: false,
      error: "bad_json",
      message: "รูปแบบข้อมูล JSON ไม่ถูกต้อง",
    });
  }

  console.error("❌ Unhandled error middleware:", err);
  return res.status(500).json({
    ok: false,
    error: "server_error",
    message: "เซิร์ฟเวอร์ผิดพลาด",
  });
});

// ✅ สำคัญ: บน Vercel ห้าม listen ตลอดเวลา
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Server running: http://localhost:${PORT}`);
    console.log(`📁 Serving web from: ${WEB_DIR}`);
    console.log(`💾 Data dir: ${DATA_DIR}`);
  });
}

// ✅ export ให้ Vercel เรียก
module.exports = app;
