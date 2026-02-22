// server/server.js
const path = require("path");

// ✅ โหลด env ตอนรันในเครื่อง (VSCode/local)
if (!process.env.VERCEL) {
  // ต้องติดตั้ง: npm i dotenv
  require("dotenv").config({
    path: path.join(__dirname, "..", ".env.local"),
  });
}

const express = require("express");
const cookieSignature = require("cookie-signature");
const bcrypt = require("bcryptjs");

const { sql } = require("@vercel/postgres");
const { put } = require("@vercel/blob");

const app = express();
const PORT = process.env.PORT || 3000;

const IS_VERCEL = !!process.env.VERCEL;
const APP_SECRET = process.env.APP_SECRET || "dev_secret_change_me";

// ✅ ตั้งค่า super admin ผ่าน env ได้ (แนะนำ)
const SUPER_USERNAME = process.env.SUPER_USERNAME || "Chainimitr";
const SUPER_PASSWORD = process.env.SUPER_PASSWORD || "1234";

const WEB_DIR = path.join(__dirname, "..", "web");

// ---- middleware ----
app.use(express.json({ limit: "60mb" }));
app.use(express.urlencoded({ extended: true, limit: "60mb" }));

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

// เสิร์ฟเว็บ (static)
app.use(express.static(WEB_DIR));

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

// ---- signed session cookie ----
const COOKIE_NAME = "khamin_session";

function signValue(str) {
  return "s:" + cookieSignature.sign(str, APP_SECRET);
}
function unsignValue(signed) {
  if (!signed || !signed.startsWith("s:")) return null;
  const raw = signed.slice(2);
  const unsigned = cookieSignature.unsign(raw, APP_SECRET);
  return unsigned || null;
}

function setSessionCookie(res, payload) {
  const json = JSON.stringify(payload);
  const signed = signValue(json);
  setCookie(res, COOKIE_NAME, signed, {
    maxAgeSeconds: 60 * 60 * 6,
    sameSite: "Lax",
    httpOnly: true,
    path: "/",
  });
}

function clearSessionCookie(res) {
  clearCookie(res, COOKIE_NAME);
}

function getSession(req) {
  const cookies = parseCookies(req);
  const raw = unsignValue(cookies[COOKIE_NAME]);
  if (!raw) return null;

  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
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

// ---- guards ----
function requireOfficer(req, res, next) {
  const s = getSession(req);
  if (!s || !s.isOfficer) {
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "ต้องเข้าสู่ระบบเจ้าหน้าที่ก่อน",
    });
  }
  req.user = s;
  next();
}

function requireSuperAdmin(req, res, next) {
  const s = getSession(req);
  if (!s || !s.isOfficer) {
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "ต้องเข้าสู่ระบบเจ้าหน้าที่ก่อน",
    });
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

// ---- env checks ----
function assertPostgresEnv() {
  if (!process.env.POSTGRES_URL) {
    const err = new Error(
      "POSTGRES_URL หาย (ยังไม่ได้ connect Postgres กับโปรเจกต์ หรือยังไม่ได้ `vercel env pull .env.local` ในเครื่อง)",
    );
    err.code = "missing_env_postgres_url";
    throw err;
  }
}

function assertBlobEnvIfNeed(hasImages) {
  // ถ้าไม่ได้ส่งรูป ก็ไม่จำเป็นต้องมี token
  if (!hasImages) return;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    const err = new Error(
      "BLOB_READ_WRITE_TOKEN หาย (ต้องตั้งค่าใน Vercel Env เพื่ออัปโหลดรูปไป Blob)",
    );
    err.code = "missing_env_blob_token";
    throw err;
  }
}

// ---- DB init: create tables (idempotent) ----
let DB_READY = false;

async function ensureDbSchema() {
  if (DB_READY) return;

  assertPostgresEnv();

  // ✅ ตาราง admins
  await sql`
    CREATE TABLE IF NOT EXISTS admins (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      name TEXT DEFAULT ''
    );
  `;

  // ✅ ตาราง petitions
  await sql`
    CREATE TABLE IF NOT EXISTS petitions (
      code TEXT PRIMARY KEY,
      village TEXT NOT NULL,
      topic TEXT NOT NULL,
      detail TEXT NOT NULL,
      lat TEXT NOT NULL,
      lng TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'รับเรื่องแล้ว',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  // ✅ sequence ต่อปี กัน code ชน
  await sql`
    CREATE TABLE IF NOT EXISTS petition_seq (
      year INT PRIMARY KEY,
      last INT NOT NULL DEFAULT 0
    );
  `;

  // ✅ timeline
  await sql`
    CREATE TABLE IF NOT EXISTS petition_timeline (
      id BIGSERIAL PRIMARY KEY,
      petition_code TEXT NOT NULL REFERENCES petitions(code) ON DELETE CASCADE,
      title TEXT NOT NULL,
      time_text TEXT NOT NULL,
      note TEXT DEFAULT ''
    );
  `;

  // ✅ images
  await sql`
    CREATE TABLE IF NOT EXISTS petition_images (
      id BIGSERIAL PRIMARY KEY,
      petition_code TEXT NOT NULL REFERENCES petitions(code) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('before','after')),
      url TEXT NOT NULL
    );
  `;

  // ✅ trigger update updated_at
  await sql`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_petitions_updated_at'
      ) THEN
        CREATE TRIGGER trg_petitions_updated_at
        BEFORE UPDATE ON petitions
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
      END IF;
    END
    $$;
  `;

  DB_READY = true;
  console.log("✅ DB schema ensured");
}

async function ensureSeedSuperAdmin() {
  await ensureDbSchema();

  const row =
    await sql`SELECT username FROM admins WHERE username=${SUPER_USERNAME} LIMIT 1`;
  if ((row.rows || []).length > 0) return;

  const hash = await bcrypt.hash(String(SUPER_PASSWORD), 10);
  await sql`
    INSERT INTO admins (username, password_hash, name)
    VALUES (${SUPER_USERNAME}, ${hash}, ${"แอดมินหลัก"})
  `;
  console.log("✅ Seeded super admin:", SUPER_USERNAME);
}

// ---- helpers ----
function nowTH() {
  return new Date().toLocaleString("th-TH");
}

async function nextCodeTx() {
  await ensureDbSchema();

  const y = new Date().getFullYear();

  await sql`BEGIN`;
  try {
    await sql`
      INSERT INTO petition_seq(year, last) VALUES(${y}, 0)
      ON CONFLICT (year) DO NOTHING
    `;

    const upd =
      await sql`UPDATE petition_seq SET last = last + 1 WHERE year=${y} RETURNING last`;

    const n = Number(upd.rows?.[0]?.last || 1);
    const serial = String(n).padStart(6, "0");
    const code = `SKN-${y}-${serial}`;

    await sql`COMMIT`;
    return code;
  } catch (e) {
    await sql`ROLLBACK`;
    throw e;
  }
}

function parseDataUrl(dataUrl) {
  const s = String(dataUrl || "");
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  return { mime, buf };
}

function extFromMime(mime) {
  if (!mime) return "bin";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "bin";
}

async function uploadImagesToBlob(code, kind, dataUrls) {
  const arr = Array.isArray(dataUrls) ? dataUrls.slice(0, 8) : [];
  const hasImages = arr.length > 0;

  // ✅ ถ้ามีรูป → ต้องมี token
  assertBlobEnvIfNeed(hasImages);
  if (!hasImages) return [];

  const urls = [];
  for (let i = 0; i < arr.length; i++) {
    const p = parseDataUrl(arr[i]);
    if (!p) continue;

    const ext = extFromMime(p.mime);
    const filename = `petitions/${code}/${kind}-${Date.now()}-${i}.${ext}`;

    const uploaded = await put(filename, p.buf, {
      access: "public",
      contentType: p.mime,
    });

    urls.push(uploaded.url);
  }

  return urls;
}

// ---- pages ----
app.get("/", (req, res) => res.redirect("/login.html"));

app.get("/api/ping", async (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    vercel: IS_VERCEL,
    hasPostgres: !!process.env.POSTGRES_URL,
    hasBlob: !!process.env.BLOB_READ_WRITE_TOKEN,
  });
});

// ---- auth ----
app.post("/api/login", async (req, res) => {
  try {
    // ✅ ชัดเจน: ถ้า POSTGRES_URL หาย จะรู้ทันที
    assertPostgresEnv();

    await ensureSeedSuperAdmin();

    const { username, password } = req.body || {};
    const u = String(username || "").trim();
    const p = String(password || "").trim();

    const db =
      await sql`SELECT username, password_hash, name FROM admins WHERE username=${u} LIMIT 1`;
    const found = db.rows?.[0];

    if (!found) {
      return res.status(401).json({
        ok: false,
        error: "invalid_credentials",
        message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
      });
    }

    const ok = await bcrypt.compare(p, found.password_hash);
    if (!ok) {
      return res.status(401).json({
        ok: false,
        error: "invalid_credentials",
        message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
      });
    }

    const isSuper = String(found.username) === SUPER_USERNAME;
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
  } catch (e) {
    console.error("❌ /api/login error:", e);
    return res.status(500).json({
      ok: false,
      error: e.code || "server_error",
      message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
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
app.post("/api/petitions", async (req, res) => {
  try {
    assertPostgresEnv();
    await ensureDbSchema();

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

    const code = await nextCodeTx();

    await sql`
      INSERT INTO petitions(code, village, topic, detail, lat, lng, status)
      VALUES(${code}, ${v}, ${t}, ${d}, ${la}, ${ln}, ${"รับเรื่องแล้ว"})
    `;

    await sql`
      INSERT INTO petition_timeline(petition_code, title, time_text, note)
      VALUES(${code}, ${"รับเรื่องแล้ว"}, ${nowTH()}, ${"ระบบรับคำร้องเรียบร้อย"})
    `;

    // upload before images to blob + save URLs
    const beforeUrls = await uploadImagesToBlob(code, "before", imagesBefore);
    for (const url of beforeUrls) {
      await sql`
        INSERT INTO petition_images(petition_code, kind, url)
        VALUES(${code}, ${"before"}, ${url})
      `;
    }

    return res.json({ ok: true, code });
  } catch (err) {
    console.error("❌ POST /api/petitions ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: err.code || "server_error",
      message: err.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
});

// ---- citizen track ----
app.get("/api/track/:code", async (req, res) => {
  try {
    assertPostgresEnv();
    await ensureDbSchema();

    const code = String(req.params.code || "").toUpperCase();

    const p =
      await sql`SELECT * FROM petitions WHERE UPPER(code)=${code} LIMIT 1`;
    const it = p.rows?.[0];
    if (!it) return res.status(404).json({ ok: false, error: "not_found" });

    const tl = await sql`
      SELECT title, time_text, note
      FROM petition_timeline
      WHERE petition_code=${it.code}
      ORDER BY id ASC
    `;

    const imgs = await sql`
      SELECT kind, url
      FROM petition_images
      WHERE petition_code=${it.code}
      ORDER BY id ASC
    `;

    const before = (imgs.rows || [])
      .filter((x) => x.kind === "before")
      .map((x) => x.url);

    const after = (imgs.rows || [])
      .filter((x) => x.kind === "after")
      .map((x) => x.url);

    res.json({
      ok: true,
      item: {
        code: it.code,
        village: it.village,
        topic: it.topic,
        detail: it.detail,
        lat: it.lat,
        lng: it.lng,
        status: it.status,
        updatedAt: it.updated_at,
        timeline: (tl.rows || []).map((x) => ({
          title: x.title,
          time: x.time_text,
          note: x.note,
        })),
        imagesBefore: before,
        imagesAfter: after,
      },
    });
  } catch (e) {
    console.error("❌ GET /api/track/:code error:", e);
    res.status(500).json({
      ok: false,
      error: e.code || "server_error",
      message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
});

// ---- admin petitions ----
app.get("/api/admin/petitions", requireOfficer, async (req, res) => {
  try {
    assertPostgresEnv();
    await ensureDbSchema();

    const rows = await sql`SELECT * FROM petitions ORDER BY updated_at DESC`;

    // ให้ admin.js ใช้รูปแบบเดิม
    res.json({
      ok: true,
      items: (rows.rows || []).map((r) => ({
        code: r.code,
        village: r.village,
        topic: r.topic,
        detail: r.detail,
        lat: r.lat,
        lng: r.lng,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        imagesBefore: [],
        imagesAfter: [],
        timeline: [],
      })),
    });
  } catch (e) {
    console.error("❌ GET /api/admin/petitions error:", e);
    res.status(500).json({
      ok: false,
      error: e.code || "server_error",
      message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
});

// ✅ รายละเอียดครบ (สำหรับ admin.js selectItem)
app.get("/api/admin/petitions/:code", requireOfficer, async (req, res) => {
  try {
    assertPostgresEnv();
    await ensureDbSchema();

    const code = String(req.params.code || "").toUpperCase();

    const p =
      await sql`SELECT * FROM petitions WHERE UPPER(code)=${code} LIMIT 1`;
    const it = p.rows?.[0];
    if (!it) return res.status(404).json({ ok: false, error: "not_found" });

    const tl = await sql`
      SELECT title, time_text, note
      FROM petition_timeline
      WHERE petition_code=${it.code}
      ORDER BY id ASC
    `;

    const imgs = await sql`
      SELECT kind, url
      FROM petition_images
      WHERE petition_code=${it.code}
      ORDER BY id ASC
    `;

    const before = (imgs.rows || [])
      .filter((x) => x.kind === "before")
      .map((x) => x.url);

    const after = (imgs.rows || [])
      .filter((x) => x.kind === "after")
      .map((x) => x.url);

    res.json({
      ok: true,
      item: {
        code: it.code,
        village: it.village,
        topic: it.topic,
        detail: it.detail,
        lat: it.lat,
        lng: it.lng,
        status: it.status,
        createdAt: it.created_at,
        updatedAt: it.updated_at,
        timeline: (tl.rows || []).map((x) => ({
          title: x.title,
          time: x.time_text,
          note: x.note,
        })),
        imagesBefore: before,
        imagesAfter: after,
      },
    });
  } catch (e) {
    console.error("❌ GET /api/admin/petitions/:code error:", e);
    res.status(500).json({
      ok: false,
      error: e.code || "server_error",
      message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
});

app.patch(
  "/api/admin/petitions/:code/status",
  requireOfficer,
  async (req, res) => {
    try {
      assertPostgresEnv();
      await ensureDbSchema();

      const code = String(req.params.code || "").toUpperCase();
      const { status, note } = req.body || {};

      const p =
        await sql`SELECT code, status FROM petitions WHERE UPPER(code)=${code} LIMIT 1`;
      const it = p.rows?.[0];
      if (!it) return res.status(404).json({ ok: false, error: "not_found" });

      const newStatus = String(status || it.status || "รับเรื่องแล้ว");

      await sql`
        UPDATE petitions
        SET status=${newStatus}
        WHERE code=${it.code}
      `;

      await sql`
        INSERT INTO petition_timeline(petition_code, title, time_text, note)
        VALUES(${it.code}, ${newStatus}, ${nowTH()}, ${String(note || "")})
      `;

      res.json({ ok: true });
    } catch (e) {
      console.error("❌ PATCH status error:", e);
      res.status(500).json({
        ok: false,
        error: e.code || "server_error",
        message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
      });
    }
  },
);

app.patch(
  "/api/admin/petitions/:code/after-images",
  requireOfficer,
  async (req, res) => {
    try {
      assertPostgresEnv();
      await ensureDbSchema();

      const code = String(req.params.code || "").toUpperCase();
      const { imagesAfter } = req.body || {};

      if (!Array.isArray(imagesAfter)) {
        return res.status(400).json({
          ok: false,
          error: "imagesAfter_must_be_array",
          message: "imagesAfter ต้องเป็น array",
        });
      }

      const p =
        await sql`SELECT code FROM petitions WHERE UPPER(code)=${code} LIMIT 1`;
      const it = p.rows?.[0];
      if (!it) return res.status(404).json({ ok: false, error: "not_found" });

      const afterUrls = await uploadImagesToBlob(it.code, "after", imagesAfter);

      for (const url of afterUrls) {
        await sql`
          INSERT INTO petition_images(petition_code, kind, url)
          VALUES(${it.code}, ${"after"}, ${url})
        `;
      }

      // updated_at จะถูก trigger อัปเดตตอน UPDATE (กันกรณีไม่แก้ field)
      await sql`UPDATE petitions SET status=status WHERE code=${it.code}`;

      res.json({ ok: true });
    } catch (e) {
      console.error("❌ PATCH after-images error:", e);
      res.status(500).json({
        ok: false,
        error: e.code || "server_error",
        message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
      });
    }
  },
);

app.delete("/api/admin/petitions/:code", requireOfficer, async (req, res) => {
  try {
    assertPostgresEnv();
    await ensureDbSchema();

    const code = String(req.params.code || "").toUpperCase();
    const del =
      await sql`DELETE FROM petitions WHERE UPPER(code)=${code} RETURNING code`;

    if ((del.rows || []).length === 0) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ DELETE petition error:", e);
    res.status(500).json({
      ok: false,
      error: e.code || "server_error",
      message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
});

// ---- admin users (super only) ----
app.get("/api/admin/users", requireSuperAdmin, async (req, res) => {
  try {
    assertPostgresEnv();
    await ensureDbSchema();

    const rows =
      await sql`SELECT username, name FROM admins ORDER BY username ASC`;

    res.json({
      ok: true,
      users: (rows.rows || []).map((u) => ({
        username: u.username,
        name: u.name || "",
        isSuper: String(u.username) === SUPER_USERNAME,
      })),
    });
  } catch (e) {
    console.error("❌ GET admin users error:", e);
    res.status(500).json({
      ok: false,
      error: e.code || "server_error",
      message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
});

app.post("/api/admin/users", requireSuperAdmin, async (req, res) => {
  try {
    assertPostgresEnv();
    await ensureDbSchema();

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

    const exists =
      await sql`SELECT username FROM admins WHERE LOWER(username)=LOWER(${u}) LIMIT 1`;
    if ((exists.rows || []).length > 0) {
      return res.status(409).json({
        ok: false,
        error: "username_exists",
        message: "มี username นี้แล้ว",
      });
    }

    const hash = await bcrypt.hash(p, 10);
    await sql`
      INSERT INTO admins(username, password_hash, name)
      VALUES(${u}, ${hash}, ${n})
    `;

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ POST admin users error:", e);
    res.status(500).json({
      ok: false,
      error: e.code || "server_error",
      message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
});

app.patch("/api/admin/users/:username", requireSuperAdmin, async (req, res) => {
  try {
    assertPostgresEnv();
    await ensureDbSchema();

    const target = String(req.params.username || "").trim();
    const { password, name } = req.body || {};

    const row =
      await sql`SELECT username FROM admins WHERE LOWER(username)=LOWER(${target}) LIMIT 1`;
    const found = row.rows?.[0];
    if (!found) return res.status(404).json({ ok: false, error: "not_found" });

    if (typeof name === "string") {
      await sql`UPDATE admins SET name=${name.trim()} WHERE username=${found.username}`;
    }
    if (typeof password === "string" && password.trim()) {
      const hash = await bcrypt.hash(password.trim(), 10);
      await sql`UPDATE admins SET password_hash=${hash} WHERE username=${found.username}`;
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ PATCH admin users error:", e);
    res.status(500).json({
      ok: false,
      error: e.code || "server_error",
      message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
});

app.delete("/api/admin/users/:username", requireSuperAdmin, async (req, res) => {
  try {
    assertPostgresEnv();
    await ensureDbSchema();

    const target = String(req.params.username || "").trim();

    if (target.toLowerCase() === SUPER_USERNAME.toLowerCase()) {
      return res.status(400).json({
        ok: false,
        error: "cannot_delete_super",
        message: `ห้ามลบแอดมินหลัก (${SUPER_USERNAME})`,
      });
    }

    const del =
      await sql`DELETE FROM admins WHERE LOWER(username)=LOWER(${target}) RETURNING username`;
    if ((del.rows || []).length === 0) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ DELETE admin users error:", e);
    res.status(500).json({
      ok: false,
      error: e.code || "server_error",
      message: e.message || "เซิร์ฟเวอร์ผิดพลาด",
    });
  }
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
    error: err.code || "server_error",
    message: err.message || "เซิร์ฟเวอร์ผิดพลาด",
  });
});

// local dev only
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`✅ Server running: http://localhost:${PORT}`);
    console.log(`📁 Serving web from: ${WEB_DIR}`);

    // ✅ ลองเช็ค schema ตอน start (ถ้า env มี)
    try {
      if (process.env.POSTGRES_URL) {
        await ensureDbSchema();
        await ensureSeedSuperAdmin();
      } else {
        console.warn(
          "⚠️ POSTGRES_URL ยังไม่มี: ถ้ารันในเครื่องให้ทำ `vercel env pull .env.local`",
        );
      }
    } catch (e) {
      console.error("❌ DB init error:", e);
    }
  });
}

module.exports = app;
