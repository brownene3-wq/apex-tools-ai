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

// Generate cryptographically random ID/token
export const newId = (prefix = '') => {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${hex}` : hex;
};

// HTML escape for any text rendered into HTML — XSS prevention
export const escapeHtml = (str) => {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// Set session cookie helper
export const setSessionCookie = (sessionId, maxAgeSeconds = 60 * 60 * 24 * 30) => {
  return `apex_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
};

export const clearSessionCookie = () => 'apex_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

// Send email via Resend (or any SMTP relay you wire later)
// Set RESEND_API_KEY in env to enable. Falls back to logging.
export const sendEmail = async (env, { to, subject, html, from = 'Apex Tools AI <hello@apextoolsai.com>' }) => {
  if (!env.RESEND_API_KEY) {
    console.log('[email] (no RESEND_API_KEY set)', { to, subject, html: html.substring(0, 200) });
    return { ok: true, dev: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return await r.json();
};

// Password hashing using PBKDF2 (Web Crypto, available in Workers)
const PBKDF2_ITERATIONS = 100000;
const bytesToHex = (bytes) => Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => { const out = new Uint8Array(hex.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i*2, 2), 16); return out; };

export c