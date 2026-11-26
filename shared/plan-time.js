// Shared between server and client: how a plan's stored times may be used.
//
// Plans whose day isn't fixed yet ("This weekend", "This week", "Day to be agreed") store starts_at / ends_at only as the
// window in which the plan stays listed. starts_at is NOT a real date or time, so it must never be shown, put in a
// calendar or used to decide that a plan is "today" or has already started. Plans with a fixed day but the time still
// to be agreed store 12:00 that day as a sorting placeholder: the day is real, the 12:00 is not.

/** True when the creator chose an actual day. */
export const hasFixedDay = (a) => !a.day_mode || a.day_mode === 'day';

/** True when the creator chose an exact start time (older plans without time_mode had one). */
export const hasExactTime = (a) => hasFixedDay(a) && (!a.time_mode || a.time_mode === 'exact');

/**
 * Where a plan goes in the calendar: 'skip' (day not fixed, not in the calendar at all),
 * 'allday' (real day, time to be agreed: listed for that day without a time), or 'timed' (exact time or part of the day).
 */
export function calendarPlacement(a) {
  if (!hasFixedDay(a)) return 'skip';
  if (a.time_mode === 'tbd') return 'allday';
  return 'timed';
}

/**
 * When a plan counts as started (ISO string), for "upcoming" checks. Exact-time plans start at starts_at; any plan
 * whose time or day is still open stays upcoming until its listing window ends.
 */
export const effectiveStart = (a) => (hasExactTime(a) ? a.starts_at : a.ends_at || a.starts_at);

/**
 * Order of the plans list: 0 = a real day (soonest first), 1 = "This weekend" / "This week", 2 = day to be agreed.
 * Within a real day, plans with a known time come before "time to be agreed". Ties (and the two open groups) show the
 * newest plan first, so a plan that was just posted is at the top of its group.
 */
export const listGroup = (a) => (hasFixedDay(a) ? 0 : a.day_mode === 'flex' ? 2 : 1);

export function comparePlans(a, b) {
  const ga = listGroup(a); const gb = listGroup(b);
  if (ga !== gb) return ga - gb;
  if (ga === 0) {
    const da = a.day || String(a.starts_at).slice(0, 10); const db = b.day || String(b.starts_at).slice(0, 10);
    if (da !== db) return da < db ? -1 : 1;
    const ta = a.time_mode === 'tbd' ? 1 : 0; const tb = b.time_mode === 'tbd' ? 1 : 0;
    if (ta !== tb) return ta - tb;
    if (a.starts_at !== b.starts_at) return a.starts_at < b.starts_at ? -1 : 1;
  }
  return b.id - a.id;
}

/** Members can suggest a date and time while the plan has no exact day and time yet. */
export const canSuggestTime = (a) => !hasExactTime(a);
