// Pop-up notifications on the phone or computer (Web Push), sent when something happens in a student's plans.
// Nobody needs to set anything up: the server makes its own key pair once and keeps it in the database.
// VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY can be set on the host to use fixed keys instead.
import webpush from 'web-push';

const TEXT = {
  en: {
    request_received: ['{name} wants to join', '“{plan}”. Open it to accept or decline.'],
    joined: ['{name} joined your plan', '“{plan}”'],
    request_accepted: ['You’re in!', '{name} accepted you for “{plan}”. The chat and meeting point are open now.'],
    request_declined: ['Request not accepted', '“{plan}” is full or the host chose other people this time.'],
    removed: ['You were removed from a plan', '“{plan}”'],
    invited: ['{name} invited you', 'Join “{plan}”?'],
    invite_accepted: ['{name} accepted your invitation', '“{plan}”'],
    left: ['{name} left your plan', '“{plan}”'],
    cancelled: ['Plan cancelled', '“{plan}” is not happening.'],
    changed: ['Plan updated', 'Time or place changed for “{plan}”.'],
    chat: ['New message in “{plan}”', '{name} wrote in the plan chat.'],
    market_message: ['New message about “{plan}”', '{name} sent you a message in the Marketplace.'],
    test: ['Notifications are on', 'This is how updates about your plans will look.'],
    reminder: ['Starting soon: {plan}', 'Today at {time} · {area}. Have fun!'],
    connect_request: ['{name} wants to connect', 'Open their profile to accept or decline.'],
    connect_accepted: ['{name} accepted your request', 'You can now message each other.'],
    dm: ['New message from {name}', 'Open the chat to read it.'],
    answer: ['{name} answered your question', '“{plan}”'],
  },
  es: {
    request_received: ['{name} quiere unirse', '«{plan}». Ábrelo para aceptar o rechazar.'],
    joined: ['{name} se ha unido a tu plan', '«{plan}»'],
    request_accepted: ['¡Estás dentro!', '{name} te ha aceptado en «{plan}». Ya puedes ver el chat y el punto de encuentro.'],
    request_declined: ['Solicitud no aceptada', '«{plan}» está completo o esta vez el anfitrión ha elegido a otras personas.'],
    removed: ['Te han quitado de un plan', '«{plan}»'],
    invited: ['{name} te ha invitado', '¿Te unes a «{plan}»?'],
    invite_accepted: ['{name} ha aceptado tu invitación', '«{plan}»'],
    left: ['{name} ha dejado tu plan', '«{plan}»'],
    cancelled: ['Plan cancelado', '«{plan}» no se va a hacer.'],
    changed: ['Plan actualizado', 'Ha cambiado la hora o el lugar de «{plan}».'],
    chat: ['Nuevo mensaje en «{plan}»', '{name} ha escrito en el chat del plan.'],
    market_message: ['Nuevo mensaje sobre «{plan}»', '{name} te ha escrito en el Mercadillo.'],
    test: ['Notificaciones activadas', 'Así verás las novedades de tus planes.'],
    reminder: ['Empieza pronto: {plan}', 'Hoy a las {time} · {area}. ¡Que lo disfrutes!'],
    connect_request: ['{name} quiere conectar contigo', 'Abre su perfil para aceptar o rechazar.'],
    connect_accepted: ['{name} ha aceptado tu solicitud', 'Ya podéis escribiros.'],
    dm: ['Nuevo mensaje de {name}', 'Abre el chat para leerlo.'],
    answer: ['{name} ha respondido a tu pregunta', '«{plan}»'],
  },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

export function createPush(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_sent_at TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions(user_id)');

  let keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } : null;
  if (!keys) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'vapid_keys'").get();
    if (row) keys = JSON.parse(row.value);
    else {
      keys = webpush.generateVAPIDKeys();
      db.prepare("INSERT INTO settings (key, value) VALUES ('vapid_keys', ?)").run(JSON.stringify(keys));
    }
  }
  const subject = process.env.PUBLIC_URL?.startsWith('https://') ? process.env.PUBLIC_URL : 'https://erasquest.up.railway.app';
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  // Tests never reach real push services.
  const live = process.env.NODE_ENV !== 'test';
  const sent = []; // last payloads, kept in memory for tests

  const subscribe = (uid, sub) => {
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`).run(uid, sub.endpoint, sub.p256dh, sub.auth);
  };
  const unsubscribe = (uid, endpoint) => db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(uid, endpoint);
  const count = (uid) => db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(uid).n;

  /** Fire and forget: a failed or slow push never affects the request that caused it. */
  const send = (uid, kind, { name = '', plan = '', time = '', area = '', url = '/#/plans', tag } = {}) => {
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(uid);
    if (!subs.length) return;
    const lang = db.prepare('SELECT lang FROM profiles WHERE user_id = ?').get(uid)?.lang === 'es' ? 'es' : 'en';
    const t = TEXT[lang][kind];
    if (!t) return;
    const v = { name, time, area, plan: plan.length > 60 ? `${plan.slice(0, 57)}…` : plan };
    // Number shown on the app icon (installed app): unread updates for this person.
    const count = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(uid).n;
    const payload = JSON.stringify({ title: fill(t[0], v), body: fill(t[1], v), url, tag: tag || `${kind}-${url}`, count });
    sent.push({ uid, kind, payload: JSON.parse(payload) });
    if (sent.length > 50) sent.shift();
    if (!live) return;
    for (const s of subs) {
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: 'high' })
        .then(() => db.prepare('UPDATE push_subscriptions SET last_sent_at = ? WHERE id = ?').run(new Date().toISOString(), s.id))
        .catch((e) => {
          // The browser forgot this subscription (app removed, permission withdrawn): stop sending to it.
          if (e?.statusCode === 404 || e?.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
          else console.warn('push failed', e?.statusCode || e?.message);
        });
    }
  };

  // Chat messages: at most one pop-up per plan every 10 minutes per person, so a busy chat doesn't buzz all evening.
  const lastChat = new Map();
  const sendChat = (uid, key, data) => {
    const k = `${uid}:${key}`;
    const t = Date.now();
    if (lastChat.has(k) && t - lastChat.get(k) < 10 * 60e3) return;
    lastChat.set(k, t);
    if (lastChat.size > 5000) lastChat.clear();
    send(uid, data.kind || 'chat', data);
  };

  return { publicKey: keys.publicKey, subscribe, unsubscribe, count, send, sendChat, sent };
}
