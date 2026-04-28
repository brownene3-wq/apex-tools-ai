// GET /api/admin/messages — list contact form messages
// PATCH /api/admin/messages?id=xxx — mark read/responded, send reply
// POST  /api/admin/messages — create new (used by website contact form)
import { json, requireAdmin, error, newId, sendEmail } from '../../_lib.js';

export async function onRequestGet(context) {
  const err = requireAdmin(context); if (err) return err;
  const rows = await context.env.DB.prepare("SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100").all();
  return json({ messages: rows.results || [] });
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  if (!body.sender_email || !body.body) return error('Email and body required');
  const id = newId('msg');
  await context.env.DB.prepare(
    "INSERT INTO contact_messages (id, sender_name, sender_email, sender_phone, subject, body, source, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(id, body.sender_name || '', body.sender_email, body.sender_phone || '', body.subject || '', body.body, body.source || 'website', Date.now()).run();
  return json({ ok: true });
}

export async function onRequestPatch(context) {
  const err = requireAdmin(context); if (err) return err;
  const u = new URL(context.request.url);
  const id = u.searchParams.get('id');
  if (!id) return error('Missing id');
  const body = await context.request.json().catch(() => ({}));

  if (body.action === 'mark_read') {
    await context.env.DB.prepare("UPDATE contact_messages SET is_read = 1 WHERE id = ?").bind(id).run();
  } else if (body.action === 'reply') {
    const msg = await context.env.DB.prepare("SELECT * FROM contact_messages WHERE id = ?").bind(id).first();
    if (!msg) return error('Message not found', 404);
    await sendEmail(context.env, {
      to: msg.sender_email,
      subject: `Re: ${msg.subject || 'Your message'}`,
      html: `<p>Hi ${msg.sender_name || 'there'},</p><p>${(body.reply || '').replace(/\n/g, '<br>')}</p><p>—Albert<br>Apex Tools AI</p>`,
    });
    await context.env.DB.prepare(
      "UPDATE contact_messages SET is_responded = 1, is_read = 1, reply_body = ?, replied_at = ? WHERE id = ?"
    ).bind(body.reply, Date.now(), id).run();
  }
  return json({ ok: true });
}
