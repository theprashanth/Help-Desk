# Real-Time Customer Support Platform (Help Desk / Intercom Clone)

A modern, responsive customer support platform built for local development. It contains a floating **Customer Messenger Widget** embedded inside a mock SaaS website, an **Agent Dashboard** containing dynamic inbox queues, and a real-time **Node.js server** utilizing WebSockets and MongoDB.

To ensure immediate usability on *any* computer without external database requirements, the backend implements a **Resilient Repository Pattern** that automatically connects to local JSON files if a MongoDB connection fails.

---

## 🚀 Quick Start (Single-Command)

Run both the frontend and backend concurrently with one command from the project root:

1. **Install Dependencies:**
   ```bash
   npm run install:all
   ```

2. **Launch Application:**
   ```bash
   npm run dev
   ```

- **SaaS Customer Demo Portal (Messenger Widget):** [http://localhost:5173](http://localhost:5173)
- **Support Agent Dashboard Portal:** [http://localhost:5173/agent](http://localhost:5173/agent)
- **Backend API Server (Node + Express):** [http://localhost:3000](http://localhost:3000)

---

## 🔑 Test Credentials

Login to the support panel at `/agent` using these seeded details:
- **Email:** `admin@localhost`
- **Password:** `admin123`
- **Role:** Admin

---

## 📁 Repository Structure
```
Help Desk/
├── client/
│   └── agent-dashboard/         # Vite + React 19 + TypeScript + Tailwind
├── server/
│   ├── .data/                  # Resilient JSON flat-file fallback databases
│   ├── uploads/                # Local directory serving images/PDFs
│   └── src/                    # Node Express controllers, models, and repositories
├── shared/
│   └── src/                    # Shared TypeScript interfaces (Tickets, Messages)
├── docker/
│   └── docker-compose.yml      # Optional local MongoDB orchestration configuration
└── README.md                   # Core Platform documentation
```

---

## 🧬 Core Architecture & Data Models

### 1. Database Collections (Shared Schema Models)
Data models are maintained consistently between Mongoose collections and JSON flat files:

*   **Agents (Users):** Holds email, name, avatar, role (`admin` or `support_agent`), online status, and lastSeen date.
*   **Customers (Guest):** Persistent tracking identifier (saved in customer localStorage), device specs, first/last seen records, list of custom tags, and support agent inline notes.
*   **Conversations (Tickets):** Automated Ticket Number generator (e.g. `TICKET-1001`), assignedAgentId, status (`open`, `waiting`, `resolved`, `closed`, `archived`), priority (`low`, `medium`, `high`, `critical`), and category (`bug`, `payment`, etc.).
*   **Messages:** Refers to its ticket container, sender attributes, text content, array of uploaded attachment URLs (images or PDFs), read-receipt logs, and agent emoji reactions. Internal notes are flagged with `isInternalNote` (invisible to customer clients).

---

## 🔌 REST APIs & WebSocket Syncing

### 1. REST Endpoints Matrix

| Service | Verb | Endpoint | Authentication | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | `POST` | `/api/auth/login` | Public | Validates agent details and responds with JWT token. |
| | `GET` | `/api/auth/profile` | Bearer Token | Fetches current agent session metrics. |
| | `PUT` | `/api/auth/settings` | Bearer Token | Updates agent theme, sounds, and business hours. |
| **Tickets** | `GET` | `/api/tickets` | Bearer Token | Retrieves conversations matching filters (unread, tag, status). |
| | `POST` | `/api/tickets` | Public (Guest) | Generates support tickets from Customer Messenger widget. |
| | `PUT` | `/api/tickets/:id/assign`| Bearer Token | Binds conversation assignee and resets state. |
| **Messages**| `GET` | `/api/messages/:id` | Public | Pulls chat message timeline (excludes internal notes for guest).|
| | `POST` | `/api/messages` | Public | Appends a public message or internal note to conversation. |
| | `POST` | `/api/messages/upload`| Public | Uploads an image or PDF attachment. Returns file details. |
| | `PUT` | `/api/messages/seen/:id`| Public | Updates read receipts. Sets unread counts to zero. |
| **Testing** | `POST` | `/api/simulation/seed` | Public | Populates databases with 100 tickets, tags, and replies. |
| | `POST` | `/api/simulation/reset`| Public | Drops all collections and initializes the base admin profile. |

### 2. WebSocket Sync Triggers
Real-time messaging is handled by events pushed via Socket.IO:

*   `message:new` - Broadcaster forwards incoming messages to all room subscribers.
*   `message:typing` - Emits typing indicator states (`isTyping: true/false`).
*   `message:seen` - Updates tick read-receipt columns.
*   `conversation:new` - Notifies agents that a new user ticket has entered the queue.
*   `conversation:update` - Broadcasts status updates, tag modifications, or assignments.

---

## 🧪 Local Verification Workflow

1.  **Boot System:** Launch your services using `npm run dev`.
2.  **Access Dashboard:** Navigate to [http://localhost:5173/agent](http://localhost:5173/agent) and sign in.
3.  **Seed Data:** Click the **Testing Panel** tab from the admin navigation menu, then click **Seed 100 Conversations**. The terminal log output will detail the seeding steps.
4.  **Test Real-Time Chat:**
    *   Open [http://localhost:5173/](http://localhost:5173/) (Mock SaaS Site) in a separate tab or side-by-side browser window.
    *   Click the violet Messenger bubble in the bottom right corner.
    *   Click **Start a New Chat** and type a question (e.g., "Hello, I need help!").
    *   Go back to the Agent Dashboard and check the **Open Inbox** queue. Your conversation will appear instantly at the top of the list.
    *   Type a reply in the Agent Composer (or test saved replies by typing `/refund` or `/hello`). Note the typing indicators appear on the other screen in real time.
    *   Toggle **Internal Note** in the Agent Composer, type a note, and submit. The note will appear in the dashboard message thread with a yellow background, but will be completely hidden from the Customer Messenger widget.
