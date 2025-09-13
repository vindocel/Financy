import { verifyUser } from '../services/jwt.js';

export function requireUser(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ ok: false, error: 'not_authenticated' });
  try {
    req.user = verifyUser(token);
    next();
  } catch {
    res.clearCookie('session');
    return res.status(401).json({ ok: false, error: 'invalid_session' });
  }
}

export default requireUser;

