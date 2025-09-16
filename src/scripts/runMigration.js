import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, pool } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const rel = process.argv[2] || 'migrations/2025-09-04_admin_and_approvals.sql';
  const file = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(file)) {
    console.error(`[migrate] arquivo não encontrado: ${file}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(file, 'utf-8');
  if (!sql || !sql.trim()) {
    console.error('[migrate] arquivo vazio');
    process.exit(1);
  }
  console.log(`[migrate] aplicando ${path.relative(process.cwd(), file)}…`);
  try {
    await query(sql);
    console.log('[migrate] ✔ concluído');
  } catch (e) {
    console.error('[migrate] ✖ erro:\n', e);
    process.exitCode = 1;
  } finally {
    try { await pool.end(); } catch {}
  }
}

main();

