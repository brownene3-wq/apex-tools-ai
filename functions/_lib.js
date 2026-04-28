// Shared helpers for all API functions

export const json = (data, status = 200, extraHeaders = {}) => new Response(
  JSON.stringify(data),
  {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  }
);

export const error = (message, status = 400) => json({ error: message }, status);

export const requireAuth = (context) => {
  if (!context.data.user) return error('Not authenticated', 401);
  return null;
};

export const requireAdmin = (context) => {
  const authErr = requireAuth(context);
  if (authErr) return authErr;
  if (!context.data.user.is_admin) return error('Admin access required', 403);
  return null;
};

export const newId = (prefix = '') => {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex}` : hex;
};

export const escapeHtml = (str) => {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

export const setSessionCookie = (sessionId, maxAgeSeconds = 60 * 60 * 24 * 30) => {
  return `apex_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
};

export const clearSessionCookie = () => 'apex_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export const sendEmail = async (env, { to, subject, html, from = 'Apex Tools AI <hello@apextoolsai.com>' }) => {
  if (!env.RESEND_API_KEY) {
    console.log('[email] (no RESEND_API_KEY)', { to, subject });
    return { ok: true, dev: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return await r.json();
};

// PBKDF2 password hashing
const PBKDF2_ITERATIONS = 100000;
const bytesToHex = (b) => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = (h) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i*2, 2), 16); return o; };

export const hashPassword = async (password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, km, 256);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(bits)}`;
};

export const verifyPassword = async (password, stored) => {
  if (!stored || !stored.startsWith('pbkdf2$')) return false;
  const [, iterStr, saltHex, hashHex] = stored.split('$');
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: parseInt(iterStr), hash: 'SHA-256' }, km, 256);
  return bytesToHex(bits) === hashHex;
};

export const logUsage = async (env, clientId, eventType, eventData = null) => {
  try {
    await env.DB.prepare('INSERT INTO usage_events (client_id, event_type, event_data_json, created_at) VALUES (?, ?, ?, ?)')
      .bind(clientId, eventType, eventData ? JSON.stringify(eventData) : null, Date.now()).run();
  } catch (e) {
    console.error('[logUsage]', e);
  }
};
