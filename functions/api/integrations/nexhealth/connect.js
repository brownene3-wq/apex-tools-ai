// POST/GET /api/integrations/nexhealth/connect
import { json, error, requireAuth } from '../../../_lib.js';
import { verifyConnection, listResources } from '../../../_integrations/nexhealth.js';
import { saveIntegration } from '../../../_integrations.js';

export async function onRequestPost(context) {
  const authErr = requireAuth(context);
  if (authErr) return authErr;
  const body = await context.request.json().catch(() => ({}));
  const { api_key, subdomain, location_id, provider_id, operatory_id } = body;
  if (!api_key || !subdomain) return error('api_key and subdomain are required');
  try { await verifyConnection({ api_key, subdomain }); }
  catch (e) { return error('NexHealth verification failed: ' + e.message, 400); }
  if (!location_id || !provider_id) {
    const resources = await listResources({ api_key, subdomain });
    return json({ ok: true, needs_selection: true, resources });
  }
  await saveIntegration(context.env, context.data.user.id, 'nexhealth',
    { api_key, subdomain },
    { location_id, provider_id, operatory_id: operatory_id || null }
  );
  return json({ ok: true, status: 'connected' });
}

export async function onRequestGet(context) {
  const authErr = requireAuth(context);
  if (authErr) return authErr;
  const url = new URL(context.request.url);
  const api_key = url.searchParams.get('api_key');
  const subdomain = url.searchParams.get('subdomain');
  if (!api_key || !subdomain) return error('api_key and subdomain are required');
  try { return json({ ok: true, resources: await listResources({ api_key, subdomain }) }); }
  catch (e) { return error('NexHealth listing failed: ' + e.message, 400); }
}
