// GET /api/integrations/google/callback
import { exchangeCode, getUserEmail } from '../../../_integrations/google_calendar.js';
import { saveIntegration } from '../../../_integrations.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return new Response('Missing code or state', { status: 400 });
  const stateRow = await env.DB.prepare(
    'SELECT email, expires_at, used FROM magic_links WHERE token = ?'
  ).bind(state).first();
  if (!stateRow || stateRow.used || stateRow.expires_at < Date.now() || !stateRow.email?.startsWith('oauth:google:')) {
    return new Response('Invalid or expired state', { status: 400 });
  }
  const clientId = stateRow.email.replace('oauth:google:', '');
  await env.DB.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').bind(state).run();
  let tokens;
  try { tokens = await exchangeCode(env, code); }
  catch (e) { return new Response('Token exchange failed: ' + e.message, { status: 502 }); }
  const email = await getUserEmail(tokens.access_token);
  await saveIntegration(env, clientId, 'google_calendar', {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: Date.now() + (tokens.expires_in - 60) * 1000,
    email,
  }, { calendar_id: 'primary', email });
  return Response.redirect(`${env.PUBLIC_BASE_URL || 'https://apextoolsai.com'}/dashboard/#integrations?connected=google_calendar`, 302);
}
