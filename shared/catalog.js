// Shared between server and client. Labels are English; add translations in src/i18n.
export const CATEGORIES = [
  { key: 'coffee', label: 'Coffee & food', phrase: 'grab coffee or food' },
  { key: 'museum', label: 'Museums', phrase: 'visit a museum' },
  { key: 'culture', label: 'Concerts & culture', phrase: 'go to a concert or cultural event' },
  { key: 'hiking', label: 'Hiking', phrase: 'go hiking' },
  { key: 'beach', label: 'Beach & sunset', phrase: 'spend time at the beach or watch the sunset' },
  { time: '10:00', key: 'surf', label: 'Surf & water', phrase: 'try surfing or water sports' },
  { key: 'sports', label: 'Sports', phrase: 'play sports' },
  { time: '09:30', key: 'daytrip', label: 'Day trips', phrase: 'explore a nearby town' },
  { key: 'nightout', label: 'Night out', phrase: 'go out in the evening' },
  { key: 'food', label: 'Tapas & dinner', phrase: 'have dinner or tapas' },
  { key: 'study', label: 'Study & languages', phrase: 'study or practise languages' },
  { key: 'wellness', label: 'Yoga & wellness', phrase: 'do yoga or something relaxing' },
  { key: 'games', label: 'Games & quiz nights', phrase: 'play games or join a quiz' },
  { key: 'shopping', label: 'Markets & shopping', phrase: 'visit a market or go shopping' },
  { key: 'photo', label: 'Photo walks', phrase: 'take photos around the city' },
  { key: 'other', label: 'Something else', phrase: 'do something together' },
];

export const TEMPLATES = [
  { key: 'coffee', category: 'coffee', label: 'Coffee between classes', title: 'Coffee between classes', duration: 60, max: 4, cost: 3, beginner: true },
  { key: 'museum', category: 'museum', label: 'Museum visit', title: 'Museum visit', duration: 120, max: 4, cost: 5, beginner: true },
  { time: '09:00', key: 'hike', category: 'hiking', label: 'Beginner hike', title: 'Beginner hike', duration: 240, max: 6, cost: 0, beginner: true, pace: 'relaxed', transport: 'Bus or shared car — agree in the chat' },
  { key: 'volleyball', category: 'sports', label: 'Beach volleyball', title: 'Beach volleyball', duration: 90, max: 8, cost: 0, beginner: true },
  { key: 'surf', category: 'surf', label: 'First surf session', title: 'Trying surfing for the first time', duration: 120, max: 4, cost: 25, beginner: true },
  { time: '18:30', key: 'sunset', category: 'beach', label: 'Sunset watch', title: 'Watching the sunset', duration: 60, max: 6, cost: 0, beginner: true },
  { time: '20:00', key: 'concert', category: 'culture', label: 'Concert or event', title: 'Concert together', duration: 150, max: 4, cost: 15 },
  { key: 'daytrip', category: 'daytrip', label: 'Explore a nearby town', title: 'Day trip', duration: 360, max: 5, cost: 10, transport: 'Interurban bus — agree in the chat' },
  { time: '22:00', key: 'nightout', category: 'nightout', label: 'Night out', title: 'Night out together', duration: 240, max: 6, cost: 15 },
  { time: '20:30', key: 'tapas', category: 'food', label: 'Tapas evening', title: 'Tapas evening', duration: 120, max: 6, cost: 15, beginner: true },
  { time: '19:00', key: 'tandem', category: 'study', label: 'Language exchange', title: 'Language exchange (tandem)', duration: 90, max: 6, cost: 3, beginner: true },
  { time: '10:00', key: 'studysession', category: 'study', label: 'Study session', title: 'Study session at the library', duration: 180, max: 5, cost: 0, beginner: true },
  { time: '08:30', key: 'yoga', category: 'wellness', label: 'Yoga on the beach', title: 'Yoga on the beach', duration: 60, max: 8, cost: 0, beginner: true },
  { time: '19:30', key: 'quiz', category: 'games', label: 'Board games or quiz', title: 'Board games evening', duration: 150, max: 6, cost: 5, beginner: true },
  { time: '10:00', key: 'market', category: 'shopping', label: 'Market visit', title: 'Morning at the market', duration: 90, max: 5, cost: 5, beginner: true },
  { key: 'photowalk', category: 'photo', label: 'Photo walk', title: 'Photo walk through the old town', duration: 120, max: 6, cost: 0, beginner: true },
  { key: 'other', category: 'other', label: 'Start from scratch', title: '', duration: 90, max: 4, cost: 0 },
];

export const LANGUAGES = ['English', 'Spanish', 'Italian', 'German', 'French', 'Portuguese', 'Polish', 'Dutch', 'Czech', 'Romanian', 'Greek', 'Swedish', 'Turkish', 'Other'];

export const DAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];
export const PARTS = [['morning', 'morning'], ['afternoon', 'afternoon'], ['evening', 'evening']];

export const BUDGETS = [
  { key: 'free', label: 'Free only', max: 0 },
  { key: 'low', label: 'Up to €10', max: 10 },
  { key: 'any', label: 'Any budget', max: Infinity },
];

export const REPORT_REASONS = [
  'Made me feel unsafe', 'Harassment or hateful content', 'Spam or advertising',
  'Fake profile or impersonation', 'Inappropriate content', 'Something else',
];

export function categoryLabel(key) { return CATEGORIES.find((c) => c.key === key)?.label || 'Activity'; }
export function categoryPhrase(key) { return CATEGORIES.find((c) => c.key === key)?.phrase || 'do something together'; }
export function slotLabel(slot) {
  const [d, p] = slot.split('_');
  return `${DAYS.find((x) => x[0] === d)?.[1] || d} ${p}`;
}

/** Categories for student recommendations (places and tips). */
export const REC_CATEGORIES = [
  { key: 'food', label: 'Food & drink' },
  { key: 'nightlife', label: 'Nightlife' },
  { key: 'beach', label: 'Beaches & outdoors' },
  { key: 'culture', label: 'Culture' },
  { key: 'study', label: 'Places to study' },
  { key: 'practical', label: 'Practical tips' },
];
