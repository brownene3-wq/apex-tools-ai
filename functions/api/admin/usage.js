// GET /api/admin/usage — per-user usage analytics
// GET /api/admin/usage?export=csv
import { json, requireAdmin } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const u = new URL(context.request.url);
  const want = u.searchParams.get('export');

  const week = Date.now() - 7 * 86400000;
  const month = Date.now() - 30 * 86400000;

  const [total, active7, active30] = await Promise.all([
    context.env.DB.prepare("SELECT COUNT(*) c FROM clients WHERE is_admin = 0").first(),
    context.env.DB.prepare("SELECT COUNT(DISTINCT client_id) c FROM usage_events WHERE created_at >= ?").bind(week).first(),
    context.env.DB.prepare("SELECT COUNT(DISTINCT client_id) c FROM usage_events WHERE created_at >= ?").bind(month).first(),
  ]);

  const rows = await context.env.DB.prepare(`
    SELECT
      c.id, c.email, c.business_name, c.plan, c.status, c.created_at, c.last_login, c.stripe_customer_id,
      (SELECT COUNT(*) FROM usage_events WHERE client_id = c.id AND event_type = 'login') AS login_count,
      (SELECT MAX(created_at) FROM usage_events WHERE client_id = c.id) AS last_activity,
      (SELECT COUNT(*) FROM call_logs WHERE client_id = c.id) AS calls_count,
      (SELECT COUNT(*) FROM appointments WHERE client_id = c.id) AS appts_count,
      (SELECT COUNT(*) FROM usage_events WHERE client_id = c.id AND event_type = 'config_changed') AS config_edits
    FROM clients c WHERE c.is_admin = 0 ORDER BY c.created_at DESC LIMIT 500
  `).all();

  const list = rows.results || [];

  if (want === 'csv') {
    const headers = ['email','business_name','plan','status','login_count','calls_count','appts_count','config_edits','last_login','last_activity','created_at'];
    const csv = [headers.join(',')].concat(list.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))).join('\n');
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="apex-usage-${Date.now()}.csv"` },
    });
  }

  return json({
    summary: { total: total?.c || 0, active_7: active7?.c || 0, active_30: active30?.c || 0 },
    users: list,
  });
}
