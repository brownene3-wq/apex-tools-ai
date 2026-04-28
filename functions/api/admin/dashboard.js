// GET /api/admin/dashboard — overview metrics for Albert
import { json, requireAdmin } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const { env } = context;
  const now = Date.now();
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

  const [users, newThisMonth, posts, callsTotal, callsMonth, apptsMonth, recent] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) c FROM clients WHERE is_admin = 0").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM clients WHERE is_admin = 0 AND created_at >= ?").bind(monthStart.getTime()).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM blog_posts WHERE status = 'published'").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM call_logs").first(),
    env.DB.prepare("SELECT COUNT(*) c FROM call_logs WHERE call_started_at >= ?").bind(monthAgo).first(),
    env.DB.prepare("SELECT COUNT(*) c FROM appointments WHERE created_at >= ?").bind(monthAgo).first(),
    env.DB.prepare("SELECT id, email, business_name, plan, status, is_founding_client, created_at FROM clients WHERE is_admin = 0 ORDER BY created_at DESC LIMIT 10").all(),
  ]);
  const planRows = await env.DB.prepare("SELECT plan, COUNT(*) c FROM clients WHERE is_admin = 0 GROUP BY plan").all();
  return json({
    metrics: {
      total_users: users?.c || 0,
      new_this_month: newThisMonth?.c || 0,
      published_posts: posts?.c || 0,
      total_calls: callsTotal?.c || 0,
      calls_this_month: callsMonth?.c || 0,
      appointments_this_month: apptsMonth?.c || 0,
    },
    plans: planRows.results || [],
    recent_signups: recent.results || [],
  });
}
