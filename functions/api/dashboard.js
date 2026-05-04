// GET /api/dashboard — overview metrics for the logged-in client
import { json, requireAuth } from '../_lib.js';

export async function onRequestGet(context) {
  const err = requireAuth(context); if (err) return err;
  const { env } = context;
  const clientId = context.data.user.id;

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const todayStart = new Date().setHours(0, 0, 0, 0);

  const [callsToday, callsWeek, callsMonth, totalCalls, apptsBooked, urgentWeek, pendingCallbacks, recentCalls] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as c FROM call_logs WHERE client_id = ? AND call_started_at >= ?').bind(clientId, todayStart).first(),
    env.DB.prepare('SELECT COUNT(*) as c FROM call_logs WHERE client_id = ? AND call_started_at >= ?').bind(clientId, weekAgo).first(),
    env.DB.prepare('SELECT COUNT(*) as c FROM call_logs WHERE client_id = ? AND call_started_at >= ?').bind(clientId, monthAgo).first(),
    env.DB.prepare('SELECT COUNT(*) as c FROM call_logs WHERE client_id = ?').bind(clientId).first(),
    env.DB.prepare('SELECT COUNT(*) as c FROM appointments WHERE client_id = ? AND created_at >= ?').bind(clientId, monthAgo).first(),
    env.DB.prepare('SELECT COUNT(*) as c FROM call_logs WHERE client_id = ? AND was_urgent = 1 AND call_started_at >= ?').bind(clientId, weekAgo).first(),
    env.DB.prepare("SELECT COUNT(*) as c FROM callbacks WHERE client_id = ? AND status IN ('new','in_progress')").bind(clientId).first().catch(() => ({ c: 0 })),
    env.DB.prepare('SELECT id, caller_number, duration_seconds, language, was_appointment_booked, was_urgent, call_started_at FROM call_logs WHERE client_id = ? ORDER BY call_started_at DESC LIMIT 10').bind(clientId).all(),
  ]);

  // Daily breakdown for last 7 days (for chart)
  const dailyRows = await env.DB.prepare(
    `SELECT
       (call_started_at / 86400000 * 86400000) AS day,
       COUNT(*) AS calls,
       SUM(was_appointment_booked) AS booked
     FROM call_logs
     WHERE client_id = ? AND call_started_at >= ?
     GROUP BY day ORDER BY day ASC`
  ).bind(clientId, weekAgo).all();

  return json({
    metrics: {
      calls_today: callsToday?.c || 0,
      calls_week: callsWeek?.c || 0,
      calls_month: callsMonth?.c || 0,
      calls_total: totalCalls?.c || 0,
      appointments_month: apptsBooked?.c || 0,
      urgent_week: urgentWeek?.c || 0,
      pending_callbacks: pendingCallbacks?.c || 0,
    },
    daily: dailyRows.results || [],
    recent_calls: recentCalls.results || [],
  });
}
