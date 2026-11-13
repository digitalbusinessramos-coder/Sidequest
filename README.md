# SIDEQUEST (working name)

Find company for activities in Las Palmas de Gran Canaria. For Erasmus, international and local students who think: *"I want to do this, but I don't have anyone to go with."*

The app covers the step between discovering something and actually going: **"I'm interested" → "I have someone to go with and we know where to meet."**

> Student project prototype. Not affiliated with ESN, ULPGC or any other organisation. All sample profiles and events are fictional and labelled "Sample".

## Rename the app

Set the environment variable `APP_NAME` (default `SIDEQUEST`). It is read in `server/config.js` and sent to the frontend; no code changes needed.

## Run it locally

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite` module).

```bash
npm install
npm run build      # builds the React frontend into dist/
npm start          # serves app + API on http://localhost:3000
```

For development with hot reload: `npm run dev` (frontend on http://localhost:5173, API on 3000).

## Test it

```bash
npm test                 # 22 API tests with separate accounts against a real server + database
npm start & npm run test:browser   # 3 browser users on phone-sized screens, full journey
npm run check:i18n       # lists any interface sentence that has no Spanish translation
```

### How to demo with two people

1. Open the app in two different browsers (or one normal + one private window).
2. Window 1: create an account, create a plan (e.g. Museum visit, group size 2).
3. Window 2: create a second account, find the plan in Explore, tap **Ask to join**.
4. Window 1: open the plan, **Accept**. Window 2 updates within about 10 seconds to **Confirmed**.
5. Both: **Open chat**, agree on the meeting point. Messages appear within about 3 seconds.

You can also log in as a fictional sample persona from the welcome screen (e.g. accept requests as "Lena").

## How it works (for the presentation)

| Part | Choice | Why |
| --- | --- | --- |
| Frontend | React (Vite), mobile-first, hash routing | Works in any phone browser from one link |
| Backend | Node.js + Express | All rules (capacity, who may chat, who may manage) are checked here, not only hidden in the UI |
| Database | SQLite file (`DB_PATH`) | Real persistence with zero setup; can move to Postgres later |
| Login | Email + password (scrypt hash), http-only session cookie | No secrets in the browser |
| Email confirmation | Optional link sent through Resend (`RESEND_API_KEY`) | The badge says "Email confirmed" and explains it only proves the person received the email, not that they are a student |
| Notifications | Stored on the server as the kind of event (request, accept, cancel, change...) and written out in each person's language | Updates show in My Plans with unread badges; unread chat messages show on each plan |
| Languages | English and Spanish; `t('key')` for short labels, `tx('English sentence')` for longer text, Spanish in `src/i18n.es.js` | Switch in Welcome and Profile. The Spanish text was drafted with AI and still needs review by a native speaker |
| Live updates | The screen asks the server for changes every 3 s (chat) to 30 s (lists) | Simple and reliable; no extra service |
| Capacity | Every accept runs in a database transaction that recounts places | Two accepts at the same moment cannot overfill a group |
| Time | Stored in UTC, shown in the city time zone (`Atlantic/Canary`) | Correct for every visitor and across daylight-saving changes |
| Cities | `cities` table with time zone and approximate areas | Adding a city is data, not a rewrite |
| Matching | Plain rules: same city + same activity type + overlapping time slots + compatible budget; shared languages mentioned | Explainable; no scores, no "AI" claims |
| Joining | Organiser picks "people ask, you accept" or "anyone can join directly" | Open plans skip the wait; the organiser can still remove someone |
| Map | Leaflet with OpenStreetMap/CARTO tiles; list or map view in Explore | Pins sit at the neighbourhood centre, never the exact meeting point |
| Calendar | My Plans can show a week strip and a day timetable | Plans and events you joined, side by side when they overlap |
| Tips | Students post recommendations, like and save them (City Guide) | Saves are private; blocked people's tips are hidden |
| Event chat | Group chat for everyone who joins an event's group | Leaving the group removes access |
| Pictures | Profile photos are resized in the browser (max 512 px JPEG) and only shown to logged-in users | Sample personas use drawn CC0 avatars (DiceBear "Notionists"), never photos of real people. City photos come from Wikimedia Commons with credits in the app |

### Important rules the server enforces

- The organiser counts towards the group size (a size of 2 = one buddy).
- A person cannot request the same activity twice, or request their own.
- Accepting can never exceed capacity, including simultaneous accepts.
- Only the organiser can accept, decline, remove, edit or cancel.
- Only the organiser and accepted participants can read or post in the chat; leaving or being removed ends access.
- The exact meeting point is visible only to confirmed participants.
- Invitations are only possible to people who opted in (same wish, or "looking for company" for that event), and they must accept. Nobody is enrolled automatically.
- Event registration is never handled in the app. Joining a "going together" group is clearly not a booking.
- Blocking hides both people from each other everywhere. Reports are stored (`GET /api/admin/reports` with header `x-admin-token: $ADMIN_TOKEN`).
- Account deletion removes profile, wishes, requests and messages, and cancels activities the person organised.
- Nearby discovery is off by default; when switched on, the phone works out the nearest neighbourhood locally and only the neighbourhood name is sent.

## Host it (needed for a shareable link)

Any host that runs a Node server and has a **persistent disk** works. Without a disk the database is lost on restart, so don't present such a deployment as persistent.

- **Render**: connect the GitHub repo, use `render.yaml` (Starter plan + 1 GB disk at `/var/data`).
- **Railway**: new project from the repo, add a Volume mounted at `/data`, set `DB_PATH=/data/sidequest.db`, build `npm ci && npm run build`, start `npm start`.
- **Fly.io / any Docker host**: use the `Dockerfile` and mount a volume at `/data`.

Environment variables: `APP_NAME`, `PORT`, `DB_PATH`, `DEMO_MODE` (`off` hides sample personas/content), `ADMIN_TOKEN`, `NODE_ENV=production` (secure cookies, requires HTTPS), `AUTH_RATE_LIMIT` (sign-in attempts per IP per 10 min, default 100).

Optional email confirmation: `RESEND_API_KEY`, `EMAIL_FROM` (an address on a domain verified in Resend) and `PUBLIC_URL` (the deployed link, used in the email). Without them the app works normally and the Profile screen says email confirmation is not set up yet.

### Railway, step by step

1. New Project, Deploy from GitHub repo, pick this repo. Railway finds the `Dockerfile`.
2. Right-click the service, Attach Volume, mount path `/data`.
3. Settings, Networking, Generate Domain. That URL is the shareable link.
4. Optional: add the email variables above under Variables.

## Data and demo content

- On first start the server creates the Las Palmas city record, the city guide and (if `DEMO_MODE` is not `off`) six fictional sample personas with sample activities and events. Sample activities are re-created with fresh dates when they expire.
- Sample content is flagged `is_sample`/`is_demo` in the database and labelled in the UI. Users can hide it in Profile.
- `npm run seed -- --force` refreshes the city guide and sample content.

## City guide sources

Guide entries link to official pages instead of copying timetables, prices or medical guidance. Links were opened on 2026-11-06. Two could not be verified and are shown as placeholders or flagged: the interurban bus operator's website (did not load), and the content of ULPGC's "Becas y alojamiento" page (link found on the ULPGC homepage, page did not load). Student recommendations are an empty placeholder: none have been collected.

## Known limitations

- Student status is never verified. Email addresses are confirmed only when the email variables are set and the person clicks the link.
- No push notifications or notification emails: users see updates when they open the app.
- No moderation dashboard: reports are stored but only readable through the admin API.
- Polling instead of websockets: fine for a class-sized pilot, not for thousands of users.
- Spanish translation is AI-drafted and not yet reviewed by a native speaker. Text written by users (plan titles, chat) is not translated.
- No photo uploads; avatars are initials.
- Single server process (SQLite). Scaling up would mean Postgres.

## Comparing with the WhatsApp process (protocol, no results yet)

Give each participant the same task, e.g. *"Find one person to visit a museum with on Thursday afternoon and agree where to meet."* Run it once in a WhatsApp group and once in the app (alternate the order between participants). Record:

| Measure | How |
| --- | --- |
| Completion time | Stopwatch from start to agreed meeting point |
| Steps | Count taps/messages needed |
| Successful coordination | Did they end with a person, time and public meeting point? (yes/no) |
| Willingness to use again | 1–5 rating after each method |

Report the real numbers, including where WhatsApp does better.

## Project structure

```
server/   config.js  db.js (schema)  api.js (all endpoints + rules)  auth.js  time.js  seed.js  index.js
shared/   catalog.js (categories, templates, languages, report reasons)
src/      App.jsx (routing, tabs)  components.jsx  i18n.js  util.js  styles.css  screens/*.jsx
test/     api.test.js (server)  e2e.browser.cjs (browser)
```
