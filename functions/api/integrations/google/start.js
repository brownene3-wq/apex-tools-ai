// GET /api/integrations/google/start
import { error, requireAuth, newId } from '../../../_lib.js';
import { buildAuthUrl } from '../../../_integrations/google_calendar.js';

export async function onRequestGet(context) {
  const authErr = requireAuth(context);
  if (authErr) return authErr;
  if (!context.env.GOOGLE_CLIENT_ID) {
    return error('Google OAuth not configured. Admin must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.', 503);
  }
  const stateToken = newId('gst');
  const now = Date.now();
  await context.env.DB.prepare(
    'INSERT INTO magic_links (token, email, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)'
  ).bind(stateToken, `oauth:google:${context.data.user.id}`, now + 10 * 60000, now).run();
  const url = buildAuthUrl(context.env, stateToken);
  return Response.redirect(url, 302);
}
