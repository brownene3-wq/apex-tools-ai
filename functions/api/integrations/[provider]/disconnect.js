// POST /api/integrations/{provider}/disconnect
import { json, error, requireAuth } from '../../../_lib.js';
import { disconnectIntegration, PROVIDER_LIST } from '../../../_integrations.js';

export async function onRequestPost(context) {
  const authErr = requireAuth(context);
  if (authErr) return authErr;
  const provider = context.params.provider;
  if (!PROVIDER_LIST.includes(provider)) return error('Unknown provider', 400);
  await disconnectIntegration(context.env, context.data.user.id, provider);
  return json({ ok: true, disconnected: provider });
}
