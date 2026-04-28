// GET /api/reports?month=2026-04 — monthly performance report for client
import { json, requireAuth } from '../_lib.js';

export async function onRequestGet(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, request } = context;
  const u = new URL(request.url);
  const monthParam = u.searchParams.get('month'); // YYYY-MM
  const clientId = context.data.user.id;

  let monthStart, monthEnd;
  if (monthParam) {
    const [y, m] = monthParam.split('-').map(Number);
    monthStart = new Date(y, m - 1, 1).getTime();
    monthEnd = new Date(y, m, 1).getTime();
  } else {
    const d = new Date();
    monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  }

  const [stats, langSplit, daily, hourly, peakDays, urgent, appts] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total, SUM(was_appointment_booked) booked, SUM(was_urgent) urgent, AVG(duration_seconds) avg_dur, SUM(duration_seconds) total_dur, SUM(cost_cents) cost FROM call_logs WHERE client_id = ? AND call_started_at >= ? AND call_started_at < ?`).bind(clientId, monthStart, monthEnd).first(),
    env.DB.prepare(`SELECT language, COUNT(*) c FROM call_logs WHERE client_id = ? AND call_started_at >= ? AND call_started_at < ? GROUP BY language`).bind(clientId, monthStart, monthEnd).all(),
    env.DB.prepare(`SELECT (call_started_at / 86400000 * 86400000) day, COUNT(*) calls, SUM(was_appointment_booked) booked FROM call_logs WHERE client_id = ? AND call_started_at >= ? AND call_started_at < ? GROUP BY day ORDER BY day`).bind(clientId, monthStart, monthEnd).all(),
    env.DB.prepare(`SELECT CAST(((call_started_at / 1000) % 86400) / 3600 AS INTEGER) hour, COUNT(*) c FROM call_logs WHERE client_id = ? AND call_started_at >= ? AND call_started_at < ? GROUP BY hour ORDER BY c DESC LIMIT 5`).bind(clientId, monthStart, monthEnd).all(),
    env.DB.prepare(`SELECT (call_started_at / 86400000 * 86400000) day, COUNT(*) c FROM call_logs WHERE client_id = ? AND call_started_at >= ? AND call_started_at < ? GROUP BY day ORDER BY c DESC LIMIT 3`).bind(clientId, monthStart, monthEnd).all(),
    env.DB.prepare(`SELECT id, caller_number, transcript, call_started_at FROM call_logs WHERE client_id = ? AND was_urgent = 1 AND call_started_at >= ? AND call_started_at < ? ORDER BY call_started_at DESC LIMIT 10`).bind(clientId, monthStart, monthEnd).all(),
    env.DB.prepare(`SELECT COUNT(*) c FROM appointments WHERE client_id = ? AND created_at >= ? AND created_at < ?`).bind(clientId, monthStart, monthEnd).first(),
  ]);

  return json({
    month: monthParam || new Date().toISOString().substring(0, 7),
    period: { start: monthStart, end: monthEnd },
    summary: {
      total_calls: stats?.total || 0,
      appointments_booked: appts?.c || 0,
      urgent_calls: stats?.urgent || 0,
      avg_duration_sec: Math.round(stats?.avg_dur || 0),
      total_duration_sec: stats?.total_dur || 0,
      cost_cents: stats?.cost || 0,
      booking_rate: stats?.total ? Math.round((stats.booked / stats.total) * 100) : 0,
    },
    language_split: langSplit.results || [],
    daily_breakdown: daily.results || [],
    peak_hours: hourly.results || [],
    busiest_days: peakDays.results || [],
    urgent_calls: urgent.results || [],
  });
}
