// POST /api/integrations/calendly/connect
import { json, error, requireAuth } from '../../../_lib.js';
import { verifyConnection, listEventTypes } from '../../../_integrations/calendly.js';
import { saveIntegration } from '../../../_integrations.js';

export async function onRequestPost(context) {
  const authErr = requireAuth(context);
  if (authErr) return authErr;
  const body = await context.request.json().catch(() => ({}));
  const { pat, scheduling_url, event_type_uri } = body;
  if (!pat) return error('Calendly Personal Access Token (pat) is required');
  let user;
  try { user = await verifyConnection({ pat }); }
  catch (e) { return error('Calendly verification failed: ' + e.message, 400); }
  const userUri = user?.resource?.uri;
  const defaultSchedulingUrl = user?.resource?.scheduling_url;
  if (!scheduling_url) {
    try {
      const types = await listEventTypes({ pat, user_uri: userUri });
      return json({ ok: true, needs_selection: true, user: { name: user?.resource?.name, email: user?.resource?.email, scheduling_url: defaultSchedulingUrl }, event_types: types });
    } catch (e) { return error('Calendly listing failed: ' + e.message, 400); }
  }
  await saveIntegration(context.env, context.data.user.id, 'calendly',
    { pat, user_uri: userUri, scheduling_url: scheduling_url || defaultSchedulingUrl },
    { scheduling_url: scheduling_url || defaultSchedulingUrl, event_type_uri: event_type_uri || null }
  );
  return json({ ok: true, status: 'connected' });
}
