// Re-import the real events (stable ids, safe to run any number of times): `npm run import:events`.
import { openDb } from '../server/db.js';
import { importEvents } from '../server/events-import.js';

const db = openDb();
const r = importEvents(db);
const n = db.prepare('SELECT COUNT(*) AS n FROM events WHERE ext_id IS NOT NULL').get().n;
console.log(`Events: ${r.inserted} new, ${r.updated} updated, ${n} real events in the database.`);
