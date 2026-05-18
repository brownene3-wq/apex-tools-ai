// Cloudflare Pages global middleware

// Run schema migrations once per worker. Idempotent CREATE IF NOT EXISTS.
let _callbacksMigrated = false;
async function ensureCallbacksTable(env) {
  if (_callbacksMigrated || !env?.DB) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS callbacks (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL, call_log_id TEXT,
        caller_name TEXT, caller_phone TEXT NOT NULL, reason TEXT,
        language TEXT DEFAULT 'en', preferred_time TEXT,
        status TEXT DEFAULT 'new', notes TEXT,
        created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_callbacks_client ON callbacks(client_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_callbacks_status ON callbacks(status)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_callbacks_created ON callbacks(created_at DESC)`),
    ]);
    // Add caller_number_origin column to appointments + callbacks (idempotent — ignores
    // "duplicate column" errors so existing deployments only add it once)
    for (const stmt of [
      `ALTER TABLE appointments ADD COLUMN caller_number_origin TEXT`,
      `ALTER TABLE callbacks ADD COLUMN caller_number_origin TEXT`,
    ]) {
      try { await env.DB.prepare(stmt).run(); } catch (e) {
        if (!/duplicate column/i.test(e?.message || '')) {
          console.error('callbacks migration ALTER:', e?.message);
        }
      }
    }
    _callbacksMigrated = true;
  } catch (e) { console.error('callbacks migration:', e?.message || e); }
}

// (kept old comment below)
// — runs on every request
// Handles: CORS, security headers, session loading, schema migrations

let _migrationsRan = false;
const ensureSchemaUpToDate = async (env) => {
  if (_migrationsRan || !env?.DB) return;
  _migrationsRan = true;
  // Idempotent column adds — D1 throws if column already exists, ignore.
  const safeAdds = [
    "ALTER TABLE clients ADD COLUMN last_synced_prompt_version INTEGER DEFAULT 0",
    `CREATE TABLE IF NOT EXISTS call_silence_state (
      call_id TEXT PRIMARY KEY,
      client_id TEXT,
      last_user_speech_at INTEGER,
      lang TEXT DEFAULT 'en',
      idle_count INTEGER DEFAULT 0,
      user_speaking INTEGER DEFAULT 0,
      hung_up INTEGER DEFAULT 0,
      control_url TEXT
    )`,
    "ALTER TABLE call_silence_state ADD COLUMN control_url TEXT",
    "ALTER TABLE call_silence_state ADD COLUMN check_in_progress INTEGER DEFAULT 0",
    `CREATE TABLE IF NOT EXISTS website_chats (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL,
      language TEXT DEFAULT 'en',
      lead_name TEXT,
      lead_email TEXT,
      lead_phone TEXT,
      lead_practice TEXT,
      lead_interest TEXT,
      message_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      visitor_ip TEXT,
      visitor_country TEXT,
      visitor_user_agent TEXT,
      referrer TEXT,
      page_url TEXT,
      notes TEXT,
      converted_at INTEGER,
      closed_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_website_chats_session ON website_chats(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_website_chats_started ON website_chats(started_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_website_chats_status ON website_chats(status)`,
    `CREATE INDEX IF NOT EXISTS idx_website_chats_lead_email ON website_chats(lead_email)`,
    `CREATE TABLE IF NOT EXISTS website_chat_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tokens INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON website_chat_messages(chat_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      scopes TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`,
    "ALTER TABLE blog_posts ADD COLUMN language TEXT DEFAULT 'en'",
    "ALTER TABLE blog_posts ADD COLUMN seo_title TEXT",
    "ALTER TABLE blog_posts ADD COLUMN seo_description TEXT",
    "ALTER TABLE blog_posts ADD COLUMN canonical_url TEXT",
    // 2026-05-18 — Wave 1 voice-call upgrade: insurance + SMS confirmation
    "ALTER TABLE appointments ADD COLUMN insurance_carrier TEXT",
    "ALTER TABLE appointments ADD COLUMN insurance_status TEXT",
    "ALTER TABLE appointments ADD COLUMN sms_confirmation_sid TEXT",
    "ALTER TABLE appointments ADD COLUMN sms_confirmation_at INTEGER",
  ];
  for (const stmt of safeAdds) {
    try { await env.DB.prepare(stmt).run(); } catch (e) { /* column exists or table missing — ignore */ }
  }
};

export async function onRequest(context) {
  await ensureSchemaUpToDate(context.env);
  const { request, next, env } = context;
  const url = new URL(request.url);
  await ensureCallbacksTable(env);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': new URL(request.url).origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Load session if cookie present (attach to context.data for downstream functions)
  const cookie = request.headers.get('Cookie') || '';
  const sessionMatch = cookie.match(/apex_session=([^;]+)/);
  if (sessionMatch && env.DB) {
    const sessionId = sessionMatch[1];
    try {
      const row = await env.DB.prepare(
        'SELECT s.*, c.email, c.full_name, c.business_name, c.is_admin, c.status, c.plan FROM sessions s JOIN clients c ON s.client_id = c.id WHERE s.id = ? AND s.expires_at > ?'
      ).bind(sessionId, Date.now()).first();
      if (row) {
        context.data.user = {
          id: row.client_id,
          email: row.email,
          full_name: row.full_name,
          business_name: row.business_name,
          is_admin: !!row.is_admin,
          status: row.status,
          plan: row.plan,
        };
      }
    } catch (e) {
      // Session lookup failed; continue without user
    }
  }

  // Pass to next handler (matched route)
  const response = await next();

  // Security headers on every response
  const headers = new Headers(response.headers);
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
