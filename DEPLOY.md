# Deploying the help desk

The help desk is two pieces, hosted separately:

| Piece | What it is | Where it runs |
|---|---|---|
| **Dashboard + Messenger** | Static files built from `client/agent-dashboard` | **Netlify** (or any static host) |
| **Server** | Node.js API + live updates (Socket.IO), in `server/` | **Render** or **Railway** (always-on Node) |
| **Database** | All workspaces, conversations, settings | **MongoDB Atlas** (free tier is fine to start) |

Netlify can't run the server: it needs to stay running for live chat, and it needs a real database. Locally the
server keeps data in `server/.data/` JSON files; in production it refuses to start without MongoDB.

```
Customer's website ──<script src=".../messenger.js">──▶ Netlify (Messenger iframe) ──┐
Your team ──────────────────────────────────────────▶ Netlify (dashboard) ───────────┤ HTTPS + WebSocket
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
   - `DASHBOARD_URL`: your Netlify address (you can come back and set it after step 3)
   - `PUBLIC_API_URL`: this service's own address, e.g. `https://help-desk-api.onrender.com`
   - `JWT_SECRET` is generated for you.
3. Deploy, then open `https://<your-service>.onrender.com/health`. It should say the server is up.

**Railway** instead: New project › Deploy from GitHub › root directory `server`, build
`npm ci --include=dev && npm run build`, start `npm start`, and add the same variables (see `server/.env.example`),
with `NODE_ENV=production` and a `JWT_SECRET` from `openssl rand -hex 32`.

If something is missing, the server stops at start-up and its log says exactly which setting to fix.

## 3. Dashboard: Netlify

1. Netlify › **Add new site › Import from Git** › this repo. `netlify.toml` sets the folder, build and publish
   directory for you.
2. **Site configuration › Environment variables** › add `VITE_API_URL` = your server's address
   (e.g. `https://help-desk-api.onrender.com`, no trailing slash).
3. **Deploys › Trigger deploy** (the address is built into the files, so redeploy after changing it).
4. Put the Netlify address in the server's `DASHBOARD_URL` (step 2) if you haven't, and redeploy the server.

## 4. Create your company's workspace

Open `https://<your-site>.netlify.app/agent/signup`, enter the company name, your name, email and a password.
You get a new, empty workspace with its own **Messenger App ID**, and you're its admin.

- **Invite teammates**: Settings › Teammates.
- **Add the Messenger to your website**: Settings › Messenger Live Chat › Install. The snippet points at your
  Netlify site and carries your App ID.
- **Email, AI, knowledge base**: Settings › Email (SMTP/IMAP), Settings › AI assistant (API key),
  Knowledge base in the left menu.

Every company that signs up gets its own workspace; they never see each other's conversations, contacts or
settings. To run it for one company only, set `ALLOW_SIGNUP=false` on the server after creating yours.

## Moving existing conversations

A new workspace starts empty. Your local test data (`server/.data/`) is **not** uploaded anywhere.
To bring conversations over from another tool (e.g. Intercom), export them there as CSV and use
**Settings › Imports & exports**. Knowledge-base articles and macros have their own **Import** buttons.

## Good to know

- **File uploads** (attachments, avatars) are stored on the server's disk. On Render/Railway free plans that disk
  is wiped on each deploy; add a persistent disk (Render: Disks, mount at `/opt/render/project/src/server/uploads`)
  if attachments must survive.
- **Free plans sleep** when idle (Render free: after ~15 minutes); the first request then takes ~30 seconds and
  live chat reconnects. Use a paid instance for a real support team.
- **Custom domains**: add yours in Netlify, then list both addresses in the server's `CORS_ORIGINS`
  (comma-separated) and update `VITE_API_URL` if the server moves.
- **Local development is unchanged**: `npm run dev` in `server/` and `client/agent-dashboard/` still uses
  `localhost` and the JSON files, and pre-fills the local test login.
