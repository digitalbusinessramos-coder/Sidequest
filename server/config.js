// Central configuration. Change APP_NAME here or via environment variable to rename the app.
export const config = {
  appName: process.env.APP_NAME || 'SIDEQUEST',
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || './data/sidequest.db',
  // Demo mode: seeds clearly labelled fictional profiles/events and allows "try as demo persona" logins.
  demoMode: process.env.DEMO_MODE !== 'off',
  sessionDays: 30,
  secureCookies: process.env.NODE_ENV === 'production',
  defaultCity: 'las-palmas',
};
