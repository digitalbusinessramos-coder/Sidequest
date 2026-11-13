// Seeds the city, the city guide and (in demo mode) clearly labelled FICTIONAL sample profiles, activities and events.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localToUtcIso, utcToLocalInput, slotOf } from './time.js';
import { config } from './config.js';
import { tx } from './db.js';
import { createAvatar } from '@dicebear/core';
import { notionists } from '@dicebear/collection';

const TZ = 'Atlantic/Canary';
const GUIDE_CHECKED = '2026-11-06';

// Approximate neighbourhood centres. Used only to suggest the nearest area name on the user's own device.
const AREAS = [
  { key: 'canteras', name: 'Las Canteras / Guanarteme', lat: 28.135, lng: -15.438 },
  { key: 'santacatalina', name: 'Santa Catalina / Puerto', lat: 28.140, lng: -15.427 },
  { key: 'alcaravaneras', name: 'Alcaravaneras / Ciudad Jardín', lat: 28.123, lng: -15.424 },
  { key: 'triana', name: 'Triana / Vegueta', lat: 28.103, lng: -15.416 },
  { key: 'schamann', name: 'Schamann / Escaleritas', lat: 28.115, lng: -15.440 },
  { key: 'tafira', name: 'Tafira (ULPGC campus)', lat: 28.075, lng: -15.453 },
  { key: 'sietepalmas', name: 'Siete Palmas / Tamaraceite', lat: 28.110, lng: -15.465 },
  { key: 'isleta', name: 'La Isleta / El Confital', lat: 28.160, lng: -15.425 },
];

const GUIDE = [
  // transport
  ['transport', 'official', 'City buses (Guaguas Municipales)', 'The city bus company’s own site: lines and timetables, fares and travel cards, service alerts, a route planner and card top-up.', 'https://www.guaguas.com/', 'Guaguas Municipales'],
  ['transport', 'official', 'Getting to and from the airport by bus', 'Aena’s page for Gran Canaria Airport lists the bus lines that serve the airport, with schedules and fares.', 'https://www.aena.es/en/gran-canaria/getting-there/bus.html', 'Aena'],
  ['transport', 'placeholder', 'Island-wide buses (Global)', 'Buses between towns are run by the interurban operator Global. We could not open its website when checking this guide, so add the official link after verifying it.', null, null],
  // health
  ['health', 'official', 'Emergencies: 112', 'Your Europe (EU portal): 112 is the European emergency number, free to call from fixed and mobile phones across the EU.', 'https://europa.eu/youreurope/citizens/travel/security-and-emergencies/emergency/index_en.htm', 'Your Europe (European Union)'],
  ['health', 'official', 'European Health Insurance Card (EHIC)', 'European Commission: the EHIC gives access to medically necessary state healthcare during a temporary stay. It is not a replacement for travel insurance.', 'https://employment-social-affairs.ec.europa.eu/policies-and-activities/moving-working-europe/eu-social-security-coordination/european-health-insurance-card_en', 'European Commission'],
  ['health', 'official', 'Canary Islands Health Service', 'The Servicio Canario de la Salud homepage, with information for citizens and listings of hospitals and health areas.', 'https://www3.gobiernodecanarias.org/sanidad/scs/', 'Servicio Canario de la Salud'],
  ['health', 'official', 'Insurance rules for ULPGC exchange students', 'ULPGC’s exchange-student page asks incoming students for private medical insurance and says this is not the EHIC. Check the page for the exact requirement.', 'https://internacional.ulpgc.es/en/movilidad-incoming/estudiantes-incoming/study-at-the-ulpgc-incoming/exchange-students', 'ULPGC International Office'],
  // housing
  ['housing', 'official', 'ULPGC scholarships and accommodation', 'The university’s “Becas y alojamiento” section, linked from its homepage. We could not load its contents when checking, so open it to see the current options.', 'https://www10.ulpgc.es/becas_y_alojamiento', 'ULPGC'],
  ['housing', 'community', 'Before you pay for a room', 'General advice from the project team (not legal advice): see the room in person or by live video before paying, ask for a written contract, and get a receipt for any deposit.', null, 'SIDEQUEST project team'],
  // university & students
  ['university', 'official', 'ULPGC exchange students', 'Practical guide for incoming exchange students: Welcome Day, the university Buddy Program, Spanish courses and paperwork.', 'https://internacional.ulpgc.es/en/movilidad-incoming/estudiantes-incoming/study-at-the-ulpgc-incoming/exchange-students', 'ULPGC International Office'],
  ['university', 'official', 'ESN Las Palmas', 'The local Erasmus Student Network section’s own site: ESNcard, discounts, events and its Buddy Program. Not affiliated with this app.', 'https://esnlaspalmas.org/', 'ESN Las Palmas'],
  ['students', 'placeholder', 'Student recommendations', 'Tips from students (favourite cafés, study spots, beginner-friendly hikes) will appear here. None have been collected yet.', null, null],
  // links
  ['links', 'official', 'Official city tourism site', 'LPA Visit: things to do, routes, getting around and the city’s events agenda.', 'https://lpavisit.com/en/', 'LPA Visit (City of Las Palmas de Gran Canaria)'],
];

const PERSONAS = [
  { key: 'lena', first_name: 'Lena', intro: 'Sample profile. Fictional exchange student from Germany, likes museums and slow hikes.', area: 'triana', languages: ['German', 'English', 'Spanish'], interests: ['museum', 'hiking', 'coffee'], hue: 210, university: 'ULPGC' },
  { key: 'matteo', first_name: 'Matteo', intro: 'Sample profile. Fictional Italian student who wants to learn to surf and play beach volleyball.', area: 'canteras', languages: ['Italian', 'English'], interests: ['surf', 'sports', 'beach'], hue: 20 },
  { key: 'aicha', first_name: 'Aïcha', intro: 'Sample profile. Fictional French student, into concerts, coffee and language exchange.', area: 'tafira', languages: ['French', 'English', 'Spanish'], interests: ['culture', 'coffee', 'study'], hue: 300, university: 'ULPGC' },
  { key: 'tomasz', first_name: 'Tomasz', intro: 'Sample profile. Fictional Polish student, happy to plan beginner hikes and day trips.', area: 'schamann', languages: ['Polish', 'English'], interests: ['hiking', 'daytrip', 'sports'], hue: 140 },
  { key: 'ines', first_name: 'Inés', intro: 'Sample profile. Fictional local student who likes showing visitors around.', area: 'isleta', languages: ['Spanish', 'English'], interests: ['culture', 'beach', 'study'], hue: 80, role: 'local' },
  { key: 'jonas', first_name: 'Jonas', intro: 'Sample profile. Fictional Dutch student, up for nights out, quiz nights and surf.', area: 'santacatalina', languages: ['Dutch', 'English', 'German'], interests: ['nightout', 'games', 'surf'], hue: 30 },
  { key: 'klara', first_name: 'Klára', intro: 'Sample profile. Fictional Czech student who likes yoga, photo walks and markets.', area: 'canteras', languages: ['Czech', 'English'], interests: ['wellness', 'photo', 'shopping'], hue: 330, university: 'ULPGC' },
  { key: 'andrei', first_name: 'Andrei', intro: 'Sample profile. Fictional Romanian student, likes study sessions, board games and football.', area: 'tafira', languages: ['Romanian', 'English', 'Spanish'], interests: ['study', 'games', 'sports'], hue: 190 },
  { key: 'elif', first_name: 'Elif', intro: 'Sample profile. Fictional Turkish student, into tapas evenings, concerts and nights out.', area: 'triana', languages: ['Turkish', 'English'], interests: ['food', 'culture', 'nightout'], hue: 350 },
  { key: 'nikos', first_name: 'Nikos', intro: 'Sample profile. Fictional Greek student who wants to hike and see the whole island.', area: 'alcaravaneras', languages: ['Greek', 'English'], interests: ['hiking', 'daytrip', 'photo'], hue: 160 },
  { key: 'carmen', first_name: 'Carmen', intro: 'Sample profile. Fictional local student, happy to do language exchange and show the best tapas spots.', area: 'santacatalina', languages: ['Spanish', 'English'], interests: ['food', 'study', 'nightout'], hue: 45, role: 'local' },
  { key: 'emma', first_name: 'Emma', intro: 'Sample profile. Fictional Swedish student, loves the beach, yoga and sunsets.', area: 'isleta', languages: ['Swedish', 'English'], interests: ['beach', 'wellness', 'surf'], hue: 230 },
  { key: 'sofia', first_name: 'Sofia', intro: 'Sample profile. Fictional Portuguese student, loves day trips and museums.', area: 'alcaravaneras', languages: ['Portuguese', 'Spanish', 'English'], interests: ['museum', 'daytrip', 'beach'], hue: 260 },
];

function hslHex(h) {
  // Light pastel background for drawn avatars, from the persona's hue.
  const s = 0.6, l = 0.85, k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return `${f(0)}${f(8)}${f(4)}`;
}

function localDay(offset) {
  return utcToLocalInput(new Date(Date.now() + offset * 864e5).toISOString(), TZ).slice(0, 10);
}
function at(offset, hhmm) { return localToUtcIso(`${localDay(offset)}T${hhmm}`, TZ); }
function nextDow(dow, minOffset = 1) { // dow: 'sat'
  for (let i = minOffset; i < minOffset + 7; i++) if (slotOf(at(i, '12:00'), TZ).startsWith(dow)) return i;
  return minOffset;
}

export function seed(db, { force = false } = {}) {
  let city = db.prepare("SELECT * FROM cities WHERE slug = 'las-palmas'").get();
  if (!city) {
    db.prepare('INSERT INTO cities (slug, name, country, timezone, areas) VALUES (?,?,?,?,?)')
      .run('las-palmas', 'Las Palmas de Gran Canaria', 'Spain', TZ, JSON.stringify(AREAS));
    city = db.prepare("SELECT * FROM cities WHERE slug = 'las-palmas'").get();
  }
  if (!db.prepare('SELECT 1 FROM guide_items WHERE city_id = ?').get(city.id) || force) {
    db.prepare('DELETE FROM guide_items WHERE city_id = ?').run(city.id);
    const ins = db.prepare('INSERT INTO guide_items (city_id, section, kind, title, summary, url, source_name, checked_at, sort) VALUES (?,?,?,?,?,?,?,?,?)');
    GUIDE.forEach((g, i) => ins.run(city.id, ...g, g[4] ? GUIDE_CHECKED : null, i));
  }
  if (!config.demoMode) return;

  const ids = {};
  for (const p of PERSONAS) {
    const email = `${p.key}@sample.invalid`;
    let u = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!u) {
      const { lastInsertRowid } = db.prepare('INSERT INTO users (email, password_hash, is_demo) VALUES (?, ?, 1)').run(email, `nologin$${crypto.randomBytes(8).toString('hex')}`);
      db.prepare(`INSERT INTO profiles (user_id, first_name, intro, city_id, area, university, show_university, role, languages, interests, onboarded, avatar_hue, exchange_start, exchange_end)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(lastInsertRowid, p.first_name, p.intro, city.id, p.area, p.university || null, p.university ? 1 : 0,
        p.role || 'exchange', JSON.stringify(p.languages), JSON.stringify(p.interests), p.hue, p.role === 'local' ? null : '2026-09', p.role === 'local' ? null : '2027-02');
      u = { id: Number(lastInsertRowid) };
    }
    ids[p.key] = u.id;
    // Drawn avatars (DiceBear "Notionists", CC0) so sample people never use photos of real people.
    if (!db.prepare('SELECT 1 FROM photos WHERE user_id = ?').get(u.id)) {
      const svg = createAvatar(notionists, { seed: `sq-${p.key}`, backgroundColor: [hslHex(p.hue)] }).toString();
      db.prepare('INSERT INTO photos (user_id, mime, data) VALUES (?, ?, ?)').run(u.id, 'image/svg+xml', Buffer.from(svg));
      db.prepare('UPDATE profiles SET photo_v = 1 WHERE user_id = ?').run(u.id);
    }
  }

  // Sample recommendations: written by fictional personas, labelled Sample, about well-known public places. No prices or opening hours.
  if (!db.prepare('SELECT 1 FROM recommendations WHERE is_sample = 1').get()) {
    const rec = (k, category, title, body, area, likers = []) => {
      const id = Number(db.prepare('INSERT INTO recommendations (city_id, user_id, category, title, body, area, is_sample) VALUES (?,?,?,?,?,?,1)')
        .run(city.id, ids[k], category, title, body, area).lastInsertRowid);
      for (const l of likers) db.prepare('INSERT OR IGNORE INTO rec_likes (rec_id, user_id) VALUES (?, ?)').run(id, ids[l]);
    };
    rec('ines', 'beach', 'Walk the Las Canteras promenade at sunset', 'Start at La Puntilla and walk south towards the Auditorio. Flat, free and you meet half the city on the way.', 'Las Canteras / Guanarteme', ['lena', 'matteo', 'emma', 'klara', 'jonas']);
    rec('carmen', 'food', 'Try the Vegueta market', 'Good for fruit and a quick snack on a Saturday morning. Go early, it gets busy.', 'Triana / Vegueta', ['elif', 'sofia', 'lena']);
    rec('lena', 'culture', 'Wander the old town of Vegueta', 'Cobbled streets, the cathedral square and small museums close together. Nice for a slow afternoon.', 'Triana / Vegueta', ['sofia', 'nikos', 'aicha', 'tomasz']);
    rec('andrei', 'study', 'Study on campus between classes', 'The campus library in Tafira is quiet in the mornings. Bring a jumper, the air con is strong.', 'Tafira (ULPGC campus)', ['aicha']);
    rec('emma', 'beach', 'Swim at El Confital on a calm day', 'Rocky and wild, at the end of La Isleta. Check the sea conditions first and bring water shoes.', 'La Isleta / El Confital', ['matteo', 'klara']);
    rec('jonas', 'nightlife', 'Start the evening around Santa Catalina', 'Lots of people meet around the park before heading out. Easy to find each other there.', 'Santa Catalina / Puerto', ['elif', 'carmen']);
    rec('tomasz', 'practical', 'Get a bus card early', 'Ask about student travel cards on the official Guaguas website (linked in the City Guide). It saves a lot over single tickets.', null, ['nikos', 'lena', 'andrei']);
    rec('nikos', 'beach', 'See the dunes once', 'A day trip south to the Maspalomas dunes is worth it. Go early before it gets hot.', null, ['emma', 'tomasz']);
  }

  const upcoming = db.prepare("SELECT COUNT(*) AS n FROM activities WHERE is_sample = 1 AND status = 'active' AND starts_at > ?").get(new Date().toISOString()).n;
  // v0.3 added open-join and new-category samples; refresh once on older databases.
  const current = !!db.prepare("SELECT 1 FROM activities WHERE is_sample = 1 AND join_mode = 'open'").get();
  if (!current) force = true;
  if (upcoming >= 4 && !force) return;

  tx(db, () => {
    // Refresh sample content so dates stay in the near future. Only sample rows owned by sample personas are touched.
    db.prepare('DELETE FROM activities WHERE is_sample = 1 AND organiser_id IN (SELECT id FROM users WHERE is_demo = 1) AND (starts_at < ? OR ?)').run(new Date().toISOString(), force ? 1 : 0);
    db.prepare('DELETE FROM events WHERE is_sample = 1 AND id NOT IN (SELECT event_id FROM activities WHERE event_id IS NOT NULL)').run();
    db.prepare('DELETE FROM wishes WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)').run();
    db.prepare('DELETE FROM event_interests WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)').run();
    db.prepare('DELETE FROM event_messages WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)').run();

    const act = (o) => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO activities (city_id, organiser_id, event_id, template, category, title, description, starts_at, duration_min, meeting_area, meeting_point,
        cost_eur, max_participants, beginner_friendly, pace, transport, languages, solo_format, welcome_plan, recognise_tip, is_sample, join_mode)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`).run(city.id, ids[o.by], o.event || null, o.template, o.category, o.title, o.description, o.starts, o.duration,
        o.area, o.point || '', o.cost || 0, o.max, o.beginner ? 1 : 0, o.pace || null, o.transport || null, JSON.stringify(o.languages || []), o.solo ? 1 : 0, o.welcome || '', o.recognise || '', o.open ? 'open' : 'request');
      const id = Number(lastInsertRowid);
      db.prepare("INSERT INTO messages (activity_id, kind, body) VALUES (?, 'system', ?)").run(id, `${PERSONAS.find((p) => p.key === o.by).first_name} created this activity. Confirmed participants can chat here.`);
      for (const k of o.accepted || []) {
        db.prepare("INSERT INTO memberships (activity_id, user_id, status) VALUES (?, ?, 'accepted')").run(id, ids[k]);
        db.prepare("INSERT INTO messages (activity_id, kind, body) VALUES (?, 'system', ?)").run(id, `${PERSONAS.find((p) => p.key === k).first_name} joined. Say hello!`);
      }
      for (const k of o.pending || []) db.prepare("INSERT INTO memberships (activity_id, user_id, status, message) VALUES (?, ?, 'pending', ?)").run(id, ids[k], 'Hi! Sounds fun, can I join?');
      for (const [k, body] of o.chat || []) db.prepare('INSERT INTO messages (activity_id, user_id, body) VALUES (?,?,?)').run(id, ids[k], body);
      return id;
    };

    const sat = nextDow('sat', 2);
    act({ by: 'ines', template: 'sunset', category: 'beach', title: 'Everyone comes solo: sunset at El Confital', description: 'Nobody needs to know anyone. Bring something to sit on. We adjust the time to the real sunset in the chat.',
      starts: at(1, '18:00'), duration: 75, area: 'La Isleta / El Confital', point: 'At the start of the El Confital footpath (exact spot pinned in the chat)', max: 8, beginner: true, solo: true,
      languages: ['English', 'Spanish'], welcome: 'Inés waits at the meeting point 10 minutes early and introduces everyone.', recognise: 'Look for the lime-green tote bag.', accepted: ['sofia'] });
    act({ by: 'aicha', template: 'coffee', category: 'coffee', title: 'Coffee between classes on campus', description: 'Quick coffee in the break. Happy to practise Spanish or French.',
      starts: at(1, '11:00'), duration: 45, area: 'Tafira (ULPGC campus)', point: 'Campus cafeteria entrance', cost: 2, max: 3, beginner: true, languages: ['French', 'English', 'Spanish'] });
    act({ by: 'lena', template: 'museum', category: 'museum', title: 'Museum afternoon in Vegueta', description: 'Relaxed visit to a museum in the old town, then a drink nearby. Cost is an estimate: check the museum’s own site for entry prices.',
      starts: at(2, '16:00'), duration: 150, area: 'Triana / Vegueta', point: 'Plaza de Santa Ana, by the cathedral steps', cost: 5, max: 4, beginner: true, languages: ['English', 'German', 'Spanish'], pending: ['tomasz'] });
    act({ by: 'matteo', template: 'volleyball', category: 'sports', title: 'Beach volleyball, all levels', description: 'Casual games, no experience needed. Teams are mixed every round.',
      starts: at(2, '17:30'), duration: 90, area: 'Las Canteras / Guanarteme', point: 'Volleyball nets near the beach promenade (spot confirmed in chat)', max: 8, beginner: true, solo: true,
      languages: ['English', 'Italian', 'Spanish'], welcome: 'Matteo brings the ball and starts with a round of names.', recognise: 'Blue and white volleyball.', accepted: ['tomasz', 'ines'],
      chat: [['matteo', 'Hi both! I will be there 10 minutes early.'], ['ines', 'Great, see you at the nets.']] });
    act({ by: 'matteo', template: 'surf', category: 'surf', title: 'First surf lesson for total beginners', description: 'Looking for 1 to 3 people to book a beginner lesson with a surf school together. Price is an estimate; we book only after agreeing in the chat.',
      starts: at(3, '10:00'), duration: 120, area: 'Las Canteras / Guanarteme', cost: 25, max: 4, beginner: true, pace: 'Beginner', languages: ['English', 'Italian'] });
    act({ by: 'lena', template: 'coffee', category: 'coffee', title: 'Coffee and Spanish practice', description: 'One buddy: we speak Spanish for an hour, slowly.',
      starts: at(3, '17:00'), duration: 60, area: 'Triana / Vegueta', cost: 3, max: 2, languages: ['Spanish', 'English'], accepted: ['aicha'] });
    act({ by: 'tomasz', template: 'hike', category: 'hiking', title: 'Beginner hike, easy pace', description: 'An easy half-day walk for beginners. We choose the exact route together in the chat based on weather and bus times.',
      starts: at(sat, '09:00'), duration: 240, area: 'Schamann / Escaleritas', cost: 0, max: 6, beginner: true, pace: 'Relaxed, lots of stops', transport: 'Interurban bus: check the official timetable together',
      languages: ['English'], accepted: ['lena'] });
    act({ by: 'sofia', template: 'daytrip', category: 'daytrip', title: 'Day trip to Teror', description: 'Exploring the historic town of Teror. Cost is an estimate for bus and a snack.',
      starts: at(sat + 1, '10:00'), duration: 360, area: 'Alcaravaneras / Ciudad Jardín', cost: 10, max: 5, beginner: true, transport: 'Interurban bus: check the official timetable', languages: ['Portuguese', 'Spanish', 'English'] });

    act({ by: 'jonas', template: 'nightout', category: 'nightout', title: 'Night out: meet first, then decide', description: 'We meet for a drink, then pick where to go together. Leave whenever you like. Open plan: join without waiting for approval.',
      starts: at(sat - 1 > 0 ? sat - 1 : sat, '22:00'), duration: 240, area: 'Santa Catalina / Puerto', point: 'Benches by the park fountain', cost: 15, max: 8, solo: true, open: true,
      languages: ['English', 'Spanish', 'Dutch'], welcome: 'Jonas waits at the meeting point until 22:20.', recognise: 'Orange cap.', accepted: ['elif', 'carmen'],
      chat: [['elif', 'I am in! Is it OK if I come a bit later?'], ['jonas', 'Sure, just message here and we will tell you where we are.']] });
    act({ by: 'emma', template: 'yoga', category: 'wellness', title: 'Morning yoga on the beach', description: 'Gentle beginner yoga on the sand. Bring a towel. Open plan: just join.',
      starts: at(2, '08:30'), duration: 60, area: 'Las Canteras / Guanarteme', point: 'Near La Puntilla, on the sand', max: 10, beginner: true, solo: true, open: true,
      languages: ['English', 'Swedish', 'Spanish'], accepted: ['klara'] });
    act({ by: 'carmen', template: 'tandem', category: 'study', title: 'Language exchange: Spanish and English', description: 'Half the time in Spanish, half in English. All levels welcome.',
      starts: at(1, '19:00'), duration: 90, area: 'Triana / Vegueta', cost: 3, max: 6, beginner: true, solo: true, languages: ['Spanish', 'English'], accepted: ['andrei'] });
    act({ by: 'andrei', template: 'quiz', category: 'games', title: 'Board games evening', description: 'Bring a game if you have one. Easy games first so nobody needs to know the rules.',
      starts: at(3, '19:30'), duration: 150, area: 'Alcaravaneras / Ciudad Jardín', cost: 5, max: 6, beginner: true, languages: ['English', 'Spanish'], pending: ['nikos'] });
    act({ by: 'klara', template: 'photowalk', category: 'photo', title: 'Photo walk through the old town', description: 'Any camera or phone is fine. Slow pace, lots of stops.',
      starts: at(4, '17:00'), duration: 120, area: 'Triana / Vegueta', point: 'Cathedral square', max: 6, beginner: true, open: true, languages: ['English', 'Czech'], accepted: ['nikos'] });
    act({ by: 'elif', template: 'tapas', category: 'food', title: 'Tapas evening in Triana', description: 'Sharing a few plates and getting to know each other. Cost is an estimate.',
      starts: at(sat, '20:30'), duration: 120, area: 'Triana / Vegueta', cost: 15, max: 6, beginner: true, languages: ['English', 'Turkish', 'Spanish'], accepted: ['carmen'], pending: ['lena'] });

    const ev = (o) => Number(db.prepare(`INSERT INTO events (city_id, title, description, category, starts_at, duration_min, venue, organiser_name, official_url, price_note, is_sample)
      VALUES (?,?,?,?,?,?,?,?,?,?,1)`).run(city.id, o.title, o.description, o.category, o.starts, o.duration, o.venue,
      'Sample organiser (illustrative only, not a real listing)', null, 'The real organiser would show price and registration on their own page.').lastInsertRowid);
    const e1 = ev({ title: 'Sample event: Welcome tapas night', description: 'Illustrative example of a student-association welcome evening. Not a real event.', category: 'coffee', starts: at(4, '21:00'), duration: 150, venue: 'Santa Catalina area' });
    const e2 = ev({ title: 'Sample event: Language exchange evening', description: 'Illustrative example of a language exchange. Not a real event.', category: 'study', starts: at(2, '19:30'), duration: 120, venue: 'Triana area' });
    const e4 = ev({ title: 'Sample event: Beach clean-up morning', description: 'Illustrative example of a volunteer beach clean-up. Not a real event.', category: 'beach', starts: at(sat + 1, '10:00'), duration: 120, venue: 'Las Canteras area' });
    const e3 = ev({ title: 'Sample event: Summit-area excursion', description: 'Illustrative example of an island excursion by coach. Not a real event.', category: 'hiking', starts: at(sat + 7, '08:00'), duration: 540, venue: 'Departure point in the city centre' });

    const interest = (e, k, pref, langs, opt) => db.prepare('INSERT OR IGNORE INTO event_interests (event_id, user_id, group_pref, languages, meeting_option, note) VALUES (?,?,?,?,?,?)')
      .run(e, ids[k], pref, JSON.stringify(langs), opt, 'Sample profile');
    interest(e1, 'lena', 'small', ['English', 'German'], 'Meet at the venue entrance');
    interest(e1, 'matteo', 'either', ['English', 'Italian'], 'Walk there together from Las Canteras');
    interest(e2, 'aicha', 'buddy', ['French', 'English'], 'Meet at the venue entrance');
    interest(e2, 'ines', 'small', ['Spanish', 'English'], 'Meet at the venue entrance');
    interest(e3, 'tomasz', 'small', ['English', 'Polish'], 'Meet at the departure point');
    interest(e3, 'nikos', 'small', ['Greek', 'English'], 'Meet at the departure point');
    interest(e1, 'jonas', 'small', ['Dutch', 'English'], 'Walk there together from Las Canteras');
    interest(e1, 'elif', 'either', ['Turkish', 'English'], 'Meet at the venue entrance');
    interest(e2, 'carmen', 'small', ['Spanish', 'English'], 'Meet at the venue entrance');
    interest(e4, 'emma', 'small', ['Swedish', 'English'], 'Meet at the venue entrance');
    interest(e4, 'klara', 'either', ['Czech', 'English'], 'Meet at the venue entrance');
    const evmsg = (e, k, body) => db.prepare('INSERT INTO event_messages (event_id, user_id, body) VALUES (?,?,?)').run(e, ids[k], body);
    evmsg(e1, 'lena', 'Hi everyone! Anyone want to meet 15 minutes before?');
    evmsg(e1, 'jonas', 'Yes, I can be there early too.');
    evmsg(e4, 'emma', 'I will bring extra gloves if anyone needs them.');

    const wish = (k, category, slots, note, budget = 'any') => db.prepare('INSERT INTO wishes (user_id, city_id, category, note, slots, budget) VALUES (?,?,?,?,?,?)')
      .run(ids[k], city.id, category, note, JSON.stringify(slots), budget);
    wish('lena', 'museum', ['thu_afternoon', 'sat_morning'], 'Any museum in the old town');
    wish('sofia', 'museum', ['thu_afternoon', 'sun_afternoon'], 'Art or history');
    wish('tomasz', 'hiking', ['sat_morning', 'sun_morning'], 'Beginner routes only', 'free');
    wish('matteo', 'surf', [], 'Total beginner');
    wish('ines', 'culture', ['fri_evening', 'sat_evening'], 'Live music');
    wish('aicha', 'culture', ['fri_evening'], 'Concerts');
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { openDb } = await import('./db.js');
  seed(openDb(), { force: process.argv.includes('--force') });
  console.log('Seed complete.');
}
