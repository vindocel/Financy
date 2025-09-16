import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_SSL === 'true' || /sslmode=require/.test(process.env.DATABASE_URL || ''))
    ? { rejectUnauthorized: false }
    : false,
});

export async function query(sql, params) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export default { pool, query };

