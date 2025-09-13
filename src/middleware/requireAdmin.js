import { verifyAdmin } from '../services/jwt.js';

export function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_session;
  if (!token) return res.redirect('/admin/login');
  try {
    req.admin = verifyAdmin(token);
    next();
  } catch {
    res.clearCookie('admin_session');
    return res.redirect('/admin/login');
  }
}

export default requireAdmin;

