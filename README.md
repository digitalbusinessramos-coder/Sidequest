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
npm test                 # 15 API tests with separate accounts against a real server + database
npm start & npm run test:browser   # 3 browser users on phone-sized screens, full journey
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
| Login | Email + password (scrypt hash), http-only session cookie | No secrets in the browser. Email is **not verified**, and the app says so |
| Live updates | The screen asks the server for changes every 3 s (chat) to 30 s (lists) | Simple and reliable; no extra service |
| Capacity | Every accept runs in a database transaction that recounts places | Two accepts at the same moment cannot overfill a group |
| Time | Stored in UTC, shown in the city time zone (`Atlantic/Canary`) | Correct for every visitor and across daylight-saving changes |
| Cities | `cities` table with time zone and approximate areas | Adding a city is data, not a rewrite |
| Matching | Plain rules: same city + same activity type + overlapping time slots + compatible budget; shared languages mentioned | Explainable; no scores, no "AI" claims |

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

Environment variables: `APP_NAME`, `PORT`, `DB_PATH`, `DEMO_MODE` (`off` hides sample personas/content), `ADMIN_TOKEN`, `NODE_ENV=production` (secure cookies, requires HTTPS).

## Data and demo content

- On first start the server creates the Las Palmas city record, the city guide and (if `DEMO_MODE` is not `off`) six fictional sample personas with sample activities and events. Sample activities are re-created with fresh dates when they expire.
- Sample content is flagged `is_sample`/`is_demo` in the database and labelled in the UI. Users can hide it in Profile.
- `npm run seed -- --force` refreshes the city guide and sample content.

## City guide sources

Guide entries link to official pages instead of copying timetables, prices or medical guidance. Links were opened on 2026-11-06. Two could not be verified and are shown as placeholders or flagged: the interurban bus operator's website (did not load), and the content of ULPGC's "Becas y alojamiento" page (link found on the ULPGC homepage, page did not load). Student recommendations are an empty placeholder: none have been collected.

## Known limitations

- Email addresses and student status are not verified.
- No push or email notifications: users see updates when they open the app (badges on My Plans and Buddies).
- No moderation dashboard: reports are stored but only readable through the admin API.
- Polling instead of websockets: fine for a class-sized pilot, not for thousands of users.
- English only for now. All interface text is in `src/i18n.js`, ready for a Spanish dictionary; a few longer helper sentences are still inline in screens.
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
