-- Apex Tools AI — D1 Database Schema
-- Run via: wrangler d1 execute apextoolsai-db --file=./schema.sql

-- Clients (the practices buying our service)
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  business_name TEXT,
  business_address TEXT,
  phone TEXT,
  practice_type TEXT, -- dental, med_spa, chiropractor, law, etc.
  language_pref TEXT DEFAULT 'en', -- en, es, both

  -- Plan/subscription
  plan TEXT DEFAULT 'phone', -- phone, bundle, chatbot
  is_founding_client INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', -- pending, active, paused, cancelled

  -- Stripe
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,

  -- Vapi/Twilio integration
  vapi_assistant_id TEXT,
  twilio_phone_number TEXT,
  cal_event_url TEXT,
  last_synced_prompt_version INTEGER DEFAULT 0,

  -- Practice info (used by the AI)
  hours_json TEXT, -- JSON: {monday: "9-5", ...}
  services_json TEXT, -- JSON array
  insurance_json TEXT, -- JSON array
  faqs_json TEXT, -- JSON array of {q, a}
  voice_id TEXT,
  greeting TEXT,
  escalation_phone TEXT, -- where urgent calls forward

  -- Metadata
  is_admin INTEGER DEFAULT 0, -- 1 = Albert / team
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_clients_status ON clients(status);

-- Magic link tokens (passwordless login)
CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_magic_links_email ON magic_links(email);

-- Sessions (server-side, opaque token in cookie)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
CREATE INDEX idx_sessions_client ON sessions(client_id);

-- Call logs (synced from Vapi webhooks + manual queries)
CREATE TABLE IF NOT EXISTS call_logs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  vapi_call_id TEXT UNIQUE,
  caller_number TEXT,
  duration_seconds INTEGER,
  language TEXT, -- en, es
  ended_reason TEXT, -- completed, hangup, voicemail, etc.
  transcript TEXT,
  recording_url TEXT,
  was_appointment_booked INTEGER DEFAULT 0,
  was_urgent INTEGER DEFAULT 0,
  cost_cents INTEGER, -- Vapi cost in cents
  call_started_at INTEGER NOT NULL,
  call_ended_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
CREATE INDEX idx_calls_client ON call_logs(client_id);
CREATE INDEX idx_calls_started ON call_logs(call_started_at DESC);

-- Appointments booked by AI
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  call_log_id TEXT,
  patient_name TEXT NOT NULL,
  patient_phone TEXT,
  patient_email TEXT,
  service TEXT,
  appointment_at INTEGER NOT NULL,
  status TEXT DEFAULT 'booked', -- booked, confirmed, cancelled, completed, no-show
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (call_log_id) REFERENCES call_logs(id)
);
CREATE INDEX idx_appointments_client ON appointments(client_id);
CREATE INDEX idx_appointments_at ON appointments(appointment_at);

-- Support tickets (clients submit, Albert/team responds)
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'open', -- open, in_progress, resolved, closed
  priority TEXT DEFAULT 'normal', -- low, normal, high, urgent
  category TEXT, -- bug, feature, billing, question
  reply_body TEXT,
  replied_at INTEGER,
  replied_by TEXT, -- email of admin who replied
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
CREATE INDEX idx_tickets_client ON support_tickets(client_id);
CREATE INDEX idx_tickets_status ON support_tickets(status);

-- ===========================================================================
-- ADMIN PANEL TABLES (per admin-panel-blueprint)
-- ===========================================================================

-- Blog posts (Albert's blog CMS)
CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  excerpt TEXT,
  content TEXT,
  cover_image_url TEXT,
  author_name TEXT,
  tag TEXT, -- AI Receptionists, Dental Marketing, Case Study, Tutorial, Other
  status TEXT DEFAULT 'draft', -- draft, published
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_blog_status ON blog_posts(status);
CREATE INDEX idx_blog_slug ON blog_posts(slug);

-- Team members (Albert + VAs + collaborators)
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer', -- admin, editor, viewer
  permissions_json TEXT, -- JSON array of permission keys
  status TEXT DEFAULT 'active', -- active, suspended
  last_login INTEGER,
  created_at INTEGER NOT NULL,
  invited_by TEXT
);

CREATE TABLE IF NOT EXISTS team_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions_json TEXT,
  invite_token TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  invited_by TEXT,
  created_at INTEGER NOT NULL
);

-- Contact form messages from website
CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_phone TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  source TEXT DEFAULT 'website', -- website, email, sales call
  is_read INTEGER DEFAULT 0,
  is_responded INTEGER DEFAULT 0,
  reply_body TEXT,
  replied_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Bug reports from clients (in-portal "Report a bug")
CREATE TABLE IF NOT EXISTS bug_reports (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  reporter_email TEXT,
  category TEXT DEFAULT 'bug', -- bug, feature, ui, performance, other
  description TEXT NOT NULL,
  page_url TEXT,
  status TEXT DEFAULT 'open', -- open, resolved
  is_unread INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX idx_bugs_status ON bug_reports(status);

-- Usage analytics events (per-client feature usage)
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- login, call_received, appointment_booked, config_changed, faq_added, etc.
  event_data_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
CREATE INDEX idx_usage_client ON usage_events(client_id);
CREATE INDEX idx_usage_type ON usage_events(event_type);
CREATE INDEX idx_usage_created ON usage_events(created_at DESC);

-- Email inbox (Gmail OAuth pull) — config table
CREATE TABLE IF NOT EXISTS gmail_config (
  id INTEGER PRIMARY KEY,
  user_email TEXT UNIQUE NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  is_connected INTEGER DEFAULT 0,
  last_synced INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Per-client integration connections (Google Calendar, NexHealth, Calendly, etc.)
CREATE TABLE IF NOT EXISTS client_integrations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT DEFAULT 'connected', -- connected, error, disconnected
  credentials_json TEXT, -- encrypted-at-rest by Cloudflare; tokens, API keys, etc.
  config_json TEXT,      -- non-sensitive provider config (calendar_id, location_id, scheduling_url, etc.)
  last_pushed_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(client_id, provider),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
CREATE INDEX IF NOT EXISTS idx_client_integrations_client ON client_integrations(client_id);
CREATE INDEX IF NOT EXISTS idx_client_integrations_provider ON client_integrations(provider);
