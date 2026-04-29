// POST /api/admin/sync-vapi  (admin only)
// Body: { client_id: "cli_xxx" }
// Re-pushes the latest buildSystemPrompt + tool schemas + voice/transcriber config
// to Vapi for the given client. Use after editing _vapi.js and deploying.
import { json, requireAdmin, error } from '../../_lib.js';
import { syncAssistant } from '../../_vapi.js';

export async function onRequestPost(context) {
  const err = requireAdmin(context);
  if (err) return err;

  const body = await context.request.json().catch(() => ({}));
  const targetId = body.client_id || context.data.user.id;

  const client = await context.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(targetId).first();
  if (!client) return error('Client not found', 404);
  if (!client.vapi_assistant_id) return error('Client has no Vapi assistant', 400);

  const result = await syncAssistant(context.env, client);
  return json({
    ok: !!result.ok,
    client_id: targetId,
    vapi_assistant_id: client.vapi_assistant_id,
    prompt_length: result.prompt_length,
    error: result.ok ? null : (result.error || result.data?.message),
  });
}
