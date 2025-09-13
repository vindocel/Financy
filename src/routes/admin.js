import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { signAdmin } from '../services/jwt.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { cookieOptsAdmin } from '../util/cookies.js';

export const adminRouter = express.Router();

adminRouter.get('/login', (req, res) => {
  res.type('html').send(`
    <html><head><title>Admin Login</title></head>
    <body style="font-family:sans-serif;max-width:560px;margin:40px auto;">
      <h2>Admin — Login</h2>
      <form method="post" action="/admin/login">
        <label>Usuário ou e-mail<br/><input name="id" required/></label><br/><br/>
        <label>Senha<br/><input name="password" type="password" required/></label><br/><br/>
        <button type="submit">Entrar</button>
      </form>
    </body></html>`);
});

adminRouter.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
  const id = (req.body.id || '').toLowerCase().trim();
  const password = req.body.password || '';
  const { rows } = await query(
    `SELECT id, email, username, password_hash, status FROM admins WHERE email=$1 OR username=$1`,
    [id]
  );
  const admin = rows[0];
  if (!admin || admin.status !== 'active') return res.status(401).send('Credenciais inválidas');
  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) return res.status(401).send('Credenciais inválidas');
  const token = signAdmin({ id: admin.id, username: admin.username });
  res.cookie('admin_session', token, cookieOptsAdmin());
  res.redirect('/admin/dashboard');
});

adminRouter.get('/logout', (req, res) => {
  res.clearCookie('admin_session', cookieOptsAdmin());
  res.redirect('/admin/login');
});

// Dashboard
adminRouter.get('/dashboard', requireAdmin, async (req, res) => {
  // families table may not exist; handle gracefully
  let pendingFamilies = { rows: [] };
  try {
    // Compatível com schema do app atual (owner_username)
    pendingFamilies = await query(
      `SELECT f.id, f.slug, f.status, f.created_at,
              u.email AS owner_email
         FROM families f
         LEFT JOIN users u ON u.username = f.owner_username
        WHERE f.status = 'pending_admin'
        ORDER BY f.created_at ASC`
    );
  } catch {}

  let admins = { rows: [] };
  try {
    admins = await query(`SELECT id, email, username, status, created_at FROM admins ORDER BY created_at DESC`);
  } catch {}

  res.type('html').send(`
    <html><head><title>Admin Dashboard</title></head>
    <body style="font-family:sans-serif;max-width:980px;margin:40px auto;">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>Admin — Dashboard</h2>
        <a href="/admin/logout">Sair</a>
      </div>
      <hr/>

      <h3>Pendências: Criação de Famílias</h3>
      ${pendingFamilies.rows.length === 0 ? '<p>Nenhuma.</p>' : ''}
      ${pendingFamilies.rows.map(f => `
        <form method="post" action="/admin/families/${f.id}/decision" style="padding:8px;border:1px solid #ddd;border-radius:8px;margin:8px 0;">
          <div><b>slug:</b> ${f.slug} — <b>owner:</b> ${f.owner_email} — <b>desde:</b> ${new Date(f.created_at).toISOString()}</div>
          <input type="hidden" name="decision" value="approve"/>
          <button type="submit">Aprovar</button>
          <button type="submit" formaction="/admin/families/${f.id}/reject">Rejeitar</button>
        </form>
      `).join('')}

      <hr/>
      <h3>Admins</h3>
      <ul>
        ${admins.rows.map(a => `<li>${a.email} (@${a.username}) — ${a.status}</li>`).join('')}
      </ul>

      <h4>Novo Admin</h4>
      <form method="post" action="/admin/admins">
        <input name="email" placeholder="email" required/>
        <input name="username" placeholder="username" required/>
        <input name="password" placeholder="senha" type="password" required/>
        <button type="submit">Criar</button>
      </form>
    </body></html>
  `);
});

adminRouter.post('/families/:id/decision', requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
  const id = req.params.id;
  try {
    await query(
      `UPDATE families
          SET status='active', approved_by=$1, approved_at=now()
        WHERE id=$2 AND status='pending_admin'`,
      [req.admin.username || req.admin.id, id]
    );
    await query(
      `INSERT INTO audit_log (actor_admin_id, action, object_type, object_id, data)
       VALUES ($1,'approve','family',$2, '{}')`,
      [req.admin.id, id]
    );
  } catch {}
  res.redirect('/admin/dashboard');
});

adminRouter.post('/families/:id/reject', requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
  const id = req.params.id;
  try {
    await query(
      `UPDATE families
          SET status='rejected', approved_by=$1, approved_at=now()
        WHERE id=$2 AND status='pending_admin'`,
      [req.admin.username || req.admin.id, id]
    );
    await query(
      `INSERT INTO audit_log (actor_admin_id, action, object_type, object_id, data)
       VALUES ($1,'reject','family',$2, '{}')`,
      [req.admin.id, id]
    );
  } catch {}
  res.redirect('/admin/dashboard');
});

adminRouter.post('/admins', requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const username = (req.body.username || '').toLowerCase().trim();
  const password = req.body.password || '';
  if (!email || !username || !password) return res.status(400).send('Dados obrigatórios');
  const hash = await bcrypt.hash(password, 12);
  await query(
    `INSERT INTO admins (email, username, password_hash) VALUES ($1,$2,$3)`,
    [email, username, hash]
  );
  await query(
    `INSERT INTO audit_log (actor_admin_id, action, object_type, object_id, data)
     VALUES ($1,'create','admin',NULL, jsonb_build_object('email',$2,'username',$3))`,
    [req.admin.id, email, username]
  );
  res.redirect('/admin/dashboard');
});

export default adminRouter;
