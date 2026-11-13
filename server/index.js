import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi, HttpError } from './api.js';
import { seed } from './seed.js';
import { config } from './config.js';

export function createApp(db) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use('/api/me/photo', express.json({ limit: '900kb' })); // resized pictures only
  app.use('/api', express.json({ limit: '50kb' }));
  // CSRF protection: state-changing API calls must be JSON (cross-site forms cannot send that without CORS preflight).
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'json', 'Requests must be JSON.'));
    }
    next();
  });
  app.use('/api', createApi(db));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Not found.')));

  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
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
