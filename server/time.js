// Time helpers. All times are stored in UTC ISO strings and converted using the city's IANA timezone.

function tzOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time like "2026-11-12T18:30" in timeZone to a UTC ISO string. */
export function localToUtcIso(local, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ts = guess - tzOffsetMs(new Date(guess), timeZone);
  ts = guess - tzOffsetMs(new Date(ts), timeZone); // second pass handles DST edges
  return new Date(ts).toISOString();
}

/** Convert a UTC ISO string to wall-clock "YYYY-MM-DDTHH:mm" in timeZone (for edit forms). */
export function utcToLocalInput(iso, timeZone) {
  const d = new Date(iso);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Day-of-week key (mon..sun) and part of day (morning/afternoon/evening) of a UTC time in timeZone. */
export function slotOf(iso, timeZone) {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(d).toLowerCase().slice(0, 3);
  const h = +new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(d);
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return `${wd}_${part}`;
}
