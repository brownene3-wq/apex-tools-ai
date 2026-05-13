// GET  /api/admin/website-chats          — list all website chatbot conversations
// GET  /api/admin/website-chats?id=XXX   — fetch one conversation + its full message thread
// PATCH /api/admin/website-chats         — update status / notes for a chat
import { json, requireAdmin } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const { env, request } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (id) {
    const chat = await env.DB.prepare('SELECT * FROM website_chats WHERE id = ?').bind(id).first();
    if (!chat) return json({ error: 'not found' }, 404);
    const msgs = await env.DB.prepare(
      'SELECT id, role, content, created_at FROM website_chat_messages WHERE chat_id = ? ORDER BY created_at ASC'
    ).bind(id).all();
    return json({ chat, messages: msgs.results || [] });
  }

  // List view — with filters
  const status = url.searchParams.get('status'); // 'active' | 'converted' | 'closed' | 'all'
  const language = url.searchParams.get('language'); // 'en' | 'es' | null
  const q = url.searchParams.get('q'); // free-text search in lead fields

  let sql = `SELECT id, session_id, started_at, last_activity_at, language,
             lead_name, lead_email, lead_phone, lead_practice, lead_interest,
             message_count, status, visitor_country, page_url, referrer,
             converted_at, closed_at
             FROM website_chats WHERE 1=1`;
  const binds = [];
  if (status && status !== 'all') { sql += ' AND status = ?'; binds.push(status); }
  if (language) { sql += ' AND language = ?'; binds.push(language); }
  if (q) {
    sql += ` AND (lead_name LIKE ? OR lead_email LIKE ? OR lead_phone LIKE ? OR lead_practice LIKE ?)`;
    const term = '%' + q + '%';
    binds.push(term, term, term, term);
  }
  sql += ' ORDER BY last_activity_at DESC LIMIT 300';

  const rows = await env.DB.prepare(sql).bind(...binds).all();

  // Metrics
  const [total, captured, today, week] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) c FROM website_chats').first(),
    env.DB.prepare('SELECT COUNT(*) c FROM website_chats WHERE lead_email IS NOT NULL OR lead_phone IS NOT NULL').first(),
    env.DB.prepare('SELECT COUNT(*) c FROM website_chats WHERE started_at >= ?')
      .bind(new Date().setHours(0,0,0,0)).first(),
    env.DB.prepare('SELECT COUNT(*) c FROM website_chats WHERE started_at >= ?')
      .bind(Date.now() - 7*24*60*60*1000).first(),
  ]);

  return json({
    chats: rows.results || [],
    metrics: {
      total: total?.c || 0,
      captured: captured?.c || 0,
      today: today?.c || 0,
      week: week?.c || 0,
    },
  });
}

export async function onRequestPatch(context) {
  const err = requireAdmin(context); if (err) return err;
  const { env, request } = context;
  const body = await request.json().catch(() => ({}));
  const { id, status, notes } = body;
  if (!id) return json({ error: 'id required' }, 400);

  const updates = [];
  const values = [];
  if (status && ['active','converted','closed','spam'].includes(status)) {
    updates.push('status = ?'); values.push(status);
    if (status === 'closed') { updates.push('closed_at = ?'); values.push(Date.now()); }
    if (status === 'converted') { updates.push('converted_at = COALESCE(converted_at, ?)'); values.push(Date.now()); }
  }
  if (typeof notes === 'string') { updates.push('notes = ?'); values.push(notes.slice(0, 2000)); }
  if (!updates.length) return json({ error: 'no valid fields' }, 400);
  values.push(id);

  await env.DB.prepare(`UPDATE website_chats SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return json({ ok: true });
}
