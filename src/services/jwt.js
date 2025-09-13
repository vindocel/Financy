import jwt from 'jsonwebtoken';

const userSecret = process.env.JWT_SECRET || 'change-me-user';
const adminSecret = process.env.ADMIN_JWT_SECRET || 'change-me-admin';

export const signUser = (payload) => jwt.sign(payload, userSecret, { expiresIn: '7d' });
export const verifyUser = (token) => jwt.verify(token, userSecret);

export const signAdmin = (payload) => jwt.sign(payload, adminSecret, { expiresIn: '12h' });
export const verifyAdmin = (token) => jwt.verify(token, adminSecret);

export default { signUser, verifyUser, signAdmin, verifyAdmin };

