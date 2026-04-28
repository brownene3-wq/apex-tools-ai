// POST /api/billing/portal — creates a Stripe Customer Portal session, returns URL
import { json, requireAuth, error } from '../../_lib.js';

export async function onRequestPost(context) {
  const err = requireAuth(context); if (err) return err;
  const { env, request } = context;

  const customer = await env.DB.prepare('SELECT stripe_customer_id FROM clients WHERE id = ?')
    .bind(context.data.user.id).first();
  if (!customer?.stripe_customer_id) return error('No Stripe customer on file. Contact support.', 400);

  const origin = new URL(request.url).origin;
  const params = new URLSearchParams({
    customer: customer.stripe_customer_id,
    return_url: `${origin}/dashboard/billing.html`,
  });

  const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await r.json();
  if (!r.ok) return error(data.error?.message || 'Stripe error', 500);
  return json({ url: data.url });
}
