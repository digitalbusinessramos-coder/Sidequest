import fs from 'node:fs';
import { CATEGORIES, TEMPLATES, LANGUAGES, BUDGETS, REPORT_REASONS, DAYS, PARTS } from '../shared/catalog.js';
const keys = new Set();
const files = ['src/components.jsx', 'src/App.jsx', 'src/util.js', ...fs.readdirSync('src/screens').map((f) => 'src/screens/' + f)];
const re = /\btx\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
for (const f of files) { const s = fs.readFileSync(f, 'utf8'); let m; while ((m = re.exec(s))) keys.add((m[1] ?? m[2]).replace(/\\(.)/g, '$1')); }
// ternary second options inside tx( a ? 'x' : 'y' )
for (const f of files) { const s = fs.readFileSync(f, 'utf8'); for (const m of s.matchAll(/tx\([^)]*?\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) { keys.add(m[1]); keys.add(m[2]); } }
// arrays of English data shown via tx(x)
for (const f of ['src/screens/Chat.jsx', 'src/screens/EventDetail.jsx', 'src/screens/Plans.jsx']) { const s = fs.readFileSync(f, 'utf8'); for (const m of s.matchAll(/(?:\[|, )"([A-Z][^"]+)"/g)) keys.add(m[1]); for (const m of s.matchAll(/^\s+\w+: \['([^']+)'/gm)) keys.add(m[1]); }
for (const c of CATEGORIES) { keys.add(c.label); keys.add(c.phrase); }
for (const t of TEMPLATES) keys.add(t.label);
LANGUAGES.forEach((l) => keys.add(l)); BUDGETS.forEach((b) => keys.add(b.label)); REPORT_REASONS.forEach((r) => keys.add(r));
DAYS.forEach(([, d]) => keys.add(d)); PARTS.forEach(([p]) => keys.add(p));
// server messages without interpolation
const api = fs.readFileSync('server/api.js', 'utf8');
for (const m of api.matchAll(/fail\(\d+, '\w+', '([^']+)'\)/g)) keys.add(m[1].replace(/\\'/g, "'"));
for (const m of api.matchAll(/fail\(\d+, '\w+', `([^`$]+)`\)/g)) keys.add(m[1]);
// guide
const seed = fs.readFileSync('server/seed.js', 'utf8');
const g = seed.slice(seed.indexOf('const GUIDE'), seed.indexOf('const PERSONAS'));
for (const m of g.matchAll(/\['\w+', '\w+', '([^']+)', '([^']+)'/g)) { keys.add(m[1]); keys.add(m[2]); }
keys.delete('');
const { es } = await import('../src/i18n.es.js');
const missing = [...keys].filter((k) => !(k in es));
if (missing.length) { console.log('Missing Spanish translations:'); missing.forEach((k) => console.log('  ' + JSON.stringify(k))); process.exitCode = 1; }
console.log(`${keys.size} sentences checked`);
