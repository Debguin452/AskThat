# AskThat — Anonymous Q&A

> **Find out what they really think.**
> Create your link in 10 seconds. Share it anywhere. Receive brutally honest anonymous messages.

[![Live Site](https://img.shields.io/badge/Live%20Site-askthat.pages.dev-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://askthat.pages.dev/)
[![License](https://img.shields.io/badge/License-PolyForm%20Noncommercial-red?style=flat-square)](LICENSE)
[![Cloudflare Pages](https://img.shields.io/badge/Deployed%20on-Cloudflare%20Pages-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)

---

## What is AskThat?

AskThat is a privacy-first, **anonymous messaging platform**. You claim a username, share your personal link anywhere — WhatsApp Status, Instagram Stories, Snapchat, TikTok bio, X — and anyone who visits it can send you a completely anonymous message. No accounts required for senders. No tracking. No breadcrumbs.

---

## ✨ Features

### 🔒 True Anonymity
Senders leave no trace. No login, no email, no device fingerprint. "Anonymous" means actually anonymous — not "anonymous but we know it's you."

### ⚡ Zero Sign-Up
Claim your link by picking a username. No email verification, no password, no inbox check. Your link is live in under 10 seconds.

### 📊 Embedded Polls
Senders can optionally answer quick poll questions alongside their message — letting you gauge vibes, familiarity, and sentiment from your audience at a glance.

- **Vibe options:** Hilarious · Mysterious · Wholesome · Chaotic
- **Familiarity options:** Very well · Somewhat · Barely · Just lurking

Poll results are aggregated and visible only to the inbox owner.

### 🗂️ Smart Dashboard
Your personal dashboard gives you full control of your inbox:
- **Pin** important messages to the top
- **Mark as read / unread**
- **Delete** individual messages
- **Live poll analytics** — see how your audience sees you

### 🃏 Story Cards
Turn any message into a shareable visual card. One tap to export — optimised for WhatsApp Status and Instagram Stories.

### 🧹 Automatic Spam Filtering
Messages are filtered before they ever reach your inbox:
- **Profanity filter** — regex-based detection with bypass-evasion patterns
- **Link spam guard** — blocks messages with more than 2 URLs
- **Repetition detection** — catches keyboard-mashing (14+ repeated characters)
- **All-caps throttle** — flags messages that are >85% uppercase
- **Duplicate guard** — same message can't be sent twice within 5 minutes
- **Bot honeypot** — hidden form field silently drops automated submissions

### 🔐 Rate Limiting & Security
Every API route is protected by a per-IP sliding-window rate limiter enforced at the edge:

| Endpoint      | Limit        |
|---------------|--------------|
| `/api/send`   | 8 req / min  |
| `/api/poll`   | 20 req / min |
| `/api/delete` | 30 req / min |
| `/api/pin`    | 40 req / min |
| `/api/get`    | 60 req / min |
| `/api/stats`  | 60 req / min |

Additional protections:
- CORS locked to `askthat.pages.dev`
- Known scraper/bot User-Agents blocked on write operations
- Request body size capped at 8 KB
- Full security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`)

### ⏳ Auto-Expiring Messages
Every message automatically expires after **7 days**. Inboxes stay clean with no manual housekeeping required.

---

## 🏗️ Architecture

AskThat runs entirely on the **Cloudflare** stack — no servers to manage.

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Pages |
| API / Backend | Cloudflare Pages Functions (Edge Workers) |
| Storage | Cloudflare KV |
| Frontend | Vanilla HTML + CSS + JS (single file dashboard) |

### API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/send` | Send an anonymous message to a username |
| `GET` | `/api/get` | Fetch messages for an authenticated owner |
| `GET/POST/PUT` | `/api/poll` | Get poll results / submit a vote / save poll config |
| `GET/POST` | `/api/auth` | Verify ownership token / claim a username |
| `DELETE` | `/api/delete` | Delete a specific message |
| `PATCH` | `/api/pin` | Pin / unpin a message |
| `GET` | `/api/stats` | Fetch view and receive stats |

All routes are fronted by `_middleware.js` which handles CORS, rate limiting, bot blocking, and security headers before any route logic runs.

---

## 🚀 Deployment

This project is designed for Cloudflare Pages with Functions.

**Prerequisites:**
- A [Cloudflare](https://cloudflare.com) account
- A KV namespace bound as `MESSAGES_KV`

**Steps:**

1. Clone or download this repository
2. Create a KV namespace in the Cloudflare dashboard
3. Connect the repo to Cloudflare Pages
4. Bind the KV namespace to the Pages project under **Settings → Functions → KV namespace bindings** with the variable name `MESSAGES_KV`
5. Deploy — Cloudflare handles the rest

**Local development:**
```bash
npx wrangler pages dev out/
```
Wrangler will simulate the KV namespace locally.

---

## 📁 Project Structure

```
out/
├── public/
│   ├── dashboard.html       # Full single-page dashboard UI
│   └── _redirects           # Cloudflare Pages redirect rules
└── functions/
    ├── _middleware.js        # Edge middleware: CORS, rate limiting, security headers
    └── api/
        ├── auth.js           # Token verification & username claiming
        ├── send.js           # Anonymous message submission
        └── poll.js           # Poll configuration, voting & results
```

---

## 🔑 Validation Rules

| Field | Rule |
|---|---|
| Username | 1–30 chars, `[a-zA-Z0-9_.-]` only |
| Message | 1–500 characters |
| Poll vibe | One of: Hilarious, Mysterious, Wholesome, Chaotic |
| Poll familiarity | One of: Very well, Somewhat, Barely, Just lurking |
| Poll questions | Max 3 questions, max 4 options each |

---

## ⚖️ License

This project is licensed under the **[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)**.

**In plain English:**

| ✅ Allowed | ❌ Not Allowed |
|---|---|
| View and study the code | Use it to run a competing service |
| Use it for personal projects | Sell or sublicense it |
| Use it for education or research | Any commercial use |
| Fork it for non-commercial use | Redistribute it as your own product |

See [LICENSE](./LICENSE) for the full legal terms.

---

## 🤝 Contributing

Bug reports and non-commercial improvements are welcome. Please open an issue before submitting a pull request. Note that all contributions fall under the same PolyForm Noncommercial license.

---

## 🌐 Live Site

[https://askthat.pages.dev](https://askthat.pages.dev/)

© 2025 AskThat · Built with Cloudflare Pages
