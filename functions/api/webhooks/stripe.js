// POST /api/webhooks/stripe — handles checkout.session.completed and subscription events
// Configure in Stripe: Developers → Webhooks → endpoint = https://apextoolsai.com/api/webhooks/stripe
// Set STRIPE_WEBHOOK_SECRET env var (whsec_...) for signature verification.
import { json, newId, sendEmail, logUsage } from '../../_lib.js';

const verifyStripeSignature = async (payload, sigHeader, secret) => {
  if (!sigHeader || !secret) return false;
  const parts = sigHeader.split(',').reduce((acc, p) => { const [k, v] = p.split('='); acc[k] = v; return acc; }, {});
  if (!parts.t || !parts.v1) return false;
  const signedPayload = `${parts.t}.${payload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === parts.v1;
};

const PLAN_MAP = {
  // Match these to your Stripe product price IDs once you have them; falling back to amount.
  2500: 'phone',     // Phone setup
  3000: 'bundle',    // Bundle setup
  1500: 'phone',     // Founding phone
  2000: 'bundle',    // Founding bundle
  1000: 'chatbot',   // Chatbot setup
  400: 'phone',      // Phone monthly
  450: 'bundle',     // Bundle monthly
  100: 'chatbot',    // Chatbot monthly
};

export async function onRequestPost({ request, env }) {
  const payload = await request.text();
  const sig = request.headers.get('stripe-signature') || '';

  if (env.STRIPE_WEBHOOK_SECRET) {
    const valid = await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) return new Response('Invalid signature', { status: 400 });
  }

  let event; try { event = JSON.parse(payload); } catch { return json({ ok: false }); }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const email = (s.customer_email || s.customer_details?.email || '').toLowerCase();
    const name = s.customer_details?.name || '';
    const businessName = s.custom_fields?.find(f => f.key === 'business_name')?.text?.value || '';
    const stripeCustomerId = s.customer;
    const amountTotal = Math.round((s.amount_total || 0) / 100);
    const isFounding = amountTotal === 1500 || amountTotal === 2000;
    const isSubscription = s.mode === 'subscription';
    const detectedPlan = PLAN_MAP[amountTotal] || 'phone';

    // Upsert client
    let client = await env.DB.prepare('SELECT id, password_hash FROM clients WHERE email = ?').bind(email).first();
    let isNew = false;
    if (!client) {
      const id = newId('cli');
      await env.DB.prepare(
        `INSERT INTO clients (id, email, full_name, business_name, stripe_customer_id, plan, status, is_founding_client, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, email, name, businessName, stripeCustomerId, detectedPlan, 'active', isFounding ? 1 : 0, s.customer_details?.phone || '', Date.now(), Date.now()).run();
      client = { id, password_hash: null };
      isNew = true;
    } else {
      const updates = ['stripe_customer_id = ?', 'status = ?', 'updated_at = ?'];
      const values = [stripeCustomerId, 'active', Date.now()];
      if (!isSubscription) { // setup payment — set plan
        updates.push('plan = ?', 'is_founding_client = ?');
        values.push(detectedPlan, isFounding ? 1 : 0);
      }
      if (isSubscription) {
        updates.push('stripe_subscription_id = ?');
        values.push(s.subscription);
      }
      values.push(client.id);
      await env.DB.prepare(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    }

    await logUsage(env, client.id, isSubscription ? 'subscription_started' : 'setup_paid', { amount: amountTotal });

    // Send welcome email if new (or if no password set)
    if (isNew || !client.password_hash) {
      const origin = new URL(request.url).origin;
      await sendEmail(env, {
        to: email,
        subject: '🎉 Welcome to Apex Tools AI — set up your dashboard',
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px;">
            <h2 style="color: #0a1628;">Welcome to Apex Tools AI${name ? ', ' + name.split(' ')[0] : ''}!</h2>
            <p style="color: #475569; line-height: 1.6;">Your payment of $${amountTotal} is confirmed${isFounding ? ' (Founding Client special — you\'ll be locked at this monthly rate forever)' : ''}.</p>
            <p style="color: #475569; line-height: 1.6;"><strong>Next step:</strong> create your dashboard password so you can configure your AI receptionist, see calls and appointments, and manage your account.</p>
            <a href="${origin}/login?signup=1&email=${encodeURIComponent(email)}" style="display:inline-block; background:#f97316; color:white; text-decoration:none; padding:14px 28px; border-radius:9999px; font-weight:600; margin:16px 0;">Create Your Account</a>
            <p style="color: #475569; line-height: 1.6;">After that, we'll schedule your 30-minute discovery session to gather your services, hours, FAQs, and calendar — your AI goes live within 5 business days.</p>
            <p style="color: #94a3b8; font-size:13px;">Questions? Reply to this email or text Albert directly.<br>—Apex Tools AI</p>
          </div>`,
      });
    }
    return json({ ok: true, client_id: client.id, is_new: isNew });
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await env.DB.prepare("UPDATE clients SET status = 'cancelled', updated_at = ? WHERE stripe_subscription_id = ?")
      .bind(Date.now(), sub.id).run();
  }

  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object;
    await env.DB.prepare("UPDATE clients SET status = 'past_due', updated_at = ? WHERE stripe_customer_id = ?")
      .bind(Date.now(), inv.customer).run();
  }

  return json({ ok: true });
}
