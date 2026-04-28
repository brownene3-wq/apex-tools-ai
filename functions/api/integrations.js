// GET /api/integrations
import { json, requireAuth } from '../_lib.js';
import { listForClient, PROVIDER_LIST } from '../_integrations.js';

export async function onRequestGet(context) {
  const authErr = requireAuth(context);
  if (authErr) return authErr;
  const clientId = context.data.user.id;
  const connected = await listForClient(context.env, clientId);
  const all = {};
  for (const p of PROVIDER_LIST) all[p] = connected[p] || { status: 'disconnected' };
  return json({ ok: true, integrations: all });
}
