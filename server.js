// server.js (completo)
import express from "express";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import ImageKit from "imagekit";
import { importFromParsedJson, fetchFromQrCode } from "./services/nfceService.js";
import { sendEmail } from "./services/emailService.js";
import { randomUUID, createHash } from "crypto";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

// ====== Base ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Async route wrapper to bubble errors
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.disable("x-powered-by");
app.set("trust proxy", 1);

// ====== PORT & SERVER ======
const PORT = Number(process.env.PORT) || 8080;
const APP_BASE_URL = process.env.APP_BASE_URL || "";

if (process.env.NODE_ENV === "production" && PORT === 3000 && !process.env.DEV_ALLOW_3000) {
  console.error("❌ Em produção, não use a porta 3000. Defina PORT=8080.");
  process.exit(1);
}

console.log("[BOOT]", {
  USING_PORT: PORT,
  NODE_ENV: process.env.NODE_ENV || "development",
});

const JWT_SECRET = process.env.JWT_SECRET || "troque-esta-chave-super-secreta";
const BCRYPT_COST = parseInt(process.env.BCRYPT_COST || "11", 10);

// Banco
const DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.error("DATABASE_URL é obrigatório. Configure o banco de dados.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    /neon\.tech/.test(DATABASE_URL) ||
    /render\.com/.test(DATABASE_URL) ||
    /sslmode=require/.test(DATABASE_URL)
      ? { rejectUnauthorized: false }
      : undefined,
  max: parseInt(process.env.PGPOOL_MAX || "5", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const DB_ENABLED = true;
console.log("🗄️ DB: PostgreSQL habilitado");

// ====== Middlewares base ======
app.use(express.json({ limit: "2mb" }));

// ====== ImageKit Auth Route ======
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "",
});

app.get("/api/imagekit/auth", (req, res) => {
  try {
    const auth = imagekit.getAuthenticationParameters();
    res.json({ ...auth, publicKey: process.env.IMAGEKIT_PUBLIC_KEY, folder: process.env.IMAGEKIT_DEFAULT_FOLDER || "/avatars" });
  } catch (e) {
    console.error("[imagekit-auth] error:", e);
    res.status(500).json({ error: "auth_failed" });
  }
});


// Per-request id + basic security header
app.use((req, res, next) => {
  const hdrId = (req.get("x-request-id") || "").trim();
  req.id = hdrId || randomUUID();
  res.setHeader("X-Request-Id", req.id);
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// Handle invalid JSON bodies
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ error: "invalid_json", code: "request_error", requestId: req.id });
  }
  next(err);
});

app.use(cookieParser());

// Static: web/dist (SPA) e public/
const WEB_DIST = path.join(__dirname, "web", "dist");
if (fs.existsSync(WEB_DIST)) {
  app.use(
    express.static(WEB_DIST, {
      maxAge: "1h",
      etag: true,
      lastModified: true,
    })
  );
}
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "1h",
    etag: true,
    lastModified: true,
  })
);

// Bloqueio explícito de caminhos /admin no app do usuário
app.use(/^\/admin(\/|$)/, (_req, res) => {
  return res.status(404).json({ error: "Not Found" });
});

// ====== Helpers ======
function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase();
}
function normalizeMtp(v) {
  if (!v) return "";
  const s = String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (s.includes("credito")) return "credito";
  if (s.includes("debito")) return "debito";
  if (s.includes("dinheiro")) return "dinheiro";
  if (s.includes("pix")) return "pix";
  if (s.includes("ticket") || s.includes("vale") || s === "vr" || s === "va") return "ticket";
  return s;
}

async function ensureOutrosTagId(familyId) {
  const r = await pool.query(
    `select id from tags where family_id=$1 and lower(name)='outros' limit 1`,
    [familyId]
  );
  if (r.rowCount > 0) return r.rows[0].id;
  const { rows } = await pool.query(
    `insert into tags (id, family_id, name, color, is_builtin)
     values ($1,$2,$3,$4,true)
     returning id`,
    [uuidv4(), familyId, "Outros", "#6B7280"]
  );
  return rows[0].id;
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      uf: user.uf,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function getAccessState(userId) {
  if (!DB_ENABLED) return { allowed: true };
  try {
    const r = await pool.query(
      `select fm.family_id, fm.role, fm.is_active, f.status, f.slug, f.name
         from family_members fm
         join families f on f.id = fm.family_id
        where fm.user_id = $1
        order by fm.created_at asc`,
      [userId]
    );
    const memberships = r.rows;
    const active = memberships.find((m) => m.is_active && m.status === "active");
    if (active)
      return {
        allowed: true,
        family: {
          id: active.family_id,
          slug: active.slug,
          name: active.name,
          role: active.role,
        },
      };

    const pendingOwner = memberships.find((m) => m.role === "owner");
    if (pendingOwner && pendingOwner.status === "pending_admin")
      return {
        allowed: false,
        waiting: "admin_approval",
        family: {
          id: pendingOwner.family_id,
          slug: pendingOwner.slug,
          name: pendingOwner.name,
          role: pendingOwner.role,
        },
      };

    const jr = await pool.query(
      `select jr.family_id, f.slug, f.name
         from join_requests jr
         join families f on f.id = jr.family_id
        where jr.requester_user_id=$1 and jr.status='pending'
        limit 1`,
      [userId]
    );
    if (jr.rowCount > 0)
      return {
        allowed: false,
        waiting: "owner_approval",
        family: {
          id: jr.rows[0].family_id,
          slug: jr.rows[0].slug,
          name: jr.rows[0].name,
        },
      };

    return { allowed: false, waiting: "no_family" };
  } catch (e) {
    console.warn("getAccessState error:", e.message || e);
    return { allowed: false, waiting: "no_family" };
  }
}

function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Não autenticado" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Sessão inválida/expirada" });
  }
}
function toYearMonth(isoDate) {
  const d = new Date(isoDate);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function addMonths(isoDate, n) {
  const d = new Date(isoDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const newDate = new Date(
    Date.UTC(year, month + n, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())
  );
  return newDate.toISOString();
}
function splitAmount(total, installments) {
  const cents = Math.round(Number(total) * 100);
  const base = Math.floor(cents / installments);
  const remainder = cents % installments;
  return Array.from({ length: installments }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}
const toISO = (v) => (v && typeof v.toISOString === "function" ? v.toISOString() : v);

// Ensure password_resets table has expected columns (idempotent, tolerant)
async function ensurePasswordResetsSchema() {
  try {
    await pool.query(`
      create table if not exists password_resets (
        id uuid primary key,
        token text unique,
        user_id uuid null,
        username text null,
        email text null,
        created_at timestamptz not null default now(),
        expires_at timestamptz null,
        used_at timestamptz null
      );
    `);
  } catch {}
  const alters = [
    "alter table if exists password_resets add column if not exists token text unique",
    "alter table if exists password_resets add column if not exists user_id uuid",
    "alter table if exists password_resets add column if not exists username text",
    "alter table if exists password_resets add column if not exists email text",
    "alter table if exists password_resets add column if not exists created_at timestamptz default now()",
    "alter table if exists password_resets add column if not exists expires_at timestamptz",
    "alter table if exists password_resets add column if not exists used_at timestamptz",
  ];
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch {}
  }
  try {
    await pool.query(
      "create unique index if not exists password_resets_token_hash_uk on password_resets((token_hash)) where token_hash is not null"
    );
  } catch {}
}

async function tableHasColumn(table, column) {
  try {
    const r = await pool.query(
      `select 1
         from information_schema.columns
        where table_schema='public'
          and table_name=$1
          and column_name=$2
        limit 1`,
      [table, column]
    );
    return r.rowCount > 0;
  } catch {
    return false;
  }
}

// ====== Auth ======
app.post(
  "/api/register",
  asyncHandler(async (req, res) => {
    try {
      const rawUsername = String(req.body.username || req.body.identifier || "").trim();
      const username = normalizeUsername(rawUsername);
      const email = String(req.body.email || "").trim().toLowerCase();
      const first = String(req.body.first_name || "").trim();
      const last = String(req.body.last_name || "").trim();
      const displayName =
        String(req.body.displayName || `${first} ${last}` || "").trim() || username;
      const uf = String(req.body.uf || "").trim().toUpperCase() || null;
      const password = String(req.body.password || "");

      const userRe = /^[a-z0-9._-]{3,30}$/;
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!userRe.test(username))
        return res.status(400).json({ error: "username_invalido" });
      if (!emailRe.test(email)) return res.status(400).json({ error: "email_invalido" });
      if (!password || password.length < 8)
        return res.status(400).json({ error: "senha_fraca" });

      const existsUser = await pool.query("select 1 from users where username = $1", [username]);
      if (existsUser.rowCount > 0)
        return res.status(409).json({ error: "username_em_uso" });
      const existsEmail = await pool.query(
        "select 1 from users where lower(email) = lower($1)",
        [email]
      );
      if (existsEmail.rowCount > 0)
        return res.status(409).json({ error: "email_em_uso" });

      const hash = await bcrypt.hash(password, BCRYPT_COST);
      const ins = await pool.query(
        "insert into users (id, username, display_name, password_hash, email, uf, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,'active',now(),now()) returning id",
        [uuidv4(), username, displayName, hash, email, uf]
      );
      const userId = ins.rows[0].id;

      const token = signToken({ id: userId, username, displayName, uf });
      res.cookie("token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      try {
        await sendEmail({
          to: email,
          subject: "Bem-vindo(a) ao Finanças Familiares",
          html: `<p>Olá ${displayName || username},</p><p>Sua conta foi criada com sucesso.</p>`,
          text: `Olá ${displayName || username},\nSua conta foi criada com sucesso.`,
        });
      } catch (e) {
        console.warn("register email failed:", e?.message || e);
      }
      return res
        .status(201)
        .json({ ok: true, user: { id: userId, username, displayName, uf } });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "register_failed" });
    }
  })
);

app.post(
  "/api/login",
  asyncHandler(async (req, res) => {
    try {
      const identifierRaw = String(req.body.username ?? req.body.identifier ?? "").trim();
      const isEmail = /@/.test(identifierRaw);
      const username = isEmail ? null : normalizeUsername(identifierRaw);
      const email = isEmail ? identifierRaw.toLowerCase() : null;
      const password = String(req.body.password ?? "");

      if ((!username && !email) || !password) {
        return res.status(400).json({ error: "Informe usuário e senha" });
      }

      const r = isEmail
        ? await pool.query(
            "select id, username, display_name, password_hash, uf, coalesce(status,'active') as status from users where lower(email) = lower($1)",
            [email]
          )
        : await pool.query(
            "select id, username, display_name, password_hash, uf, coalesce(status,'active') as status from users where username = $1",
            [username]
          );
      if (r.rowCount === 0)
        return res.status(401).json({ error: "Usuário ou senha inválidos" });

      const u = r.rows[0];
      if (u.status && String(u.status).toLowerCase() === "blocked")
        return res.status(403).json({ error: "usuario_bloqueado" });

      const ok = await bcrypt.compare(password, u.password_hash || "");
      if (!ok) return res.status(401).json({ error: "Usuário ou senha inválidos" });

      const token = signToken({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        uf: u.uf || undefined,
      });
      res.cookie("token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      return res.json({
        ok: true,
        user: {
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.username,
          uf: u.uf || undefined,
        },
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "login_failed" });
    }
  })
);

app.post("/api/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  res.json({ ok: true });
});

// ====== Password recovery ======
app.post(
  "/auth/forgot",
  asyncHandler(async (req, res) => {
    await ensurePasswordResetsSchema();
    const emailRaw = String(req.body?.email || "").trim();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(emailRaw)) return res.status(200).json({ ok: true });

    // Lookup user by email
    let user = null;
    try {
      const r = await pool.query(
        "select id, username, display_name, email from users where lower(email)=lower($1)",
        [emailRaw]
      );
      if (r.rowCount > 0) user = r.rows[0];
    } catch {}

    // Always respond 200 to avoid enumeration
    if (!user) return res.json({ ok: true });

    const token = uuidv4();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
    try {
      const hasTokenHash = await tableHasColumn("password_resets", "token_hash");
      if (hasTokenHash) {
        await pool.query(
          "insert into password_resets (id, token_hash, user_id, username, email, expires_at) values ($1,$2,$3,$4,$5,$6)",
          [
            uuidv4(),
            tokenHash,
            user?.id || null,
            user?.username || null,
            emailRaw.toLowerCase(),
            expiresAt.toISOString(),
          ]
        );
      } else {
        const hasTokenCol = await tableHasColumn("password_resets", "token");
        if (hasTokenCol) {
          await pool.query(
            "insert into password_resets (id, token, user_id, username, email, expires_at) values ($1,$2,$3,$4,$5,$6)",
            [
              uuidv4(),
              token,
              user?.id || null,
              user?.username || null,
              emailRaw.toLowerCase(),
              expiresAt.toISOString(),
            ]
          );
        } else {
          await pool.query(
            "insert into password_resets (id, user_id, username, email, expires_at) values ($1,$2,$3,$4,$5)",
            [token, user?.id || null, user?.username || null, emailRaw.toLowerCase(), expiresAt.toISOString()]
          );
        }
      }
    } catch (e2) {
      console.error("password_resets insert failed:", e2?.message || e2);
    }

    const baseUrl = APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const url = `${baseUrl}/reset?token=${encodeURIComponent(token)}`;
    try {
      await sendEmail({
        to: emailRaw,
        subject: "Redefinição de senha",
        html: `<p>Olá ${user.display_name || user.username || ""},</p><p>Para redefinir sua senha, clique: <a href="${url}">${url}</a></p><p>Se você não solicitou, ignore.</p>`,
        text: `Olá ${user.display_name || user.username || ""},\nPara redefinir sua senha, acesse: ${url}\nSe você não solicitou, ignore.`,
      });
    } catch (e) {
      console.warn("sendEmail forgot failed:", e?.message || e);
    }
    return res.json({ ok: true });
  })
);

app.post(
  "/auth/reset",
  asyncHandler(async (req, res) => {
    await ensurePasswordResetsSchema();
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.new_password || "");
    if (!token) return res.status(400).json({ error: "invalid_token" });
    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ error: "senha_curta" });

    // Try lookup by token_hash, then token, then id
    let r;
    try {
      const hasTokenHash = await tableHasColumn("password_resets", "token_hash");
      if (hasTokenHash) {
        const tokenHash = createHash("sha256").update(token).digest("hex");
        r = await pool.query(
          "select id, user_id, username, email, expires_at, used_at from password_resets where token_hash=$1",
          [tokenHash]
        );
      }
      if (!r || r.rowCount === 0) {
        const hasTokenCol = await tableHasColumn("password_resets", "token");
        if (hasTokenCol) {
          r = await pool.query(
            "select id, user_id, username, email, expires_at, used_at from password_resets where token=$1",
            [token]
          );
        }
      }
      if (!r || r.rowCount === 0) {
        r = await pool.query(
          "select id, user_id, username, email, expires_at, used_at from password_resets where id=$1",
          [token]
        );
      }
    } catch {
      r = await pool.query(
        "select id, user_id, username, email, expires_at, used_at from password_resets where id=$1",
        [token]
      );
    }
    if (r.rowCount === 0) return res.status(400).json({ error: "invalid_token" });
    const pr = r.rows[0];
    if (pr.used_at) return res.status(400).json({ error: "token_used" });
    if (pr.expires_at && new Date(pr.expires_at).getTime() < Date.now())
      return res.status(400).json({ error: "token_expired" });

    const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
    let updated = false;
    if (pr.user_id) {
      try {
        const u1 = await pool.query("update users set password_hash=$1 where id=$2", [
          hash,
          pr.user_id,
        ]);
        updated = (u1.rowCount || 0) > 0;
      } catch {}
    }
    if (!updated && pr.username) {
      try {
        const u2 = await pool.query("update users set password_hash=$1 where username=$2", [
          hash,
          pr.username,
        ]);
        updated = (u2.rowCount || 0) > 0;
      } catch {}
    }
    if (!updated && pr.email) {
      try {
        const u3 = await pool.query(
          "update users set password_hash=$1 where lower(email)=lower($2)",
          [hash, pr.email]
        );
        updated = (u3.rowCount || 0) > 0;
      } catch {}
    }
    if (!updated) return res.status(404).json({ error: "user_not_found" });

    try {
      await pool.query("update password_resets set used_at=now() where id=$1", [pr.id]);
    } catch {}
    return res.json({ ok: true });
  })
);

app.get(
  "/api/me",
  authMiddleware,
  asyncHandler(async (req, res) => {
    try {
      const r = await pool.query(
        "select id, username, display_name, email, uf from users where id=$1",
        [req.user.id]
      );
      if (r.rowCount > 0) {
        const u = r.rows[0];
        const access = await getAccessState(u.id);
        
        let avatarUrl = null;
        try {
          const hasCol = await tableHasColumn("users","avatar_url");
          if (hasCol) {
            const a = await pool.query("select avatar_url from users where id=$1",[u.id]);
            avatarUrl = a.rows?.[0]?.avatar_url || null;
          }
        } catch {}
return res.json({
          id: u.id,
          avatar_url: avatarUrl,
          username: u.username,
          displayName: u.display_name || u.username,
          email: u.email,
          uf: u.uf || undefined,
          access,
        });
      }
    } catch (e) {
      console.warn("/api/me error:", e?.message || e);
    }
    const access = await getAccessState(req.user.id);
    return res.json({ id: req.user.id, avatar_url: null,
      username: req.user.username,
      displayName: req.user.displayName,
      email: req.user.email,
      uf: req.user.uf,
      access,
    });
  })
);


app.patch(
  "/api/me",
  authMiddleware,
  asyncHandler(async (req, res) => {
    try {
      const display_name = typeof req.body?.display_name === "string" ? req.body.display_name.trim() : undefined;
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : undefined;
      const avatar_url = typeof req.body?.avatar_url === "string" ? req.body.avatar_url.trim() : undefined;

      // ensure avatar_url column exists if needed
      if (avatar_url !== undefined) {
        try {
          const hasCol = await tableHasColumn("users", "avatar_url");
          if (!hasCol) {
            await pool.query('alter table if exists users add column if not exists avatar_url text');
          }
        } catch {}
      }
      const sets = [];
      const vals = [];
      let idx = 1;
      if (display_name !== undefined) { sets.push(`display_name=$${idx++}`); vals.push(display_name); }
      if (email !== undefined)       { sets.push(`email=$${idx++}`); vals.push(email); }
      if (avatar_url !== undefined)  { sets.push(`avatar_url=$${idx++}`); vals.push(avatar_url); }

      if (sets.length === 0) return res.status(400).json({ error: "no_fields" });

      vals.push(req.user.id);
      const sql = `update users set ${sets.join(", ")}, updated_at=now() where id=$${idx} returning id`;
      await pool.query(sql, vals);
      return res.json({ ok: true });
    } catch (e) {
      console.error("PATCH /api/me error:", e);
      return res.status(500).json({ error: "update_failed" });
    }
  })
);
app.post(
  "/api/me/password",
  authMiddleware,
  asyncHandler(async (req, res) => {
    try {
      const currentPassword = String(req.body.currentPassword ?? "");
      const newPassword = String(req.body.newPassword ?? "");
      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: "senha_curta" });
      }

      const r = await pool.query(
        "select id, password_hash, display_name from users where id = $1",
        [req.user.id]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });
      const u = r.rows[0];
      const ok = await bcrypt.compare(currentPassword, u.password_hash || "");
      if (!ok) return res.status(401).json({ error: "senha_incorreta" });
      const hash = await bcrypt.hash(newPassword, 10);
      await pool.query("update users set password_hash=$1 where id=$2", [
        hash,
        req.user.id,
      ]);
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "change_password_failed" });
    }
  })
);

// ====== Tags ======
app.get(
  "/api/tags",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const familyId = await getActiveFamilyIdOrNull(req.user.id);
    if (!familyId) return res.status(403).json({ error: "no_active_family" });

    await ensureOutrosTagId(familyId);
    const { rows } = await pool.query(
      `select id, name, color, is_builtin
         from tags
        where family_id=$1
        order by case when lower(name)='outros' then 0 else 1 end, lower(name)`,
      [familyId]
    );
    res.json(rows);
  })
);

app.post(
  "/api/tags",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const familyId = await getActiveFamilyIdOrNull(req.user.id);
    if (!familyId) return res.status(403).json({ error: "no_active_family" });

    const name = String(req.body.name || "").trim();
    const color = (req.body.color || "").trim() || null;
    if (!name) return res.status(400).json({ error: "name_required" });
    if (name.toLowerCase() === "outros") {
      const id = await ensureOutrosTagId(familyId);
      const { rows } = await pool.query(
        `select id, name, color, is_builtin from tags where id=$1`,
        [id]
      );
      return res.json(rows[0]);
    }

    try {
      const { rows } = await pool.query(
        `insert into tags (id, family_id, name, color, is_builtin, created_by_user_id)
         values ($1,$2,$3,$4,false,$5)
         on conflict (family_id, lower(name)) do update set name=excluded.name
         returning id, name, color, is_builtin`,
        [uuidv4(), familyId, name, color, req.user.id]
      );
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "tag_create_failed" });
    }
  })
);

app.delete(
  "/api/tags/:id",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const familyId = await getActiveFamilyIdOrNull(req.user.id);
    if (!familyId) return res.status(403).json({ error: "no_active_family" });

    // checa se é owner
    const rr = await pool.query(
      `select f.owner_user_id
         from families f
         join family_members fm on fm.family_id=f.id and fm.user_id=$1 and fm.is_active=true
        where f.id=$2 and f.status='active'`,
      [req.user.id, familyId]
    );
    if (rr.rowCount === 0) return res.status(403).json({ error: "forbidden" });
    const isOwner = String(rr.rows[0].owner_user_id) === String(req.user.id);
    if (!isOwner) return res.status(403).json({ error: "only_owner_can_delete" });

    const tagId = req.params.id;
    const tx = await pool.connect();
    try {
      await tx.query("begin");
      const t = await tx.query(
        `select id, name, is_builtin from tags where id=$1 and family_id=$2 for update`,
        [tagId, familyId]
      );
      if (t.rowCount === 0) {
        await tx.query("rollback");
        return res.status(404).json({ error: "tag_not_found" });
      }
      if (t.rows[0].is_builtin) {
        await tx.query("rollback");
        return res.status(400).json({ error: "cannot_delete_builtin" });
      }

      const outrosId = await ensureOutrosTagId(familyId);

      // compras que só tinham esta tag
      const onlyThis = await tx.query(
        `select pt.purchase_id
           from purchase_tags pt
          where pt.tag_id=$1
            and not exists (
              select 1 from purchase_tags x
              where x.purchase_id=pt.purchase_id and x.tag_id<>$1
            )`,
        [tagId]
      );

      // reatribui essas compras para "Outros"
      for (const r of onlyThis.rows) {
        await tx.query(
          `insert into purchase_tags (purchase_id, tag_id)
           values ($1,$2) on conflict do nothing`,
          [r.purchase_id, outrosId]
        );
      }

      // remove a tag de todas as compras
      await tx.query(`delete from purchase_tags where tag_id=$1`, [tagId]);
      // apaga a tag
      await tx.query(`delete from tags where id=$1`, [tagId]);

      await tx.query("commit");
      res.json({ ok: true });
    } catch (e) {
      try {
        await tx.query("rollback");
      } catch {}
      console.error(e);
      res.status(500).json({ error: "tag_delete_failed" });
    } finally {
      tx.release();
    }
  })
);

// ====== Families ======
async function getActiveFamilyIdOrNull(userId) {
  const q = `
    SELECT fm.family_id
    FROM family_members fm
    JOIN families f ON f.id = fm.family_id
    WHERE fm.user_id = $1
      AND fm.is_active = TRUE
      AND f.status = 'active'
    ORDER BY
      CASE WHEN f.owner_user_id = $1 THEN 0 ELSE 1 END,
      fm.created_at NULLS LAST,
      fm.family_id
    LIMIT 1`;
  try {
    const { rows } = await pool.query(q, [userId]);
  if (rows && rows[0]?.family_id) return rows[0].family_id;
  } catch (e) {
    console.warn("getActiveFamilyIdOrNull error:", e?.message || e);
    return null;
  }
}

app.get(
  "/api/families/mine",
  authMiddleware,
  asyncHandler(async (req, res) => {
    try {
      const familyId = await getActiveFamilyIdOrNull(req.user.id);
      if (!familyId) return res.json(null);
      const { rows } = await pool.query("select * from families where id = $1", [familyId]);
      return res.json(rows[0] || null);
    } catch (e) {
      console.error("families/mine error:", e);
      return res.status(500).json({ error: "families_mine_failed" });
    }
  })
);

app.post(
  "/api/families",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || "").trim();
    const slugRaw = String(req.body.slug || name).trim();
    const slug = slugify(slugRaw);
    if (!name || !slug) return res.status(400).json({ error: "invalid_data" });

    const id = uuidv4();
    try {
      const dupe = await pool.query("select 1 from families where slug=$1", [slug]);
      if (dupe.rowCount > 0) return res.status(409).json({ error: "slug_in_use" });

      await pool.query(
        `insert into families (id, slug, name, owner_user_id, status)
         values ($1,$2,$3,$4,'pending_admin')`,
        [id, slug, name, req.user.id]
      );
      await pool.query(
        `insert into family_members (family_id, user_id, role, is_active, created_at)
         values ($1,$2,'owner', true, now())
         on conflict do nothing`,
        [id, req.user.id]
      );
      return res
        .status(201)
        .json({ ok: true, family: { id, slug, name, status: "pending_admin", role: "owner" } });
    } catch (e) {
      console.error("create family error:", e);
      return res.status(500).json({ error: "create_family_failed" });
    }
  })
);

app.post(
  "/api/join-requests",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const rawId = String(req.body.family_id || "").trim();
    const slug = String(req.body.family_slug || req.body.slug || "").trim().toLowerCase();
    let familyId = "";
    if (rawId) {
      const f = await pool.query("select id, slug, status from families where id=$1", [rawId]);
      if (f.rowCount === 0) return res.status(404).json({ error: "family_not_found" });
      familyId = f.rows[0].id;
    } else if (slug) {
      const f = await pool.query("select id, slug, status from families where slug=$1", [slug]);
      if (f.rowCount === 0) return res.status(404).json({ error: "family_not_found" });
      familyId = f.rows[0].id;
    } else {
      return res.status(400).json({ error: "invalid_data" });
    }
    const id = uuidv4();
    try {
      await pool.query(
        `insert into join_requests (id, family_id, requester_user_id, status)
         values ($1,$2,$3,'pending') on conflict do nothing`,
        [id, familyId, req.user.id]
      );
      return res.status(201).json({ ok: true });
    } catch (e1) {
      try {
        await pool.query(
          `insert into join_requests (id, family_id, username, status)
           values ($1,$2,$3,'pending') on conflict do nothing`,
          [id, familyId, req.user.username]
        );
        return res.status(201).json({ ok: true });
      } catch (e2) {
        console.error("join request error:", e2 || e1);
        return res.status(500).json({ error: "join_request_failed" });
      }
    }
  })
);

// Owner: listar solicitações pendentes
app.get(
  "/api/families/:id/join-requests",
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!DB_ENABLED) return res.json([]);
    const { id } = req.params;
    const own = await pool.query(
      "select 1 from families where id=$1 and owner_user_id=$2",
      [id, req.user.id]
    );
    if (own.rowCount === 0) return res.status(403).json({ error: "not_owner" });
    try {
      const r = await pool.query(
        `select jr.id, u.username, jr.status, jr.created_at
           from join_requests jr
           join users u on u.id = jr.requester_user_id
          where jr.family_id=$1 and jr.status='pending'
          order by jr.created_at asc`,
        [id]
      );
      return res.json(r.rows || []);
    } catch (e1) {
      try {
        const r2 = await pool.query(
          `select id, username, status, created_at
             from join_requests
            where family_id=$1 and status='pending'
            order by created_at asc`,
          [id]
        );
        return res.json(r2.rows || []);
      } catch (e2) {
        console.error("list join-requests error:", e2 || e1);
        return res.json([]);
      }
    }
  })
);

// Owner: aprovar
app.post(
  "/api/join-requests/:id/approve",
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!DB_ENABLED) return res.status(400).json({ error: "db_required" });
    const { id } = req.params;
    let r;
    try {
      const jr = await pool.query(
        `select id, family_id, requester_user_id as user_id, status from join_requests where id=$1`,
        [id]
      );
      if (jr.rowCount === 0) return res.status(404).json({ error: "not_found" });
      r = jr.rows[0];
    } catch {
      const jr2 = await pool.query(
        `select id, family_id, username, status from join_requests where id=$1`,
        [id]
      );
      if (jr2.rowCount === 0) return res.status(404).json({ error: "not_found" });
      const rec = jr2.rows[0];
      const u = await pool.query(`select id from users where username=$1`, [rec.username]);
      if (u.rowCount === 0) return res.status(404).json({ error: "user_not_found" });
      r = { family_id: rec.family_id, user_id: u.rows[0].id, username: rec.username };
    }
    const own = await pool.query(
      "select 1 from families where id=$1 and owner_user_id=$2",
      [r.family_id, req.user.id]
    );
    if (own.rowCount === 0) return res.status(403).json({ error: "not_owner" });

    // Reativa vínculos existentes por user_id/username (compatibilidade)
    try {
      await pool.query(
        `update family_members set is_active=true where family_id=$1 and user_id=$2`,
        [r.family_id, r.user_id]
      );
    } catch {}
// Evita duplicadas mesmo sem índice único
    try {
      await pool.query(
        `insert into family_members (family_id, user_id, role, is_active, created_at)
         select $1, $2, 'member', true, now()
         where not exists (select 1 from family_members where family_id=$1 and user_id=$2)`,
        [r.family_id, r.user_id]
      );
    } catch {}
    

    try {
      await pool.query(
        `update join_requests set status='approved', decided_by_user_id=$1, decided_at=now()
         where id=$2 and status='pending'`,
        [req.user.id, id]
      );
    } catch {
      try {
        await pool.query(
          `update join_requests set status='approved', decided_by=$1, decided_at=now()
           where id=$2 and status='pending'`,
          [req.user.username || req.user.id, id]
        );
      } catch {
        await pool.query(
          `update join_requests set status='approved' where id=$1 and status='pending'`,
          [id]
        );
      }
    }
    return res.json({ ok: true });
  })
);

// Owner: rejeitar
app.post(
  "/api/join-requests/:id/reject",
  authMiddleware,
  asyncHandler(async (req, res) => {
    if (!DB_ENABLED) return res.status(400).json({ error: "db_required" });
    const { id } = req.params;
    const jr = await pool.query(`select id, family_id from join_requests where id=$1`, [id]);
    if (jr.rowCount === 0) return res.status(404).json({ error: "not_found" });
    const r = jr.rows[0];
    const own = await pool.query(
      "select 1 from families where id=$1 and owner_user_id=$2",
      [r.family_id, req.user.id]
    );
    if (own.rowCount === 0) return res.status(403).json({ error: "not_owner" });
    try {
      await pool.query(
        `update join_requests set status='rejected', decided_by_user_id=$1, decided_at=now()
         where id=$2 and status='pending'`,
        [req.user.id, id]
      );
    } catch {
      try {
        await pool.query(
          `update join_requests set status='rejected', decided_by=$1, decided_at=now()
           where id=$2 and status='pending'`,
          [req.user.username || req.user.id, id]
        );
      } catch {
        await pool.query(
          `update join_requests set status='rejected' where id=$1 and status='pending'`,
          [id]
        );
      }
    }
    return res.json({ ok: true });
  })
);

// Listar membros (da família)
app.get(
  "/api/families/:id/members",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const activeOnly = String(req.query.active_only || "true") === "true";
    const m = await pool.query(
      "select 1 from family_members where family_id=$1 and user_id=$2 and is_active",
      [id, req.user.id]
    );
    if (m.rowCount === 0) return res.status(403).json({ error: "not_member" });
    const rows = await pool.query(
      `select u.id, u.display_name, max(fm.role) as role, bool_or(fm.is_active) as is_active
         from family_members fm
         join users u on u.id = fm.user_id
        where fm.family_id=$1
        group by u.id, u.display_name, u.username
        ${activeOnly ? 'having bool_or(fm.is_active)' : ''}
        order by u.display_name asc nulls last, u.username asc`,
      [id]
    );
    return res.json(rows.rows || []);
  })
);

// Remover membro (somente dono)
app.delete(
  "/api/families/:id/members/:userId",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { id, userId } = req.params;
    const own = await pool.query(
      "select 1 from families where id=$1 and owner_user_id=$2",
      [id, req.user.id]
    );
    if (own.rowCount === 0) return res.status(403).json({ error: "not_owner" });
    if (String(userId) === String(req.user.id))
      return res.status(400).json({ error: "cannot_remove_self" });
    await pool.query("update family_members set is_active=false where family_id=$1 and user_id=$2", [
      id,
      userId,
    ]);
    return res.json({ ok: true });
  })
);


// ---- Money helpers (pt-BR) ----
function parseMoneyBR(s) {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s).trim();
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  if (hasComma && !hasDot) return Number(str.replace(/\./g,'').replace(',','.')) || 0;
  if (hasDot && !hasComma) return Number(str) || 0;
  return Number(str.replace(/\./g,'').replace(',','.')) || 0;
}
function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }
// ====== Purchases ======
// Criar compra
app.post(
  "/api/purchases",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const familyId = await getActiveFamilyIdOrNull(req.user.id);
    if (!familyId) return res.status(403).json({ error: "no_active_family" });

    const estabelecimento = String(req.body.estabelecimento || "").trim() || null;

    let emissao = req.body.emissao ? new Date(req.body.emissao) : new Date();
    if (isNaN(emissao.getTime())) emissao = new Date();

    const mtpNorm = normalizeMtp(req.body.mtp || null);
const discountNorm = parseMoneyBR(req.body.discount ?? 0);
let computedTotal = parseMoneyBR(req.body.total ?? 0);

// Tipo/parcelas (ajuste: parcelado requer >=2; caso contrário, à vista)
let tipo = req.body.pagamento_tipo === "parcelado" ? "parcelado" : "avista";
let parcelas = Number(req.body.pagamento_parcelas || 1);
if (!parcelas || parcelas < 1) parcelas = 1;
if (tipo === "parcelado" && parcelas < 2) { tipo = "avista"; parcelas = 1; }

const itemsRaw = Array.isArray(req.body.items) ? req.body.items : [];
    const itemsNorm = itemsRaw.map((it) => ({
      name: String(it?.name || "Item"),
      qty: Number(it?.qty || 1) || 1,
      total: parseMoneyBR(it?.total || 0),
    }));

    
    // Server-side recalc do total
    const sumItems = itemsNorm.reduce((acc, it) => acc + (Number(it.total) || 0), 0);
    const calc = round2(sumItems - discountNorm);
    if (calc > 0 && Math.abs(calc - computedTotal) > 0.009) computedTotal = calc;
    if (!(computedTotal > 0)) { return res.status(400).json({ error: "invalid_total" }); }

// IDs de tags vindos do front
    let tagIds = Array.isArray(req.body.tags) ? req.body.tags.filter(Boolean) : [];

    const client = await pool.connect();
    try {
      await client.query("begin");

      const id = uuidv4();

      // Coluna legado "tag": manter null para compatibilidade do INSERT
      const tagLegacy = null;

      await client.query(
        `
        insert into purchases
          (id, family_id, created_by_user_id, created_by, estabelecimento, emissao, tag, mtp, discount, total, pagamento_tipo, pagamento_parcelas)
        values
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          id, // $1
          familyId, // $2
          req.user.id, // $3
          req.user.username, // $4
          estabelecimento, // $5
          emissao, // $6
          tagLegacy, // $7
          mtpNorm || null, // $8
          Number(discountNorm), // $9
          Number(Number(computedTotal).toFixed(2)), // $10
          tipo, // $11
          parcelas, // $12
        ]
      );

      // Tags N:N
      if (tagIds.length) {
        const r = await client.query(
          `select id from tags where family_id=$1 and id = any($2::uuid[])`,
          [familyId, tagIds]
        );
        tagIds = r.rows.map((r) => r.id);
      }
      if (tagIds.length === 0) {
        const outrosId = await ensureOutrosTagId(familyId);
        tagIds = [outrosId];
      }
      for (const tg of tagIds) {
        await client.query(
          `insert into purchase_tags (purchase_id, tag_id)
           values ($1,$2) on conflict do nothing`,
          [id, tg]
        );
      }

      // Parcelas
      const parts =
        tipo === "parcelado" && parcelas > 1
          ? splitAmount(computedTotal, parcelas)
          : [Number(computedTotal)];
      for (let i = 0; i < parts.length; i++) {
        const due = addMonths(emissao, i);
        await client.query(
          "insert into installments(purchase_id, n, due_date, amount) values ($1,$2,$3,$4)",
          [id, i + 1, due, parts[i]]
        );
      }

      // Itens
      for (const it of itemsNorm) {
        await client.query(
          "insert into purchase_items(purchase_id, name, qty, total) values ($1,$2,$3,$4)",
          [id, String(it.name || "Item"), Number(it.qty || 1), Number(it.total || 0)]
        );
      }

      await client.query("commit");
      return res.json({ ok: true, purchase: { id } });
    } catch (e) {
      try {
        await client.query("rollback");
      } catch {}
      console.error(e);
      return res.status(500).json({ error: "Erro ao criar compra (DB)" });
    } finally {
      client.release();
    }
  })
);

// Listar compras com filtros
app.get(
  "/api/purchases",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const familyId = await getActiveFamilyIdOrNull(req.user.id);
    if (!familyId) return res.status(403).json({ error: "no_active_family" });

    const userParam = req.query.user ?? "me";
    const mtpQ = normalizeMtp(req.query.mtp || "");
    const { month } = req.query;
    const view = String(req.query.view || "parcelas"); 
    const emissaoField = view === "compras" ? "p.emissao" : "i.due_date";
    const orderEmissao = emissaoField;
// 'parcelas' (default) ou 'compras'

    // tags: ids via tags[] e nome via tag (compat)
    const tagName = String(req.query.tag ?? "").trim();
    let tagsIdsRaw = req.query["tags[]"] ?? req.query.tags;
    const hasTagsIds = Array.isArray(tagsIdsRaw)
      ? tagsIdsRaw.length > 0
      : typeof tagsIdsRaw === "string" && tagsIdsRaw.length > 0;
    const tagsIds = hasTagsIds
      ? Array.isArray(tagsIdsRaw)
        ? tagsIdsRaw
        : [tagsIdsRaw]
      : [];

    const clauses = ["p.family_id = $1"];
    const params = [familyId];
    let i = 2;

    // filtro por usuários
    let users = req.query["users[]"] ?? req.query.users;
    const hasUsers = Array.isArray(users) ? users.length > 0 : typeof users === "string";
    const userFilter =
      userParam === "me" ? req.user.id : !hasUsers && userParam !== "all" ? userParam : null;
    if (hasUsers) {
      const arr = Array.isArray(users) ? users : [users];
      clauses.push(`p.created_by_user_id = ANY($${i++}::uuid[])`);
      params.push(arr);
    } else if (userFilter) {
      clauses.push(`p.created_by_user_id = $${i++}`);
      params.push(userFilter);
    }

    // filtro por tags
    if (hasTagsIds) {
      clauses.push(`
        exists (
          select 1 from purchase_tags z
          where z.purchase_id = p.id
            and z.tag_id = any($${i++}::uuid[])
        )
      `);
      params.push(tagsIds);
    } else if (tagName) {
      clauses.push(`
        exists (
          select 1
            from purchase_tags z
            join tags tt on tt.id = z.tag_id
          where z.purchase_id = p.id
            and lower(tt.name) = lower($${i++})
        )
      `);
      params.push(tagName);
    }

    // mtp
    if (mtpQ && !["all", "(todos)", "todos", "undefined", "null"].includes(mtpQ)) {
      clauses.push(`coalesce(p.mtp,'') = $${i++}`);
      params.push(mtpQ);
    }

    // mês
    if (month && month !== "all") {
      if (view === "compras") {
        clauses.push(`to_char(p.emissao at time zone 'UTC','YYYY-MM') = $${i++}`);
      } else {
        clauses.push(`to_char(i.due_date at time zone 'UTC','YYYY-MM') = $${i++}`);
      }
      params.push(month);
    }

    const where = "where " + clauses.join(" and ");

    const sqlP = `
      select
        p.id,
        p.created_by,
        p.created_by_user_id,
        p.estabelecimento,
        ${emissaoField} as emissao,
        p.tag,                      -- legado (fica null nas novas)
        coalesce(p.mtp,'') as mtp,
        p.discount,
        p.total,
        p.pagamento_tipo,
        p.pagamento_parcelas,

        i.n as installment_idx,
        p.pagamento_parcelas as installment_count,
        i.amount as total_month,
        (p.id::text || '#' || i.n::text) as row_key,

        coalesce(
          json_agg(
            distinct jsonb_build_object('name', pi.name, 'qty', pi.qty, 'total', pi.total)
          ) filter (where pi.purchase_id is not null),
          '[]'::json
        ) as items,

        coalesce(
          json_agg(
            distinct jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
          ) filter (where t.id is not null),
          '[]'::json
        ) as tags

      from purchases p
      join installments i on i.purchase_id = p.id
      left join purchase_items pi on pi.purchase_id = p.id
      left join purchase_tags pt on pt.purchase_id = p.id
      left join tags t on t.id = pt.tag_id

      ${where}
      group by
        p.id, p.created_by, p.estabelecimento, ${emissaoField}, p.tag, p.mtp,
        p.discount, p.total, p.pagamento_tipo, p.pagamento_parcelas,
        i.n, i.amount
      order by ${orderEmissao} asc, p.id asc, i.n asc
    `;

    try {
      const rP = await pool.query(sqlP, params);
      const purchases = rP.rows.map((row) => ({
        id: row.id,
        row_key: row.row_key,
        createdBy: row.created_by,
        
        created_by_user_id: row.created_by_user_id,
        estabelecimento: row.estabelecimento,
        emissao: toISO(row.emissao),
        tag: row.tag, // legado
        mtp: row.mtp,
        discount: Number(row.discount || 0),
        total: Number(row.total),
        total_month: Number(row.total_month || row.total || 0),
        installment_idx: row.installment_idx || null,
        installment_count: row.installment_count || null,
        pagamento: {
          tipo: row.pagamento_tipo || "avista",
          parcelas: row.pagamento_parcelas || 1,
        },
        items: Array.isArray(row.items) ? row.items : [],
        tags: Array.isArray(row.tags) ? row.tags : [],
      }));
      return res.json({ purchases });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Erro ao listar compras" });
    }
  })
);

// Deletar compra
app.delete(
  "/api/purchases/:id",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Verifica acesso e família ativa
    const access = await getAccessState(req.user.id);
    if (!access?.allowed || !access?.family?.id) {
      return res.status(403).json({ error: "no_family_access" });
    }
    const activeFamilyId = access.family.id;
    const isOwner = access.family.role === 'owner';

    try {
      // Carrega a compra e confere a família
      const r = await pool.query(
        "select id, family_id, created_by_user_id from purchases where id=$1 limit 1",
        [id]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });
      const p = r.rows[0];
      if (String(p.family_id) !== String(activeFamilyId)) {
        return res.status(403).json({ error: "forbidden" });
      }

      // Permissão: dono da família OU autor da compra
      const isAuthor = String(p.created_by_user_id) === String(req.user.id);
      if (!isOwner && !isAuthor) {
        return res.status(403).json({ error: "forbidden" });
      }

      // Exclui dependências e a compra (compatível com bancos sem ON DELETE CASCADE)
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('delete from purchase_tags where purchase_id=$1', [id]);
        await client.query('delete from purchase_items where purchase_id=$1', [id]);
        await client.query('delete from installments where purchase_id=$1', [id]);
        await client.query('delete from purchases where id=$1 and family_id=$2', [id, activeFamilyId]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
      return res.json({ ok: true, removed: 1 });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Erro ao deletar (DB)" });
    }
  })
);// Export CSV (ledger)
app.get(
  "/api/export.csv",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const access = await getAccessState(req.user.id);
    if (!access.allowed) return res.status(403).json({ error: "no_family_access" });
    const userParam = req.query.user ?? "me";
    const { tag, month } = req.query;
    const mtpQ = normalizeMtp(req.query.mtp || "");

    try {
      // compat: export usa filtro simples
      const userFilter = userParam === "me" ? req.user.username : userParam;
      const whereClauses = [];
      const params = [];
      let i = 1;

      if (userFilter && userFilter !== "all") {
        whereClauses.push(`p.created_by = $${i++}`);
        params.push(userFilter);
      }
      const t = (tag || "").toString().trim().toLowerCase();
      if (t && !["all", "(todas)", "todas", "undefined", "null"].includes(t)) {
        whereClauses.push(`coalesce(p.tag,'') = $${i++}`);
        params.push(tag);
      }
      if (mtpQ && !["all", "(todos)", "todos", "undefined", "null"].includes(mtpQ)) {
        whereClauses.push(`coalesce(p.mtp,'') = $${i++}`);
        params.push(mtpQ);
      }
      if (month && month !== "all") {
        whereClauses.push(`to_char(i.due_date at time zone 'UTC','YYYY-MM') = $${i++}`);
        params.push(month);
      }
      const where = whereClauses.length ? "where " + whereClauses.join(" and ") : "";

      const sql = `
        select p.id as purchase_id, p.created_by as usuario, p.created_by_user_id, p.estabelecimento, p.tag,
               coalesce(p.mtp,'') as mtp, p.emissao,
               i.due_date as vencimento, i.n, p.pagamento_parcelas, i.amount
        from purchases p
        join installments i on i.purchase_id = p.id
        ${where}
        order by i.due_date asc
      `;
      const r = await pool.query(sql, params);
      const ledger = r.rows.map((x) => ({
        purchaseId: x.purchase_id,
        usuario: x.usuario,
        estabelecimento: x.estabelecimento,
        tag: x.tag,
        mtp: x.mtp,
        emissao: toISO(x.emissao),
        vencimento: toISO(x.vencimento),
        parcela: `${x.n}/${x.pagamento_parcelas || 1}`,
        valor: Number(x.amount).toFixed(2).replace(".", ","),
      }));
      const headers = [
        "purchaseId",
        "usuario",
        "estabelecimento",
        "tag",
        "mtp",
        "emissao",
        "vencimento",
        "parcela",
        "valor",
      ];
      const csv =
        [headers.join(";")]
          .concat(ledger.map((r) => headers.map((h) => r[h] ?? "").join(";")))
          .join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="export-${month || "todos"}.csv"`
      );
      return res.send("\ufeff" + csv);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Erro no export (DB)" });
    }
  })
);

// ====== NFC-e ======
app.post(
  "/api/nfce/import-json",
  authMiddleware,
  asyncHandler(async (req, res) => {
    try {
      const purchase = await importFromParsedJson(req.body);
      res.json({ ok: true, purchase });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  })
);

app.post(
  "/api/nfce/import-qrcode",
  authMiddleware,
  asyncHandler(async (req, res) => {
    try {
      const { qr, debug } = req.body;
      if (!qr) return res.status(400).json({ error: "Informe o conteúdo do QR Code" });
      const raw = await fetchFromQrCode(qr, { debug: !!debug });
      const unified = await importFromParsedJson({
        estabelecimento: raw.estabelecimento,
        emissao: raw.emissao,
        itens: raw.itens,
        desconto: raw.desconto,
        total_nota: raw.total_nota,
      });
      return res.json({ ok: true, purchase: unified });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  })
);

// Minhas solicitações de entrada (pendentes/recentes)
app.get(
  "/api/join-requests/mine",
  authMiddleware,
  asyncHandler(async (req, res) => {
    try {
      const r = await pool.query(
        `select jr.id, jr.family_id, jr.status, jr.created_at, f.name, f.slug
           from join_requests jr
           join families f on f.id = jr.family_id
          where jr.requester_user_id = $1
          order by jr.created_at desc`,
        [req.user.id]
      );
      return res.json(r.rows || []);
    } catch (e1) {
      // Fallback legacy username
      const u = await pool.query("select username from users where id=$1", [req.user.id]);
      const username = u.rows[0]?.username;
      if (!username) return res.json([]);
      const r2 = await pool.query(
        `select jr.id, jr.family_id, jr.status, jr.created_at, f.name, f.slug
           from join_requests jr
           join families f on f.id = jr.family_id
          where jr.username = $1
          order by jr.created_at desc`,
        [username]
      );
      return res.json(r2.rows || []);
    }
  })
);

// Cancelar minha solicitação de entrada
app.post(
  "/api/join-requests/:id/cancel",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    try {
      const r = await pool.query(
        "select id, requester_user_id, status from join_requests where id=$1",
        [id]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });
      const jr = r.rows[0];
      if (String(jr.requester_user_id) !== String(req.user.id))
        return res.status(403).json({ error: "forbidden" });
      try {
        await pool.query(
          `update join_requests set status='cancelled', decided_by_user_id=$1, decided_at=now()
           where id=$2 and status='pending'`,
          [req.user.id, id]
        );
      } catch {
        try {
          await pool.query(
            `update join_requests set status='cancelled', decided_by=$1, decided_at=now()
             where id=$2 and status='pending'`,
            [req.user.username || req.user.id, id]
          );
        } catch {
          await pool.query(
            `update join_requests set status='cancelled' where id=$1 and status='pending'`,
            [id]
          );
        }
      }
      return res.json({ ok: true });
    } catch (e1) {
      // Fallback: legacy username schema
      const u = await pool.query("select username from users where id=$1", [req.user.id]);
      const username = u.rows[0]?.username;
      const r2 = await pool.query(
        "select id, username, status from join_requests where id=$1",
        [id]
      );
      if (r2.rowCount === 0) return res.status(404).json({ error: "not_found" });
      const jr2 = r2.rows[0];
      if (String(jr2.username) !== String(username))
        return res.status(403).json({ error: "forbidden" });
      try {
        await pool.query(
          `update join_requests set status='cancelled', decided_by_user_id=$1, decided_at=now()
           where id=$2 and status='pending'`,
          [req.user.id, id]
        );
      } catch {
        try {
          await pool.query(
            `update join_requests set status='cancelled', decided_by=$1, decided_at=now()
             where id=$2 and status='pending'`,
            [req.user.username || req.user.id, id]
          );
        } catch {
          await pool.query(
            `update join_requests set status='cancelled' where id=$1 and status='pending'`,
            [id]
          );
        }
      }
      return res.json({ ok: true });
    }
  })
);

// Cancelar criação de família (apenas se pendente de admin e sou dono)
app.delete(
  "/api/families/:id",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const f = await pool.query(
      "select id, owner_user_id, status from families where id=$1",
      [id]
    );
    if (f.rowCount === 0) return res.status(404).json({ error: "not_found" });
    const fam = f.rows[0];
    if (String(fam.owner_user_id) !== String(req.user.id))
      return res.status(403).json({ error: "forbidden" });
    if (String(fam.status) !== "pending_admin")
      return res.status(400).json({ error: "cannot_cancel" });
    await pool.query("delete from families where id=$1", [id]);
    return res.json({ ok: true });
  })
);

// ====== /PORT & SERVER ======
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Finanças rodando na porta http://localhost:${PORT}`);
});

// SPA fallback (non-API GETs)
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  try {
    if (fs.existsSync(path.join(WEB_DIST, "index.html"))) {
      return res.sendFile(path.join(WEB_DIST, "index.html"));
    }
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } catch (e) {
    next();
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  const code = err.code || (status >= 500 ? "server_error" : "request_error");
  const msg = typeof err === "string" ? err : err.message || "server_error";
  res.status(status).json({ error: msg, code, requestId: req.id });
});

server.on("error", (err) => {
  console.error("💥 Erro ao subir servidor:", err);
  if (err && err.code === "EADDRINUSE") {
    console.error(`🔒 Porta ${PORT} já está em uso. Saindo...`);
  }
  process.exit(1);
});

function gracefulExit(signal) {
  console.log(`⚠️ Recebido ${signal}, encerrando...`);
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => gracefulExit("SIGTERM"));
process.on("SIGINT", () => gracefulExit("SIGINT"));
