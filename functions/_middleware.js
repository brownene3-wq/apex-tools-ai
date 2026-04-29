// Cloudflare Pages global middleware — runs on every request
// Handles: CORS, security headers, session loading, schema migrations

let _migrationsRan = false;
const ensureSchemaUpToDate = async (env) => {
  if (_migrationsRan || !env?.DB) return;
  _migrationsRan = true;
  // Idempotent column adds — D1 throws if column already exists, ignore.
  const safeAdds = [
    "ALTER TABLE clients ADD COLUMN last_synced_prompt_version INTEGER DEFAULT 0",
  ];
  for (const stmt of safeAdds) {
    try { await env.DB.prepare(stmt).run(); } catch (e) { /* column exists or table missing — ignore */ }
  }
};

export async function onRequest(context) {
  await ensureSchemaUpToDate(context.env);
  const { request, next, env } = context;
  const url = new URL(request.url);

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
