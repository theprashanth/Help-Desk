# Deploying the help desk on your own server

Everything runs on one machine and one address (e.g. `https://help.yourco.com`):

| Piece | What it is | How it runs |
|---|---|---|
| **Dashboard + Messenger** | Static files built from `client/agent-dashboard` | Served by **nginx** |
| **Server** | Node.js API + live chat (Socket.IO), in `server/` | A **systemd** service on `127.0.0.1:3000`, behind nginx |
| **Database** | All workspaces, conversations, settings | **MongoDB** (Atlas, or your own MongoDB) |

```
Customer's website ──<script src="https://help.yourco.com/messenger.js">──┐
Your team (browser) ──────────────────────────────────────────────────────┤ HTTPS
                                                                          ▼
                     nginx ── /            → dashboard + Messenger files (/var/www/help-desk)
                           ── /api, /socket.io, /uploads, /health → Node on 127.0.0.1:3000 ──▶ MongoDB
```

Ready-made config is in [`deploy/`](deploy/): `nginx.conf.example`, `nginx-proxy.conf.example`,
`help-desk.service.example` (systemd) and `update.sh` (pull, build, publish, restart).

Locally the server keeps data in `server/.data/` JSON files; in production it refuses to start without MongoDB.

---

## 1. Database

**MongoDB Atlas:** create a cluster, add a database user (**Database Access**) that can only use the help desk's
database, and under **Network Access** allow only your server's public IP. Copy the connection string
(**Connect › Drivers**) and add the database name before the `?`:
`mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/help-desk?retryWrites=true&w=majority`

**Your own MongoDB:** use a user with access to that one database, and don't expose port 27017 to the internet.

Use a database just for the help desk (it has its own `users` collection for your support team).

## 2. Server (once)

Needs Node.js 20+, nginx, git and certbot. As root/sudo:

```bash
sudo useradd --system --home /opt/help-desk --shell /usr/sbin/nologin helpdesk
sudo mkdir -p /opt/help-desk /var/lib/help-desk/uploads /var/www/help-desk
sudo chown -R helpdesk: /opt/help-desk /var/lib/help-desk
sudo -u helpdesk git clone https://github.com/theprashanth/Help-Desk.git /opt/help-desk
```

**Settings:** create `/opt/help-desk/server/.env` (only the `helpdesk` user may read it):

```bash
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
MONGODB_URI=mongodb+srv://...            # from step 1
JWT_SECRET=...                            # openssl rand -hex 32  (never reuse your laptop's)
DASHBOARD_URL=https://help.yourco.com
PUBLIC_API_URL=https://help.yourco.com
UPLOAD_DIR=/var/lib/help-desk/uploads     # attachments live outside the code folder
ALLOW_SIGNUP=false                        # only your company uses it (after you've created your workspace)
```

```bash
sudo chown helpdesk: /opt/help-desk/server/.env && sudo chmod 600 /opt/help-desk/server/.env
```

See `server/.env.example` for the optional settings (email, GIFs, your user database).

**Dashboard address:** create `/opt/help-desk/client/agent-dashboard/.env.production` with
`VITE_API_URL=https://help.yourco.com` (it's built into the dashboard's files).

**Service and nginx:**

```bash
sudo cp /opt/help-desk/deploy/help-desk.service.example /etc/systemd/system/help-desk.service
sudo cp /opt/help-desk/deploy/nginx-proxy.conf.example /etc/nginx/help-desk-proxy.conf
sudo cp /opt/help-desk/deploy/nginx.conf.example /etc/nginx/sites-available/help-desk   # set server_name
sudo ln -s /etc/nginx/sites-available/help-desk /etc/nginx/sites-enabled/
sudo certbot --nginx -d help.yourco.com
sudo systemctl daemon-reload && sudo systemctl enable help-desk
```

**Firewall:** allow only SSH, 80 and 443 (e.g. `sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable`).
Port 3000 stays private because the server listens on `127.0.0.1`.

## 3. Deploy (first time and every update)

```bash
cd /opt/help-desk && ./deploy/update.sh
```

It pulls `main`, builds the server and the dashboard, copies the dashboard to `/var/www/help-desk`, restarts the
service and checks `/health`. If a setting is missing, the server stops at start-up and `journalctl -u help-desk`
says exactly which one.

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
  window.ChaiShotsSettings = { app_id: "YOUR_APP_ID", user_id: "<their id from your database>", user_hash: "<from your server>" };
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
- Without a user directory, pass `name`, `email` and `phone` in `ChaiShotsSettings` too; they're copied onto
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
- [ ] `server/.env` on the server has `NODE_ENV=production`, `HOST=127.0.0.1`, `MONGODB_URI`, `JWT_SECRET` (64 random
      hex characters from `openssl rand -hex 32`, never the one from your laptop), `DASHBOARD_URL`, `PUBLIC_API_URL`
      and `UPLOAD_DIR`, and only the `helpdesk` user can read it (`chmod 600`).
- [ ] `client/agent-dashboard/.env.production` has `VITE_API_URL=https://help.yourco.com`.
- [ ] HTTPS works (certbot), port 3000 isn't reachable from outside, and the firewall allows only SSH, 80 and 443.
- [ ] MongoDB only accepts connections from your server.
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
- [ ] `https://help.yourco.com/health` says `mongoConnected: true`.
- [ ] Sign up your workspace, invite teammates, send a test chat from your website, reply from the dashboard,
      attach a file, and open it from both sides.
- [ ] Back up the database (Atlas backups, or `mongodump` on a schedule) and `/var/lib/help-desk/uploads`.
- [ ] Two-step sign-in (2FA) is on for GitHub and MongoDB Atlas; SSH to the server uses keys, not passwords.

**Built-in protections** (no action needed): sign-in attempts are limited (10 per email / 40 per network every
15 minutes); visitors' messages and uploads are rate-limited; uploads must be images, documents, archives, audio
or video (no web pages or scripts) and are served so they can't run in the browser; the dashboard can't be
embedded in other sites (nginx config); the Testing panel is off; each company only ever sees its own data.

## Good to know

- **Attachments** (and profile pictures) are files in `UPLOAD_DIR`. Deploys never touch them; include the folder
  in your backups.
- **Logs:** `journalctl -u help-desk -f`. Passwords and connection strings are never written to the log.
- **More than one address:** list them all in the server's `CORS_ORIGINS` (comma-separated). If the address
  changes, update `DASHBOARD_URL`, `PUBLIC_API_URL` and `VITE_API_URL`, then run `./deploy/update.sh`.
- **One server process:** sign-in and visitor limits are kept in memory, per process. Running several copies
  behind a load balancer would need shared limits (and Socket.IO's Redis adapter).
- **Local development is unchanged**: `npm run dev` in `server/` and `client/agent-dashboard/` still uses
  `localhost` and the JSON files, and pre-fills the local test login.
