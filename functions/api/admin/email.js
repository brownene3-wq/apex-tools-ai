// GET /api/admin/email — list emails (Gmail OAuth)
// Stub for now; OAuth wiring described in dashboard.
import { json, requireAdmin } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const cfg = await context.env.DB.prepare("SELECT user_email, is_connected, last_synced FROM gmail_config WHERE id = 1").first();
  if (!cfg?.is_connected) {
    return json({
      connected: false,
      setup_required: true,
      instructions: [
        'In Google Cloud Console, create OAuth 2.0 credentials with redirect: ' + new URL(context.request.url).origin + '/api/admin/email/callback',
        'Set env var GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare Pages settings',
        'Click Connect Gmail button below'
      ]
    });
  }
  // TODO: Pull recent emails via Gmail API using stored access_token (refresh if expired)
  return json({ connected: true, emails: [], note: 'Gmail sync stub — implement Gmail messages.list call here' });
}
