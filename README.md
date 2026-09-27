# Deploying to Railway — 3 services, 1 repo

This project has three independently-deployable pieces:

```
backend/                   Express API (Node)
dental-admin-frontend/     Static staff console
patient-site/              Static patient booking portal
```

Push this whole folder to a single GitHub repo. On Railway you'll create **three
services from that one repo**, each pointed at a different subfolder ("root
directory"). Do the backend first — you need its URL for the other two.

## 1. Deploy the backend

1. Railway dashboard → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. On the new service: **Settings → Root Directory** → set to `backend`.
3. Railway auto-detects Node via Nixpacks and runs `npm install` + `npm start`
   (defined in `backend/package.json`). No extra config needed.
4. **Settings → Networking → Generate Domain** to get a public URL, e.g.
   `https://dental-clinic-backend-production.up.railway.app`.
5. Confirm it's alive: visit `<that-url>/api/health` — should return `{"ok":true,...}`.

### ⚠️ Important: the "database" is a JSON file on disk

`server.js` stores everything in `db.json` right next to it. Railway's
filesystem is **ephemeral** — every redeploy wipes it, and you get a fresh
seeded dataset. That's fine for demos, but if you want data to survive
redeploys:

- Add a **Railway Volume** (Service → Settings → Volumes) mounted at, say,
  `/data`, and change `DB_PATH` in `server.js` to `path.join("/data", "db.json")`.
- Or swap the JSON file for a real database (Railway offers one-click
  Postgres) — a bigger change, ask if you want help with that.

### Optional: lock down CORS

By default the API accepts requests from any origin (fine since there's no
cookie-based auth — the patient portal uses a bearer token). To restrict it,
set an environment variable on the backend service:

```
ALLOWED_ORIGINS=https://your-admin-url.up.railway.app,https://your-patient-url.up.railway.app
```

## 2. Deploy the admin console

1. Same repo, **New Service → root directory** → `dental-admin-frontend`.
2. Nixpacks installs `serve` (from `package.json`) and runs it as a static
   file server on Railway's assigned `$PORT`.
3. Generate a public domain for this service too.
4. **Edit `dental-admin-frontend/config.js`** and set:
   ```js
   window.API_BASE_URL = "https://dental-clinic-backend-production.up.railway.app";
   ```
   (your real backend URL from step 1). Commit and push — Railway redeploys
   automatically.
5. Staff login is hardcoded client-side (prototype only): `secretary` / `clinic123`.

## 3. Deploy the patient site

Same as step 2, but root directory `patient-site`, and same `config.js` edit
in that folder pointing at the same backend URL.

## What changed from your original code

- **`server.js`**: now listens on `process.env.PORT` (Railway assigns this;
  it doesn't listen on 3000 by default). Also added a full auth system
  (`/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/me`,
  `/api/me/appointments`) — the patient site's `app.js` was already calling
  these endpoints, but they didn't exist in the backend you gave me. Sessions
  are simple bearer tokens stored in `db.json`; passwords are hashed with
  `bcryptjs`. `POST /api/appointments` now also accepts a bearer token and
  books for that patient automatically (the admin panel's flow, with
  `patientId`/`newPatientName` in the body, still works unchanged).
- **`dental-admin-frontend/index.html`**: this file was missing from what you
  uploaded — only `css/styles.css` and `js/app.js` were present. I rebuilt it
  to match every element ID/class the existing `app.js` and `styles.css`
  already expected (verified — every `getElementById` call in `app.js`
  resolves against this file). Worth a visual check once it's deployed, since
  I was reconstructing layout/copy, not recovering an original design.
- **`config.js`** added to both frontends so the backend URL is a one-line
  edit instead of a hardcoded `localhost:3000` baked into `app.js`.
- **`package.json`** added to both frontends (using the `serve` package) so
  Railway has something to run — Railway/Nixpacks needs a start command, and
  plain static folders don't have one on their own.

## Local testing

Each folder is independently runnable:

```bash
cd backend && npm install && npm start          # http://localhost:3000
cd dental-admin-frontend && npm install && npm start   # serves on $PORT
cd patient-site && npm install && npm start            # serves on $PORT
```

For local testing, leave `config.js` pointing at `http://localhost:3000`
(the default) in both frontends.
