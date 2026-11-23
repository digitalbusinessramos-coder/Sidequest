// Central configuration. Change APP_NAME here or via environment variable to rename the app.
export const config = {
  // The old working name may still be set as APP_NAME on the host; the product is now Erasquest.
  appName: (process.env.APP_NAME && !/^(sidequest|erasmus juntos)$/i.test(process.env.APP_NAME.trim())) ? process.env.APP_NAME : 'Erasquest',
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || './data/sidequest.db',
  // Demo mode = guest access without an account (and example content for tests). Off unless switched on:
  // set DEMO_MODE=on on the host. Without the variable it is only on for local development and automated tests.
  demoMode: process.env.DEMO_MODE ? ['on', 'true', '1'].includes(process.env.DEMO_MODE.trim().toLowerCase()) : process.env.NODE_ENV !== 'production',
  sessionDays: 30,
  secureCookies: process.env.NODE_ENV === 'production',
  defaultCity: 'las-palmas',
};
