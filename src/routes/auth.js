import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { signUser } from '../services/jwt.js';
import { cookieOptsUser } from '../util/cookies.js';

export const authRouter = express.Router();

// Login do app do usuário (separado do /admin/login)
authRouter.post('/login', express.json(), async (req, res) => {
  const id = (req.body.id || '').toLowerCase().trim();
  const password = req.body.password || '';

  try {
    const { rows } = await query(
      `SELECT id, email, username, password_hash, status FROM users WHERE email=$1 OR username=$1`,
      [id]
    );
    const user = rows[0];
    if (!user || user.status !== 'active') return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'invalid_credentials' });

    // Verifica se já possui acesso (família aprovada e vínculo ativo)
    let accessOk = false;
    try {
      const access = await query(
        `SELECT 1
           FROM family_members fm
           JOIN families f ON f.id = fm.family_id
          WHERE fm.user_id = $1 AND fm.is_active = true AND f.status = 'active'
          LIMIT 1`,
        [user.id]
      );
      accessOk = access.rowCount > 0;
    } catch {
      // Se as tabelas ainda não existem neste ambiente, não bloqueia
      accessOk = true;
    }

    if (!accessOk) {
      return res.status(403).json({
        ok: false,
        error: 'no_family_access',
        message: 'Você ainda não possui acesso: entre em uma família existente (e aguarde aprovação do owner) OU aguarde a aprovação da sua nova família por um Admin.'
      });
    }

    const token = signUser({ id: user.id, username: user.username });
    res.cookie('session', token, cookieOptsUser());
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'login_failed' });
  }
});

export default authRouter;

