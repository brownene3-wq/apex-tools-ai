# Apex Tools AI — Backend Deployment Guide

You now have a **full-stack application** with:
- Public marketing site (already live at apextoolsai.com)
- **Client portal** at `/dashboard/` — login, overview, calls, configure AI, calendar, billing, reports, support
- **Admin panel** at `/admin/` — overview, subscribers, blog CMS, team, messages, email inbox, bug reports, usage analytics
- **REST API** at `/api/*` — auth, dashboard, calls, config, billing, support, admin endpoints
- **D1 database** with 11 tables for clients, sessions, calls, appointments, blog, team, etc.
- **Magic-link authentication** (no passwords)

This guide gets it all live on Cloudflare in **about 15 minutes**.

---

## Step 1 — Create the D1 Database (3 min)

In Cloudflare Dashboard:

1. Go to **Workers & Pages → D1** (left sidebar)
2. Click **Create database**
3. Name: `apextoolsai-db`
4. Location: **Eastern North America** (closest to your South Florida market)
5. Click **Create**

Once created, open the database → **Console** tab → paste the entire contents of `schema.sql` (in this repo's root) → click **Execute**. Wait ~5 seconds for "Success: 11 tables created."

---

## Step 2 — Bind the Database to Your Pages Project (1 min)

1. In Cloudflare → **Workers & Pages** → click on `apex-tools-ai`
2. Click **Settings** tab → **Bindings** (or "Functions" → "D1 database bindings")
3. Click **Add binding** → **D1 database**
4. **Variable name:** `DB` (this exact name — it's referenced as `env.DB` in code)
5. **D1 database:** select `apextoolsai-db`
6. Click **Save**

---

## Step 3 — Add Environment Variables (3 min)

Same Settings page → **Environment variables** → **Add variable** for each:

| Variable | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | (sign up at resend.com, get a key) | For sending magic-link emails. Free tier = 3,000 emails/mo. |
| `STRIPE_SECRET_KEY` | (your Stripe Secret Key, starts with `sk_live_...`) | For Customer Portal sessions. Get from Stripe → Developers → API keys |
| `ADMIN_EMAIL` | `albertdbrown85@gmail.com` | Where new ticket notifications go |
| `VAPI_ORG_TOKEN` | (your Vapi org token) | For pushing config updates to assistants |

Click **Save**, then **Save and Deploy** at the top of the page to trigger a fresh deployment.

---

## Step 4 — Promote Yourself to Admin (2 min)

The first user to sign in via magic link gets a regular client account. To make YOU the admin:

1. Go to `https://apextoolsai.com/login.html`
2. Enter `brownene3@gmail.com` (or your preferred admin email)
3. Click the magic link in your email
4. You'll land on `/dashboard/` — that's expected for first sign-in
5. Open Cloudflare Dashboard → **D1** → `apextoolsai-db` → **Console**
6. Run this SQL:
   ```sql
   UPDATE clients SET is_admin = 1, full_name = 'Albert Brown' WHERE email = 'brownene3@gmail.com';
   ```
7. Sign out, sign back in. You'll now land on `/admin/` instead.

---

## Step 5 — Verify (5 min)

Test these flows end-to-end:

**Login:**
- ✅ `/login.html` → enter your email → email arrives → click link → land on `/dashboard/` (or `/admin/` if you're admin)

**Client portal:**
- ✅ Overview shows stats (will be all zeros until you have real call data)
- ✅ Configure AI page lets you edit business info, services, hours, FAQs
- ✅ Save changes → toast "Configuration saved"
- ✅ Sign out works

**Admin panel:**
- ✅ Overview shows total clients (you), recent signups
- ✅ Subscribers section shows your account
- ✅ Blog CMS: create a draft post, edit, publish
- ✅ Bug Reports: submit one yourself from any client account, see it in admin
- ✅ Usage Analytics: shows your login count

---

## Step 6 — Connect Vapi Webhooks for Real Call Data (optional, do later)

Right now `call_logs` and `appointments` tables are empty because Vapi doesn't know to push data to your database. To wire that up:

1. In Vapi Dashboard → your assistant → **Server URL**
2. Set Server URL to: `https://apextoolsai.com/api/webhooks/vapi`
3. We'll add `functions/api/webhooks/vapi.js` in the next iteration to handle:
   - `end-of-call-report` events → INSERT into `call_logs`
   - Function calls (like `bookAppointment`) → INSERT into `appointments`

For now, you can manually populate test data via D1 Console:
```sql
INSERT INTO call_logs (id, client_id, caller_number, duration_seconds, language, was_appointment_booked, call_started_at, created_at)
VALUES ('cl_test1', 'YOUR_CLIENT_ID', '+19541234567', 95, 'en', 1, ?, ?);
```
(Replace `YOUR_CLIENT_ID` with your `clients.id` from the database; replace `?` with `unixepoch() * 1000`.)

---

## Step 7 — Onboard Your First Real Client

When you close your first paying client:

1. Take their setup payment via Stripe (use links from `PAYMENT-LINKS.md`)
2. Go to D1 Console and run:
   ```sql
   UPDATE clients SET
     business_name = 'Hollywood Smile Dental',
     plan = 'phone',
     status = 'active',
     stripe_customer_id = 'cus_XXX',
     vapi_assistant_id = 'XXX',
     twilio_phone_number = '+19541234567',
     is_founding_client = 1
   WHERE email = 'their-email@practice.com';
   ```
3. Send them their login link: `https://apextoolsai.com/login.html`
4. They sign in and configure their own AI from the dashboard

---

## Architecture Cheat Sheet

```
Frontend (static HTML + Tailwind CDN + vanilla JS)
  /                       → Marketing site (English)
  /es/                    → Marketing site (Spanish)
  /login.html             → Magic-link login
  /dashboard/             → Client portal SPA
  /admin/                 → Admin panel SPA

Backend (Cloudflare Pages Functions)
  /api/auth/request-link  → POST, creates magic link, sends email
  /api/auth/verify        → GET ?token=, verifies + sets session cookie
  /api/auth/me            → GET, current user
  /api/auth/logout        → POST, clears session

  /api/dashboard          → GET, client overview metrics
  /api/calls              → GET, paginated call history
  /api/calls/:id          → GET, single call details
  /api/config             → GET / PATCH, AI configuration
  /api/appointments       → GET, upcoming appointments
  /api/billing/portal     → POST, returns Stripe portal URL
  /api/support            → GET / POST, support tickets

  /api/admin/dashboard    → GET, admin overview
  /api/admin/subscribers  → GET, all clients + growth
  /api/admin/blog         → GET / POST / PATCH / DELETE, blog CRUD
  /api/admin/team         → GET / POST, team management
  /api/admin/messages     → GET / POST / PATCH, contact messages + replies
  /api/admin/bugs         → GET / POST / PATCH / DELETE, bug reports
  /api/admin/usage        → GET, usage analytics + CSV export
  /api/admin/email        → GET, Gmail inbox stub

Database (D1)
  clients, magic_links, sessions, call_logs, appointments,
  support_tickets, blog_posts, team_members, team_invitations,
  contact_messages, bug_reports, usage_events, gmail_config

Auth: Session cookie `apex_session` (HttpOnly, Secure, SameSite=Lax, 30-day)
XSS: All user input rendered through escapeHtml() helpers
```

---

## What's Skeletoned (To Polish Later)

These are functional but minimal — Phase 2 work:

- **Vapi webhook handler** — call_logs auto-populate from Vapi events
- **Reports section** — auto-generate monthly PDF reports
- **Email inbox** — Gmail OAuth flow
- **Multi-team-member permissions** — UI is there, fine-grained role enforcement is light
- **Vapi config sync** — when client edits FAQs, push to their Vapi assistant via API (TODO marker is in `functions/api/config.js`)

These are 3-6 hours of work in the next session, after you've onboarded 1-2 real clients and seen what's most needed.

---

## Troubleshooting

**"Not authenticated" loop:** Browser blocking 3rd-party cookies. The Pages site and API are same-origin, so this shouldn't happen — but check the cookie is set by inspecting `Application → Cookies` in DevTools after login.

**Magic link email never arrives:** Without `RESEND_API_KEY` set, links log to Cloudflare Pages logs instead of being emailed. Check Pages → Functions → Real-time logs.

**Database not bound:** Errors like "env.DB is undefined" mean Step 2 wasn't completed. Re-check the binding name is exactly `DB`.

**Stripe portal doesn't open:** Ensure the client's `stripe_customer_id` is populated in the database. Stripe portal requires a real customer ID.
