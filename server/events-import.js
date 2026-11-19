// Real events in Las Palmas de Gran Canaria, copied by hand from each organiser's or venue's own page.
// Every listing keeps its source and the date it was last checked. Unknown prices stay unknown ("Check with organiser").
//
// The import is idempotent: each event has a stable ext_id. Re-running updates the event's own fields only and never
// touches student data (people looking for company, groups, chats, tickets offered in the marketplace).
// Run it with `npm run import:events`; the server also runs it at start-up.
import { localToUtcIso } from './time.js';

const CHECKED = '2026-11-19';
const TZ = 'Atlantic/Canary';

// ---------- Erasmus Life at Alboroto (promoter: Erasmus Life; venue: Alboroto; platform: Nyxell) ----------
// Each date has its own page; the dates below are the ones published on 19 Nov 2026 up to 15 Jan 2027. No dates are generated.
const NYX = 'https://open.nyxell.com/en/rrpp/122923-erasmus-life';
const ALBOROTO_DATES = [
  [30287, 'jueves-19--noviembre', 'Jueves 19 • Noviembre', '2026-11-19'],
  [30288, 'jueves-26--noviembre', 'Jueves 26 • Noviembre', '2026-11-26'],
  [30297, 'jueves-3--diciembre', 'Jueves 3 • Diciembre', '2026-12-03'],
  [30298, 'jueves-10--diciembre', 'Jueves 10 • Diciembre', '2026-12-10'],
  [30299, 'jueves-17--diciembre', 'Jueves 17 • Diciembre', '2026-12-17'],
  [30308, 'jueves-7--enero', 'Jueves 7 • Enero', '2027-01-07'],
  [30309, 'jueves-14--enero', 'Jueves 14 • Enero', '2027-01-14'],
];
const alboroto = ALBOROTO_DATES.map(([id, slug, original, day]) => ({
  ext_id: `nyxell-${id}`,
  title: `Erasmus Life · ${original}`,
  description: 'Thursday night at Alboroto in Triana, promoted by Erasmus Life Las Palmas. From 23:00 until 05:00 the next morning. Over-21s only, dress code “arreglado” (smart).',
  desc_es: 'Noche de los jueves en Alboroto, en Triana, promocionada por Erasmus Life Las Palmas. De 23:00 a 05:00 de la mañana siguiente. Solo mayores de 21, vestimenta «arreglado».',
  category: 'nightout', local: `${day}T23:00`, duration: 360,
  venue: 'Alboroto', venue_address: 'C. Remedios, 10, 35002 Las Palmas de Gran Canaria', lat: 28.1017, lng: -15.4147,
  // Erasmus Life Las Palmas promotes these nights and runs the guest list; the page does not name an organiser.
  organiser_name: '', listed_by: 'Erasmus Life Las Palmas', official_url: null,
  ticket_platform: 'Nyxell', ticket_url: `${NYX}/event/${id}-${slug}`,
  price_en: 'Paid at the door: €12 with 1 drink, €16 with 2 drinks. No advance ticket sales. Signing up on the Nyxell list costs €0 but is not free entry, and must be validated by 01:00.',
  price_es: 'Se paga en la puerta: 12 € con 1 consumición, 16 € con 2. No hay venta anticipada. Apuntarse en la lista de Nyxell cuesta 0 € pero no es entrada gratis, y hay que validarla antes de la 01:00.',
  price_short: '€12–16 at the door',
  age_note: '21+',
  source_name: 'Erasmus Life page on Nyxell', source_url: `${NYX}/event/${id}-${slug}`,
  series_key: 'erasmus-life-alboroto', series_label: 'Erasmus Life at Alboroto', photo_key: 'vegueta',
}));

// ---------- Auditorio Alfredo Kraus (venue; tickets on janto) ----------
const AAK = 'https://auditorioalfredokraus.es/evento';
const JANTO = 'https://auditorioalfredokraus.janto.es/janto/main.php?Nivel=Evento&idEvento=';
const auditorio = { venue: 'Auditorio Alfredo Kraus, Sala Sinfónica', venue_address: 'Av. Príncipe de Asturias, s/n, 35010 Las Palmas de Gran Canaria', lat: 28.1306, lng: -15.4466, ticket_platform: 'janto (Auditorio Alfredo Kraus box office)', photo_key: 'auditorio' };

const gospel = {
  ...auditorio, ext_id: 'aak-TNOGC1226',
  title: 'The New Orleans Gospel Choir: Streets of New Orleans',
  description: 'Gospel concert by The New Orleans Gospel Choir, part of the 21st Gospel Canarias Fest. About 90 minutes.',
  desc_es: 'Concierto de gospel de The New Orleans Gospel Choir, dentro de la 21ª edición del Gospel Canarias Fest. Unos 90 minutos.',
  category: 'culture', local: '2026-12-12T20:00', duration: 90,
  organiser_name: '', listed_by: 'Auditorio Alfredo Kraus',
  official_url: `${AAK}/the-new-orleans-gospel-choir-streets-of-new-orleans`, ticket_url: `${JANTO}TNOGC1226`,
  source_name: 'Auditorio Alfredo Kraus event page', source_url: `${AAK}/the-new-orleans-gospel-choir-streets-of-new-orleans`,
};

// Five separate sessions of one concert (26–28 December). Not a New Year's Eve event.
const conpop = [['2026-12-26T18:00'], ['2026-12-26T21:00'], ['2026-12-27T18:00'], ['2026-12-27T21:00'], ['2026-12-28T20:00']].map(([local]) => ({
  ...auditorio, ext_id: `aak-CONPOP1226-${local.replace(/[-:T]/g, '')}`,
  title: 'XV Concierto Popular de Año Nuevo',
  description: 'The Orquesta Sinfónica de Las Palmas, conducted by Rafael Sánchez-Araña, performs the popular New Year concert. Five sessions between 26 and 28 December; about 90 minutes.',
  desc_es: 'La Orquesta Sinfónica de Las Palmas, dirigida por Rafael Sánchez-Araña, ofrece su concierto popular de Año Nuevo. Cinco sesiones entre el 26 y el 28 de diciembre; unos 90 minutos.',
  category: 'culture', local, duration: 90,
  organiser_name: '', listed_by: 'Auditorio Alfredo Kraus',
  official_url: `${AAK}/xv-concierto-popular-de-ano-nuevo`, ticket_url: `${JANTO}CONPOP1226`,
  note_en: 'Held on 26, 27 and 28 December, not on New Year’s Eve. Choose your session.',
  note_es: 'Se celebra el 26, 27 y 28 de diciembre, no en Nochevieja. Elige tu sesión.',
  source_name: 'Auditorio Alfredo Kraus event page', source_url: `${AAK}/xv-concierto-popular-de-ano-nuevo`,
  series_key: 'conpop-2026', series_label: 'XV Concierto Popular de Año Nuevo',
}));

const cristina = {
  ...auditorio, ext_id: 'aak-CRyLT0127-20270115',
  title: 'Cristina Ramos y Los Tenampas',
  description: 'Cristina Ramos with Los Tenampas in concert. About 2 hours. There is a second date on 16 January at 20:30 on the venue’s page.',
  desc_es: 'Cristina Ramos con Los Tenampas en concierto. Unas 2 horas. En la página del auditorio hay una segunda fecha el 16 de enero a las 20:30.',
  category: 'culture', local: '2027-01-15T20:00', duration: 120,
  organiser_name: '', listed_by: 'Auditorio Alfredo Kraus',
  official_url: `${AAK}/cristina-ramos-y-los-tenampas`, ticket_url: `${JANTO}CRyLT0127`,
  source_name: 'Auditorio Alfredo Kraus event page', source_url: `${AAK}/cristina-ramos-y-los-tenampas`,
};

// ---------- City of Las Palmas de Gran Canaria ----------
// The end date differs between sources (6 Jan in the press release, 5 Jan in the vendor rules), so only the opening is shown.
const mercado = {
  ext_id: 'lpgc-mercado-navidad-2026',
  title: 'Mercado de Navidad',
  description: 'The city’s Christmas market behind Parque Santa Catalina, with stalls in Plaza de Canarias and a fairground at El Refugio. Opens on 4 December.',
  desc_es: 'El mercado navideño de la ciudad en la trasera del parque Santa Catalina, con puestos en la plaza de Canarias y feria en El Refugio. Abre el 4 de diciembre.',
  category: 'shopping', local: '2026-12-04T00:00', duration: 24 * 60, time_known: 0, listed_until: '2027-01-05T23:59',
  venue: 'Parque Santa Catalina (rear), Plaza de Canarias and El Refugio', venue_address: 'Santa Catalina, 35007 Las Palmas de Gran Canaria', lat: 28.1405, lng: -15.4305,
  organiser_name: 'Ayuntamiento de Las Palmas de Gran Canaria', listed_by: null,
  official_url: 'https://www.laspalmasgc.es/es/la-ciudad/agenda/', ticket_platform: null, ticket_url: null,
  price_en: null, price_es: null,
  note_en: 'Opens 4 December. Check the city programme for opening hours and final date.',
  note_es: 'Abre el 4 de diciembre. Consulta el programa municipal para horarios y fecha de cierre.',
  source_name: 'City of Las Palmas de GC press release, 15 Oct 2026',
  source_url: 'https://www.laspalmasgc.es/es/ayuntamiento/prensa-y-comunicacion/notas-de-prensa/nota-de-prensa/Abierta-la-inscripcion-para-optar-a-un-punto-de-venta-de-bebida-o-de-comida-en-el-mercado-navideno/',
  photo_key: 'santacatalina', visit: true,
};

const molina = {
  ext_id: 'lpacultura-12-noches-andres-molina-20261209',
  title: '12 noches de autor: Andrés Molina',
  description: 'An evening with the author Andrés Molina, part of the “12 noches de autor” series. In Spanish.',
  desc_es: 'Una tarde con el autor Andrés Molina, dentro del ciclo «12 noches de autor».',
  category: 'culture', local: '2026-12-09T19:00', duration: 90,
  venue: 'Palacete Rodríguez Quegles', venue_address: 'Triana, Las Palmas de Gran Canaria', lat: 28.1063, lng: -15.4172,
  organiser_name: '', listed_by: 'LPA Cultura',
  official_url: 'https://www.lpacultura.com/events', ticket_platform: null, ticket_url: null,
  price_short: 'Free entry',
  price_en: 'Free entry (listed as “Gratuito” by LPA Cultura).', price_es: 'Entrada gratuita (según LPA Cultura).',
  source_name: 'LPA Cultura events agenda', source_url: 'https://www.lpacultura.com/events', photo_key: 'colon',
};

export const REAL_EVENTS = [...alboroto, mercado, molina, gospel, ...conpop, cristina];

const FIELDS = ['title', 'description', 'desc_es', 'category', 'starts_at', 'duration_min', 'venue', 'venue_address', 'organiser_name', 'official_url',
  'ticket_platform', 'ticket_url', 'price_note', 'price_es', 'price_short', 'listed_by', 'age_note', 'note_en', 'note_es', 'source_name', 'source_url', 'checked_at',
  'series_key', 'series_label', 'time_known', 'listed_until', 'photo_key', 'lat', 'lng'];

/** Insert or update the real events by ext_id. Returns { inserted, updated }. Never touches interests, groups, chats or listings. */
export function importEvents(db, events = REAL_EVENTS) {
  const city = db.prepare("SELECT id FROM cities WHERE slug = 'las-palmas'").get();
  if (!city) return { inserted: 0, updated: 0 };
  const sel = db.prepare('SELECT id FROM events WHERE ext_id = ?');
  const ins = db.prepare(`INSERT INTO events (city_id, ext_id, is_sample, status, ${FIELDS.join(', ')}) VALUES (?, ?, 0, 'active', ${FIELDS.map(() => '?').join(', ')})`);
  const upd = db.prepare(`UPDATE events SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, is_sample = 0 WHERE ext_id = ?`);
  let inserted = 0; let updated = 0;
  db.exec('BEGIN');
  try {
    for (const e of events) {
      const row = {
        ...e, starts_at: localToUtcIso(e.local, TZ), duration_min: e.duration, price_note: e.price_en ?? null, checked_at: CHECKED,
        time_known: e.time_known ?? 1, listed_until: e.listed_until ? localToUtcIso(e.listed_until, TZ) : null,
      };
      const vals = FIELDS.map((f) => (f === 'organiser_name' ? row[f] ?? '' : row[f] ?? null));
      if (sel.get(e.ext_id)) { upd.run(...vals, e.ext_id); updated++; } else { ins.run(city.id, e.ext_id, ...vals); inserted++; }
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return { inserted, updated };
}

export const VISIT_EVENT_IDS = REAL_EVENTS.filter((e) => e.visit).map((e) => e.ext_id);
