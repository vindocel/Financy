import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';

const app = express();
app.use(cookieParser());

// Saúde
app.get('/health', (req, res) => res.json({ ok: true, env: process.env.APP_ENV || 'unknown' }));

// Admin (UI simplificada)
app.use('/admin', adminRouter);

// API do app do usuário
app.use('/auth', authRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`[admin-auth] listening on :${port}`));

