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
