import express from 'express';
import { randomBytes } from 'crypto';
import { db } from '../db.js';
import { hashPassword } from '../auth-utils.js';
import { nowIso } from '../utils/time.js';

const INVITE_EXPIRY_HOURS = 72;

function generateToken() {
  return randomBytes(32).toString('hex');
}

function expiresAt() {
  return new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
}

export function createInviteRouter() {
  const router = express.Router();

  // Validate an invite token and return the user's email
  router.get('/auth/invite/:token', (req, res) => {
    const { token } = req.params;
    const row = db
      .prepare(
        `SELECT it.token, it.expires_at, it.used, u.email
         FROM invite_tokens it
         JOIN users u ON u.id = it.user_id
         WHERE it.token = ?`
      )
      .get(token);

    if (!row) return res.status(404).json({ message: 'Invalid invite link.' });
    if (row.used) return res.status(410).json({ message: 'This invite link has already been used.' });
    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ message: 'This invite link has expired.' });
    }

    res.json({ email: row.email });
  });

  // Accept an invite: set password and activate account
  router.post('/auth/accept-invite', (req, res) => {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');

    if (!token) return res.status(400).json({ message: 'token required' });
    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const row = db
      .prepare(
        `SELECT it.token, it.expires_at, it.used, it.user_id
         FROM invite_tokens it
         WHERE it.token = ?`
      )
      .get(token);

    if (!row) return res.status(404).json({ message: 'Invalid invite link.' });
    if (row.used) return res.status(410).json({ message: 'This invite link has already been used.' });
    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ message: 'This invite link has expired.' });
    }

    const now = nowIso();
    db.prepare(`UPDATE users SET password_hash = ?, status = 'ACTIVE', updated_at = ? WHERE id = ?`)
      .run(hashPassword(password), now, row.user_id);
    db.prepare(`UPDATE invite_tokens SET used = 1 WHERE token = ?`)
      .run(token);

    res.json({ message: 'Password set. You can now log in.' });
  });

  return router;
}

// Called from the user creation route to generate an invite token
export function createInviteToken(userId) {
  const token = generateToken();
  const now = nowIso();
  db.prepare(
    `INSERT INTO invite_tokens (token, user_id, expires_at, used, created_at)
     VALUES (?, ?, ?, 0, ?)`
  ).run(token, userId, expiresAt(), now);
  return token;
}
