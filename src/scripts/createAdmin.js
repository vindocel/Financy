import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';

async function main() {
  const rl = readline.createInterface({ input, output });
  const email = (await rl.question('Admin email: ')).trim().toLowerCase();
  const username = (await rl.question('Admin username: ')).trim().toLowerCase();
  const password = await rl.question('Admin password: ');
  await rl.close();

  if (!email || !username || !password) {
    console.error('Todos os campos são obrigatórios.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  // Ensure extension (for gen_random_uuid)
  await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  // Create table if missing
  await query(`CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  // Bring columns up-to-date if table exists with older schema
  await query(`ALTER TABLE IF EXISTS admins ADD COLUMN IF NOT EXISTS username TEXT`);
  await query(`ALTER TABLE IF EXISTS admins ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
  // Helpful indexes/constraints (idempotent)
  try { await query(`CREATE UNIQUE INDEX IF NOT EXISTS admins_username_ci_idx ON admins ((lower(username))) WHERE username IS NOT NULL`); } catch {}
  try { await query(`ALTER TABLE admins ADD CONSTRAINT admins_email_lower_chk CHECK (email = lower(email))`); } catch {}

  // Ensure username is set for existing rows if null
  try { await query(`UPDATE admins SET username = split_part(email,'@',1) WHERE username IS NULL OR username = ''`); } catch {}

  // Resolve conflitos de email/username e realiza upsert seguro
  const { rows: byEmailRows } = await query(`SELECT id, email, username FROM admins WHERE email = $1`, [email]);
  let finalUsername = username;

  // Se username já é usado por outro admin, gere um sufixo
  const { rows: byUserRows } = await query(`SELECT id, email FROM admins WHERE lower(username) = lower($1)`, [finalUsername]);
  if (byUserRows.length > 0 && (!byEmailRows.length || byUserRows[0].id !== byEmailRows[0].id)) {
    const suffix = Math.floor(Math.random() * 1000);
    finalUsername = `${finalUsername}${suffix}`;
    console.warn(`Aviso: username em uso. Ajustado para '${finalUsername}'.`);
  }

  if (byEmailRows.length > 0) {
    const current = byEmailRows[0];
    await query(`UPDATE admins SET username=$2, password_hash=$3, status='active', updated_at=now() WHERE id=$1`, [current.id, finalUsername, hash]);
    console.log('✔ Admin atualizado:', email, `(@${finalUsername})`);
  } else {
    await query(`INSERT INTO admins (email, username, password_hash) VALUES ($1,$2,$3)`, [email, finalUsername, hash]);
    console.log('✔ Admin criado:', email, `(@${finalUsername})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
