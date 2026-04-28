// GET /api/admin/subscribers?range=30
import { json, requireAdmin } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const { env, request } = context;
  const u = new URL(request.url);
  const days = parseInt(u.searchParams.get('range') || '30');
  const since = Date.now() - days * 86400000;

  const total = await env.DB.prepare("SELECT COUNT(*) c FROM clients WHERE is_admin = 0").first();
  const byPlan = await env.DB.prepare("SELECT plan, COUNT(*) c FROM clients WHERE is_admin = 0 GROUP BY plan").all();

  const growth = await env.DB.prepare(
    "SELECT (created_at / 86400000 * 86400000) day, COUNT(*) c FROM clients WHERE is_admin = 0 AND created_at >= ? GROUP BY day ORDER BY day"
  ).bind(since).all();

  const list = await env.DB.prepare(
    "SELECT id, email, business_name, plan, status, is_founding_client, created_at, last_login FROM clients WHERE is_admin = 0 ORDER BY created_at DESC LIMIT 200"
  ).all();

  return json({
    total: total?.c || 0,
    by_plan: byPlan.results || [],
    growth: growth.results || [],
    subscribers: list.results || [],
  });
}
