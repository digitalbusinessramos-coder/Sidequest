// All interface text lives here so a Spanish dictionary (es) can be added later.
// Use {name} placeholders for values. The app name comes from the server config (APP_NAME).
const en = {
  'nav.explore': 'Explore',
  'nav.buddies': 'Buddies',
  'nav.plans': 'My Plans',
  'nav.guide': 'City Guide',
  'nav.profile': 'Profile',

  'welcome.tagline': 'Want to do something but have no one to go with? Find a buddy or a small group for it.',
  'welcome.step1': 'Pick something to do, or start a plan.',
  'welcome.step2': 'Ask to join, or say you’re looking for company.',
  'welcome.step3': 'Get confirmed and agree where to meet in a small chat.',
  'welcome.signup': 'Create account',
  'welcome.login': 'Log in',
  'welcome.demoTitle': 'Explore with a sample persona',
  'welcome.demoHint': 'These are fictional demo profiles for testing and presentations. They are not real students.',
  'welcome.emailNote': 'We don’t verify email addresses yet. Your email is never shown to other users.',

  'explore.eyebrow': 'Las Palmas, today and this week',
  'explore.title': 'What could you do, and who could you do it with?',
  'explore.search': 'Search activities',
  'explore.events': 'Events: find someone to go with',
  'explore.eventsHint': 'Register with the organiser. Use {app} to find company.',
  'explore.activities': 'Plans by students',
  'explore.moreFilters': 'More filters',
  'explore.create': 'Create',
  'explore.noResults': 'Nothing matches these filters yet.',
  'explore.noResultsHint': 'Try fewer filters, or create the plan yourself. Someone may be waiting for exactly that.',
  'explore.clear': 'Clear filters',

  'when.any': 'Any time', 'when.today': 'Today', 'when.tomorrow': 'Tomorrow', 'when.week': 'Next 7 days', 'when.weekend': 'This weekend',
  'filter.free': 'Free', 'filter.beginner': 'Beginner-friendly', 'filter.solo': 'Everyone comes solo', 'filter.open': 'Has places',

  'card.free': 'Free', 'card.est': 'est. €{n} pp', 'card.spots': '{n} of {max} places left', 'card.full': 'Full',
  'card.going': '{n} going', 'card.seeking': '{n} looking for company', 'card.solo': 'Everyone comes solo',

  'status.organiser': 'You organise', 'status.accepted': 'Confirmed', 'status.pending': 'Waiting for reply',
  'status.invited': 'Invited', 'status.cancelled': 'Cancelled', 'status.past': 'Past', 'status.full': 'Full',
  'status.left': 'You left', 'status.removed': 'Removed', 'status.declined': 'Not accepted',

  'act.request': 'Ask to join', 'act.requestMsg': 'Short message to the organiser (optional)',
  'act.requestPlaceholder': 'e.g. Hi! First time trying this, is that OK?',
  'act.withdraw': 'Withdraw request', 'act.leave': 'Leave this activity', 'act.chat': 'Open chat',
  'act.pendingNote': 'Your request is waiting for the organiser. You are not confirmed yet.',
  'act.acceptedNote': 'You’re confirmed. The exact meeting point is in the meet-up card and chat.',
  'act.fullNote': 'This activity is full right now.',
  'act.cancelledNote': 'This activity was cancelled by the organiser.',
  'act.pastNote': 'This activity has already happened.',
  'act.invitedNote': '{name} invited you to this activity.',
  'act.acceptInvite': 'Accept invitation', 'act.declineInvite': 'No, thanks',
  'act.organiserTools': 'Organiser tools', 'act.edit': 'Edit', 'act.cancel': 'Cancel activity',
  'act.requests': 'Requests to review', 'act.noRequests': 'No requests waiting.',
  'act.accept': 'Accept', 'act.decline': 'Decline', 'act.remove': 'Remove',
  'act.who': 'Who’s going', 'act.whoHidden': 'Names of participants are shown once you are confirmed.',
  'act.soloExplainer': 'Everyone signs up individually and is open to meeting new people. No one arrives as an existing friend group.',
  'act.meetup': 'Meet-up card', 'act.meetPoint': 'Meeting point', 'act.welcome': 'Who welcomes the group', 'act.recognise': 'How to recognise each other',
  'act.meetPointHidden': 'Approximate area shown. Confirmed participants see the exact meeting point.',
  'act.public': 'Always meet in a public place. You can leave at any time.',

  'event.register': 'Register on the official site',
  'event.registerSample': 'Sample event: there is no real registration',
  'event.separate': 'Finding company here does not register you for the event or buy a ticket.',
  'event.find': 'Find someone to go with',
  'event.seekers': 'People also looking for company',
  'event.groups': 'Groups going together',
  'event.optOut': 'Stop looking for company',
  'event.invite': 'Invite to go together',

  'plans.title': 'My Plans',
  'plans.confirmed': 'Confirmed', 'plans.waiting': 'Waiting for reply', 'plans.invited': 'Invitations',
  'plans.organising': 'You organise', 'plans.history': 'Past and cancelled',
  'plans.empty': 'No plans yet.', 'plans.emptyHint': 'Find something in Explore, or create a plan in a minute.',

  'buddies.title': 'Buddies',
  'buddies.lead': 'Save things you’d like to do. When someone in your city wants the same at a similar time, we show you and explain why.',
  'buddies.wishes': 'Your wishes', 'buddies.addWish': 'Add a wish', 'buddies.suggestions': 'People with the same wish',
  'buddies.noSuggestions': 'No matching wishes yet. We’ll show them here when someone adds a compatible wish.',
  'buddies.propose': 'Propose a plan', 'buddies.noWishes': 'You haven’t saved any wishes yet.',
  'buddies.ruleNote': 'Suggestions use simple rules: same city, same kind of activity, overlapping times and compatible budget. Nobody is added to a plan without saying yes.',

  'guide.title': 'City Guide',
  'guide.lead': 'Practical links for settling in. Official sources are kept separate from student tips.',
  'guide.checked': 'Link checked {date}', 'guide.source': 'Source: {name}',
  'guide.transport': 'Getting around', 'guide.health': 'Health and emergencies', 'guide.housing': 'Housing',
  'guide.university': 'University and student groups', 'guide.students': 'Student recommendations', 'guide.links': 'Useful links',
  'guide.official': 'Official', 'guide.community': 'Community tip', 'guide.placeholder': 'Placeholder',

  'profile.title': 'Profile', 'profile.edit': 'Edit profile', 'profile.privacy': 'Privacy and safety',
  'profile.visible': 'Show me to people looking for company', 'profile.visibleHint': 'Turn off to pause. You’ll still see your own plans.',
  'profile.nearby': 'Approximate nearby discovery', 'profile.nearbyHint': 'Off by default. Uses your location once to pick the nearest neighbourhood. We store only the neighbourhood name, never coordinates.',
  'profile.sample': 'Show sample content', 'profile.sampleHint': 'Fictional demo profiles and events, always labelled “Sample”.',
  'profile.area': 'Your approximate area', 'profile.blocked': 'Blocked people', 'profile.noBlocked': 'You haven’t blocked anyone.',
  'profile.logout': 'Log out', 'profile.delete': 'Delete account',
  'profile.deleteHint': 'Removes your profile, wishes, requests and messages. Activities you organise are cancelled. This cannot be undone.',
  'profile.emailUnverified': 'Email not verified. {app} does not verify email addresses or student status yet.',

  'person.block': 'Block', 'person.unblock': 'Unblock', 'person.report': 'Report',
  'person.blockConfirm': 'Block {name}? You won’t see each other’s plans, requests or messages.',

  'report.title': 'Report', 'report.reason': 'What’s the problem?', 'report.details': 'Details (optional)',
  'report.send': 'Send report', 'report.sent': 'Thanks. Your report was saved for review.',
  'report.note': 'If you are in danger, call 112 (EU emergency number).',

  'common.save': 'Save', 'common.cancel': 'Cancel', 'common.back': 'Back', 'common.retry': 'Try again', 'common.close': 'Close',
  'common.loading': 'Loading…', 'common.error': 'Something went wrong.', 'common.sample': 'Sample', 'common.next': 'Next',
  'common.offline': 'Can’t reach the server. Check your connection.',
};

import { es, esKeys } from './i18n.es.js';

const dictionaries = { en, es: esKeys };
const phrases = { es }; // English sentence -> translation, for tx()
const LOCALES = { en: 'en-GB', es: 'es-ES' };
let lang = 'en';
let appName = 'SIDEQUEST';

function initialLanguage() {
  try {
    const saved = localStorage.getItem('sq_lang');
    if (saved && dictionaries[saved]) return saved;
  } catch { /* storage unavailable */ }
  return (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}
lang = typeof window !== 'undefined' ? initialLanguage() : 'en';
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const LANGUAGE_OPTIONS = [{ key: 'en', label: 'English' }, { key: 'es', label: 'Español' }];
export function setAppName(name) { appName = name || appName; }
export function getAppName() { return appName; }
export function getLanguage() { return lang; }
export function locale() { return LOCALES[lang]; }
export function setLanguage(l) {
  if (!dictionaries[l]) return;
  lang = l;
  try { localStorage.setItem('sq_lang', l); } catch { /* storage unavailable */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => (k === 'app' ? appName : vars[k] ?? ''));

/** Keyed strings, e.g. t('nav.explore'). */
export function t(key, vars = {}) {
  return fill(dictionaries[lang][key] ?? en[key] ?? key, vars);
}

/** Sentence strings: the English text is the key, e.g. tx('Ask to join'). Missing translations fall back to English. */
export function tx(text, vars = {}) {
  if (text == null) return '';
  const tr = lang === 'en' ? text : phrases[lang]?.[text] ?? text;
  return fill(tr, vars);
}
