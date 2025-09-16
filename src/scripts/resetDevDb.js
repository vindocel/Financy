import 'dotenv/config';
import { query } from '../db.js';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_PRESERVE = new Set(['admins', 'state_features']);

const USER_TABLES = [
  'password_resets',
  'pending_member_exits',
  'join_requests',
  'purchases',
  'family_members',
  'families',
  'users',
  'audit_log'
];

async function listTables() {
  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
  );
  return rows.map((r) => r.table_name);
}

function parseArgs() {
  const args = new Map();
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.startsWith('--') ? a.slice(2).split('=') : [a, true];
    args.set(k, v ?? true);
  }
  return args;
}

async function main() {
  if ((process.env.APP_ENV || '').toLowerCase() === 'production') {
    throw new Error('NÃO execute reset em produção. Abortado.');
  }

  const args = parseArgs();
  const modeAll = args.has('all');
  const modeOnlyUsers = args.has('only-users');
  const preserveArg = args.get('preserve');
  const preserve = new Set([...DEFAULT_PRESERVE, ...(preserveArg ? preserveArg.split(',') : [])].map((s) => s.trim()));

  const rl = readline.createInterface({ input, output });
  console.log('⚠ Esta operação irá APAGAR dados no banco (dev).');
  const ack = await rl.question('Para confirmar, digite: I UNDERSTAND\n> ');
  if (ack.trim() !== 'I UNDERSTAND') {
    console.log('Abortado.');
    process.exit(1);
  }
  await rl.close();

  const allTables = await listTables();

  let toTruncate;
  if (modeAll) {
    toTruncate = allTables.filter((t) => !preserve.has(t));
  } else if (modeOnlyUsers) {
    toTruncate = USER_TABLES.filter((t) => allTables.includes(t) && !preserve.has(t));
  } else {
    toTruncate = USER_TABLES.filter((t) => allTables.includes(t) && !preserve.has(t));
  }

  if (toTruncate.length === 0) {
    console.log('Nada para truncar.');
    return;
  }

  const sql = `TRUNCATE TABLE ${toTruncate.map((t) => '"' + t + '"').join(', ')} RESTART IDENTITY CASCADE;`;
  console.log('Executando:', sql);
  await query(sql);
  console.log('✔ Limpeza concluída. Preservado:', [...preserve].join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
