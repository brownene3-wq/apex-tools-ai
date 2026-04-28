// GET /api/support — list my tickets
// POST /api/support — create new ticket
import { json, requireAuth, error, newId, sendEmail, logUsage } from '../_lib.js';

export async function onRequestGet(context) {
  const err = requireAuth(context); if (err) return err;
  const { env } = context;
  const rows = await env.DB.prepare(
    'SELECT id, subject, status, priority, category, created_at, replied_at FROM support_tickets WHERE client_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(context.data.user.id).all();
  return json({ tickets: rows.results || [] });
}

export async function onRequestPost(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, request } = context;
  const body = await request.json().catch(() => ({}));
  const subject = (body.subject || '').trim();
  const ticketBody = (body.body || '').trim();
  const category = body.category || 'question';
  const priority = body.priority || 'normal';

  if (!subject || !ticketBody) return error('Subject and body required');

  const id = newId('tkt');
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO support_tickets (id, client_id, subject, body, status, priority, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, context.data.user.id, subject, ticketBody, 'open', priority, category, now, now).run();

  await logUsage(env, context.data.user.id, 'support_ticket_created', { id, subject });

  // Notify Albert
  await sendEmail(env, {
    to: env.ADMIN_EMAIL || 'albertdbrown85@gmail.com',
    subject: `[Apex Tools AI] New ${priority} support ticket: ${subject}`,
    html: `
      <p><strong>From:</strong> ${context.data.user.email} (${context.data.user.business_name || 'no business name'})</p>
      <p><strong>Category:</strong> ${category} · <strong>Priority:</strong> ${priority}</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <hr><p>${ticketBody.replace(/\n/g, '<br>')}</p>
    `,
  });

  return json({ ok: true, id });
}
