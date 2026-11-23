import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi, HttpError } from './api.js';
import { seed } from './seed.js';
import { config } from './config.js';

export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob: https://tile.openstreetmap.org",
  'frame-src https://www.google.com https://maps.google.com', "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
].join('; ');

export function createApp(db) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    // Only the app's own code may run. Outside sources are limited to what the app really uses:
    // Google Fonts, OpenStreetMap map tiles and the Google Maps embed on plan and event pages.
    res.set('Content-Security-Policy', CSP);
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    // Other websites cannot embed our files (pictures, scripts) in their pages.
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    // Browsers remember to use HTTPS only (the live site always runs on HTTPS).
    if (config.secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  // Resized pictures only (the server still rejects anything over 600 KB once decoded). Every picture upload route
  // needs this larger limit: before, only the profile photo had it, so plan and listing photos over ~37 KB failed.
  app.use(['/api/me/photo', /^\/api\/activities\/\d+\/photo$/, /^\/api\/market\/\d+\/photos?$/], express.json({ limit: '900kb' }));
  app.use('/api', express.json({ limit: '50kb' }));
  // CSRF protection: state-changing API calls must be JSON (cross-site forms cannot send that without CORS preflight).
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'json', 'Requests must be JSON.'));
    }
    next();
  });
  // Profiles and plans are for people using the app, never for search engines.
  app.use('/api', (_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  app.use('/api', createApi(db));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Not found.')));

  // Share links for Instagram and WhatsApp: a preview card (title, day, public area only), then the plan opens in the app.
  app.get('/p/:id', (req, res) => {
    const id = Number(req.params.id);
    const a = Number.isInteger(id) ? db.prepare(`SELECT a.id, a.title, a.starts_at, a.time_mode, a.time_window, a.day_mode, a.meeting_area, a.status, a.is_sample, c.timezone
      FROM activities a JOIN cities c ON c.id = a.city_id WHERE a.id = ?`).get(id) : null;
    const esc = (x) => String(x).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const base = `${req.protocol}://${req.get('host')}`;
    // Shared plan links count as 'share' in the team numbers unless the link already carries its own tag.
    const tag = String(req.query.src || 'share').toLowerCase();
    const src = /^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag) ? tag : 'share';
    const target = `/?src=${src}${a ? `#/activity/${a.id}` : '#/explore'}`;
    let title = `${config.appName} · Las Palmas`;
    let desc = 'Find someone to go with in Las Palmas de Gran Canaria.';
    if (a && a.status === 'active' && !a.is_sample) {
      const d = new Date(a.starts_at);
      const day = new Intl.DateTimeFormat('en-GB', { timeZone: a.timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
      // A plan whose day isn't fixed has no real date: its stored start is only the listing window (see shared/plan-time.js).
      const span = { weekend: 'This weekend', week: 'This week', flex: 'Day to be agreed' }[a.day_mode];
      const when = span ? (a.time_mode === 'window' ? `${span}, ${a.time_window}` : a.day_mode === 'flex' ? 'Day and time to be agreed' : `${span}, time to be agreed`)
        : a.time_mode === 'window' ? `${day}, ${a.time_window}` : a.time_mode === 'tbd' ? `${day}, time to be agreed`
        : `${day}, ${new Intl.DateTimeFormat('en-GB', { timeZone: a.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)}`;
      title = a.title;
      desc = `${when} · ${a.meeting_area} · Join on ${config.appName}`;
    }
    res.set('Cache-Control', 'no-cache');
    // This tiny preview page forwards with one inline line (and a meta refresh as backup).
    res.set('Content-Security-Policy', CSP.replace("script-src 'self'", "script-src 'unsafe-inline'"));
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(config.appName)}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${base}/brand/og-image.png"><meta property="og:url" content="${base}/p/${a ? a.id : ''}">
<meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=${target}">
<link rel="icon" href="/favicon.ico"></head><body><p><a href="${target}">${esc(title)}</a></p><script>location.replace(${JSON.stringify(target)})</script></body></html>`);
  });

  // How to report a security problem (RFC 9116). SECURITY_CONTACT can be set on the host, e.g. mailto:team@example.org.
  app.get('/.well-known/security.txt', (req, res) => {
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const contact = /^(mailto:|https:\/\/)\S+$/.test(process.env.SECURITY_CONTACT || '') ? process.env.SECURITY_CONTACT : `${base}/#/help`;
    const expires = new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10);
    res.type('text/plain').send(`Contact: ${contact}\nExpires: ${expires}T00:00:00.000Z\nPreferred-Languages: en, es, de\nCanonical: ${base}/.well-known/security.txt\n`);
  });

  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // Only app screens fall back to the app. Anything that looks like a file (/.env, *.map, /server/db.js)
    // and is not part of the build gets a plain 404, so nobody can mistake the app page for a real file.
    app.get('*', (req, res) => {
      const last = req.path.split('/').pop();
      if (req.path.includes('/.') || last.includes('.') || /^\/(server|data|src|test|scripts|node_modules)(\/|$)/.test(req.path)) {
        return res.status(404).type('text/plain').send('Not found');
      }
      res.sendFile(path.join(dist, 'index.html'));
    });
  }
  app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.status === 429) res.set('Retry-After', String(err.retryAfter || 60));
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'That picture is too large. Please choose a smaller one.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid', message: 'Invalid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'server', message: 'Something went wrong on our side. Please try again.' });
  });
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const db = openDb();
  seed(db);
  createApp(db).listen(config.port, () => console.log(`${config.appName} running on http://localhost:${config.port}`));
}
