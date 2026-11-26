# Deploying the help desk

The help desk is two pieces, hosted separately:

| Piece | What it is | Where it runs |
|---|---|---|
| **Dashboard + Messenger** | Static files built from `client/agent-dashboard` | Any static web host (your own web server, a CDN, or the same machine as the server) |
| **Server** | Node.js API + live updates (Socket.IO), in `server/` | **Render** or **Railway** (always-on Node) |
| **Database** | All workspaces, conversations, settings | **MongoDB Atlas** (free tier is fine to start) |

The server must stay running (live chat) and needs a real database, so it can't live on a static host. Locally the
server keeps data in `server/.data/` JSON files; in production it refuses to start without MongoDB.

```
Customer's website ──<script src=".../messenger.js">──▶ Static host (Messenger iframe) ──┐
Your team ──────────────────────────────────────────▶ Static host (dashboard) ───────────┤ HTTPS + WebSocket
                                                                                     ▼
                                                                   Render/Railway (server) ──▶ MongoDB Atlas
```

---

## 1. Database: MongoDB Atlas

1. Create a free cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. **Database Access** › add a user with a password.
3. **Network Access** › allow `0.0.0.0/0` (Render and Railway don't have fixed addresses on free plans).
4. **Connect › Drivers** › copy the connection string and put your password in it, plus a database name before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/help-desk?retryWrites=true&w=majority`

## 2. Server: Render (or Railway)

**Render** (uses `render.yaml` from this repo):
1. [dashboard.render.com](https://dashboard.render.com) › **New › Blueprint** › pick this GitHub repo.
2. Fill in when asked:
   - `MONGODB_URI`: the Atlas string from step 1
   - `DASHBOARD_URL`: your dashboard's address, e.g. `https://help.yourco.com` (you can set it after step 3)
   - `PUBLIC_API_URL`: this service's own address, e.g. `https://help-desk-api.onrender.com`
   - `JWT_SECRET` is generated for you.
3. Deploy, then open `https://<your-service>.onrender.com/health`. It should say the server is up.

**Railway** instead: New project › Deploy from GitHub › root directory `server`, build
`npm ci --include=dev && npm run build`, start `npm start`, and add the same variables (see `server/.env.example`),
with `NODE_ENV=production` and a `JWT_SECRET` from `openssl rand -hex 32`.

If something is missing, the server stops at start-up and its log says exactly which setting to fix.

## 3. Dashboard: any static web host

1. Build it with your server's address (it's built into the files, so rebuild whenever it changes):
   ```bash
   cd client/agent-dashboard
   npm ci
   VITE_API_URL=https://help-desk-api.yourco.com npm run build
   ```
   Upload the contents of `client/agent-dashboard/dist/` to your web host, served over **HTTPS**.
2. **Every address must serve `index.html`** (it's a single-page app: `/agent/inbox`, `/agent/settings/…`,
   `/messenger/<appId>`). nginx: `location / { try_files $uri /index.html; }`.
3. **Recommended headers**: on every response `X-Content-Type-Options: nosniff` and
   `Referrer-Policy: strict-origin-when-cross-origin`; on `/agent/*` also `X-Frame-Options: DENY` (so the
   dashboard can't be shown inside other sites). Do **not** add a frame block on `/messenger/*`: customers'
   websites show the Messenger in a frame. Optionally redirect `/` to `/agent`.
4. Put the dashboard's address in the server's `DASHBOARD_URL` (step 2) if you haven't, and restart the server.

## 4. Create your company's workspace

Open `https://<your-dashboard>/agent/signup`, enter the company name, your name, email and a password.
You get a new, empty workspace with its own **Messenger App ID**, and you're its admin.

- **Invite teammates**: Settings › Teammates.
- **Add the Messenger to your website**: Settings › Messenger Live Chat › Install. The snippet points at your
  dashboard's address and carries your App ID.
- **Email, AI, knowledge base**: Settings › Email (SMTP/IMAP), Settings › AI assistant (API key),
  Knowledge base in the left menu.

Every company that signs up gets its own workspace; they never see each other's conversations, contacts or
settings. To run it for one company only, set `ALLOW_SIGNUP=false` on the server after creating yours.

## Your signed-in users (your own MongoDB)

When someone signed in to your product opens the Messenger, your page passes their **user id** and a
**user_hash** that proves it came from your server:

```html
<script>
  window.ChaiSamosaSettings = { app_id: "YOUR_APP_ID", user_id: "<their id from your database>", user_hash: "<from your server>" };
</script>
```

- `user_hash` = HMAC-SHA256 of the user id with the secret from **Settings › Security**, as 64 hex characters,
  computed on your server (Node: `crypto.createHmac('sha256', SECRET).update(userId).digest('hex')`).
  Never put the secret in the page. In production a user id without a valid hash is ignored (the visitor
  is treated as a guest) unless an admin turns verification off.
- **Phone, name and email from your database:** set the `USER_DIRECTORY_*` settings on the server (see
  `server/.env.example`): a read-only connection string to your product database, the collection, and which
  fields hold the id, phone, name and email. The help desk then looks each verified user up and keeps their
  contact up to date, so your page doesn't need to pass the phone at all. Settings › Security shows whether
  it's connected.
- Without a user directory, pass `name`, `email` and `phone` in `ChaiSamosaSettings` too; they're copied onto
  the contact whenever they change.
- **Keep the help desk in its own database.** It has its own `users` collection (your support team), which
  would clash with your product's. Use a different database name in `MONGODB_URI` (the same cluster is fine).
- If someone chats as a guest and then signs in, their earlier chats move onto their account automatically.

## Moving existing conversations

A new workspace starts empty. Your local test data (`server/.data/`) is **not** uploaded anywhere.
To bring conversations over from another tool (e.g. Intercom), export them there as CSV and use
**Settings › Imports & exports**. Knowledge-base articles and macros have their own **Import** buttons.

## Before you go live (checklist)

**Settings**
- [ ] `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET` (64 random hex characters from `openssl rand -hex 32`,
      never the one from your laptop), `DASHBOARD_URL` and `PUBLIC_API_URL` are set on the server.
- [ ] The dashboard was built with `VITE_API_URL` set to the server's address, and serves `index.html` for every address.
- [ ] The production database is **not** the one you tested with, or its test data has been cleared. Use a
      database user that can only reach this database, and a password you haven't pasted anywhere.
- [ ] `ALLOW_SIGNUP=false` if only your company uses this help desk (otherwise anyone can create a workspace).
- [ ] `SEED_DEMO_ADMIN` and `ALLOW_TESTING_TOOLS` are **not** set.

**Your website / app**
- [ ] Signed-in users: your server computes `user_hash` (Settings › Security). In production a `user_id` without a
      valid hash is treated as a guest, so without it signed-in users won't see their history. Keep identity
      verification **on**; turning it off lets anyone who knows a user id read that person's chats.
- [ ] Settings › Messenger › Allowed domains lists only your sites.

**After the first deploy**
- [ ] `https://<server>/health` says `mongoConnected: true`.
- [ ] Sign up your workspace, invite teammates, send a test chat from your website, reply from the dashboard,
      attach a file, and open it from both sides.
- [ ] Add a persistent disk for `uploads/` (see below), or attachments disappear on the next deploy.
- [ ] Two-step sign-in (2FA) is on for GitHub, your hosting and MongoDB Atlas accounts.

**Built-in protections** (no action needed): sign-in attempts are limited (10 per email / 40 per network every
15 minutes); visitors' messages and uploads are rate-limited; uploads must be images, documents, archives, audio
or video (no web pages or scripts) and are served so they can't run in the browser; the dashboard can't be
embedded in other sites (with the headers from step 3); the Testing panel is off; each company only ever sees its own data.

## Good to know

- **File uploads** (attachments, avatars) are stored on the server's disk. On Render/Railway free plans that disk
  is wiped on each deploy; add a persistent disk (Render: Disks, mount at `/opt/render/project/src/server/uploads`)
  if attachments must survive.
- **Free plans sleep** when idle (Render free: after ~15 minutes); the first request then takes ~30 seconds and
  live chat reconnects. Use a paid instance for a real support team.
- **Custom domains**: if the dashboard has more than one address, list them all in the server's `CORS_ORIGINS`
  (comma-separated) and update `VITE_API_URL` if the server moves.
- **Local development is unchanged**: `npm run dev` in `server/` and `client/agent-dashboard/` still uses
  `localhost` and the JSON files, and pre-fills the local test login.
