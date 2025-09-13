import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load base .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve APP_ENV with sensible defaults
const APP_ENV = (process.env.APP_ENV || process.env.NODE_ENV || "development").trim();

// Load environment-specific .env.<env> file if present
try {
  dotenv.config({ path: path.resolve(process.cwd(), `.env.${APP_ENV}`), override: false });
} catch {}

const isProd = APP_ENV === "production";
const isDev = APP_ENV === "development";
const isTest = APP_ENV === "test";

// Database (Neon in all envs; no local fallback)
const databaseUrl = process.env.DATABASE_URL || "";

// Email
const emailDriver = (process.env.EMAIL_DRIVER || (isProd ? "resend" : (isTest ? "console" : "mailpit"))).toLowerCase();
const resendApiKey = process.env.RESEND_API_KEY || "";
const senderEmail = process.env.SENDER_EMAIL || "suporte@5vfamily.app";
const fromName = process.env.FROM_NAME || "5vFamily";
const smtpHost = process.env.SMTP_HOST || "localhost";
const smtpPort = Number(process.env.SMTP_PORT || 1025);

// Importers / Scrapers
const importerMode = (process.env.IMPORTER_MODE || "live").toLowerCase();
const scraperDebugArtifacts = String(process.env.SCRAPER_DEBUG_ARTIFACTS || (isDev ? "false" : "false"))
  .toLowerCase() === "true";
const scraperDebugDir = path.resolve(process.cwd(), ".debug");

// Logging / monitoring
const logFormat = (process.env.LOG_FORMAT || (isProd ? "json" : "pretty")).toLowerCase();
const sentryDsn = process.env.SENTRY_DSN || "";

// App base URLs
const appBaseUrl = process.env.APP_BASE_URL || (isDev ? "http://localhost:8080" : "");
const apiBaseUrl = process.env.API_BASE_URL || appBaseUrl;

// Secrets
const jwtSecret = process.env.JWT_SECRET || "troque-esta-chave-super-secreta";
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || "dev-admin-session";

// Admin seed (dev/test only; optional)
const adminSeedUsername = process.env.ADMIN_SEED_USERNAME || "";
const adminSeedEmail = process.env.ADMIN_SEED_EMAIL || "";
const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD || "";

// Filesystem policy
const fileWritesEnabled = !isProd; // In prod, writing files is disabled (except stdout logs)

// Optional dev JSON fallback (strongly discouraged). Off by default; forced off in prod.
const useJsonDb = !isProd && String(process.env.USE_JSON || "").toLowerCase() === "true";

// Cookies policy
const cookie = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProd ? true : false,
  path: "/",
};

// Security params
const bcryptEnv = parseInt(process.env.BCRYPT_COST || (isProd ? "12" : "11"), 10);
const bcryptCost = Math.min(12, Math.max(10, isFinite(bcryptEnv) ? bcryptEnv : 11));

export const config = {
  appEnv: APP_ENV,
  isProd,
  isDev,
  isTest,
  databaseUrl,
  email: {
    driver: emailDriver,
    resendApiKey,
    senderEmail,
    fromName,
    smtp: { host: smtpHost, port: smtpPort },
  },
  importerMode,
  scraperDebugArtifacts,
  scraperDebugDir,
  logFormat,
  sentryDsn,
  appBaseUrl,
  apiBaseUrl,
  jwtSecret,
  adminSessionSecret,
  adminSeedUsername,
  adminSeedEmail,
  adminSeedPassword,
  bcryptCost,
  fileWritesEnabled,
  useJsonDb,
  cookie,
};

export default config;
