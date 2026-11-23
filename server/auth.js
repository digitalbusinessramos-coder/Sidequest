import crypto from 'node:crypto';
import { config } from './config.js';

// Passwords: scrypt (memory-hard, recommended by OWASP next to Argon2id and bcrypt) with a random salt per password.
// Cost N=2^15, r=8, p=3 is one of OWASP's recommended settings (32 MiB). Older hashes ("scrypt$…", N=2^14) still work
// and are upgraded automatically the next time that person logs in.
const COST = { N: 2 ** 15, r: 8, p: 3, maxmem: 96 * 1024 * 1024 };
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, COST);
  return ['scrypt2', COST.N, COST.r, COST.p, salt.toString('hex'), hash.toString('hex')].join('$');
}

export function verifyPassword(pw, stored) {
  const parts = String(stored).split('$');
  let opts; let saltHex; let hashHex;
  if (parts[0] === 'scrypt' && parts.length === 3) { [, saltHex, hashHex] = parts; opts = {}; }
  else if (parts[0] === 'scrypt2' && parts.length === 6) {
    const [N, r, p] = parts.slice(1, 4).map(Number);
    if (!(N >= 2 ** 14 && N <= 2 ** 17 && r >= 8 && r <= 16 && p >= 1 && p <= 8)) return false;
    opts = { N, r, p, maxmem: 256 * 1024 * 1024 }; saltHex = parts[4]; hashHex = parts[5];
  } else return false;
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64, opts);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}
/** True for hashes made with an older, cheaper setting (rehash after a successful login). */
export const needsRehash = (stored) => !String(stored).startsWith(['scrypt2', COST.N, COST.r, COST.p, ''].join('$'));
// Used when no account matches, so a wrong email takes as long as a wrong password (no hint whether an account exists).
const DUMMY = hashPassword(crypto.randomBytes(16).toString('hex'));
export const burnPasswordCheck = (pw) => { verifyPassword(pw, DUMMY); return false; };

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const COOKIE = 'sq_session';

/** A new random token on every login, sign-up and account save; the previous one on this browser is removed. */
export function createSession(db, res, userId, req = null) {
  const old = req && readCookie(req, COOKIE);
  if (old) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(old));
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

// Seconds until the limiter that just said no will allow the next try (read right after, for the Retry-After header).
let lastRetryAfter = 60;
export const takeRetryAfter = () => { const v = lastRetryAfter; lastRetryAfter = 60; return v; };

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
    if (arr.length <= limit) return true;
    lastRetryAfter = Math.max(1, Math.ceil((arr[arr.length - limit] + windowMs - now) / 1000));
    return false;
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
