import crypto from 'node:crypto';
import { config } from './config.js';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const COOKIE = 'sq_session';

export function createSession(db, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, expires.toISOString());
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, expires, path: '/' });
}

export function destroySession(db, req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionUser(db, req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = db.prepare(
    'SELECT u.id, u.email, u.is_demo, u.is_guest, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  ).get(sha(token));
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
    return null;
  }
  return { id: row.id, email: row.email, is_demo: !!row.is_demo, is_guest: !!row.is_guest };
}

/** Tiny in-memory rate limiter: at most `limit` hits per `windowMs` per key. Old keys are dropped so memory stays small. */
export function rateLimiter(limit, windowMs) {
  const hits = new Map();
  let lastSweep = Date.now();
  return (key) => {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, arr] of hits) if (!arr.length || now - arr[arr.length - 1] >= windowMs) hits.delete(k);
      lastSweep = now;
    }
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    return arr.length <= limit;
  };
}

/**
 * Suspicious activity goes to the server log (Railway > Deployments > Logs), one line each, starting with [security].
 * Never passwords, tokens or message text; email addresses are shortened (ma***@gmail.com).
 */
export const maskEmail = (e) => {
  const [u, d] = String(e || '').split('@');
  return d ? `${u.slice(0, 2)}***@${d}` : '';
};
export function securityLog(event, details = {}) {
  if (process.env.NODE_ENV === 'test') return;
  console.warn(`[security] ${new Date().toISOString()} ${event} ${JSON.stringify(details)}`);
}
