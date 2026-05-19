// POST /api/create-checkout-session
// Body: { tier: "phone" | "bundle" | "chatbot", lang?: "en" | "es" }
//
// Creates a Stripe Checkout Session with the tier's setup + monthly prices
// and returns { url } for the frontend to redirect to.
//
// Requires env.STRIPE_SECRET_KEY (set in Cloudflare Pages env vars).

import { json } from '../_lib.js';

const TIERS = {
  phone: {
    setup_price: 'price_1TYvPPLldgJv5lq6mcqLwLGr',    // $995 one-time
    monthly_price: 'price_1TYvPzLldgJv5lq6IZdraqeC',  // $400/mo recurring
    name: 'Phone Receptionist',
  },
  bundle: {
    setup_price: 'price_1TYvTaLldgJv5lq618XHKQK9',    // $995 one-time
    monthly_price: 'price_1TYvUcLldgJv5lq6EHlJKn0V',  // $450/mo recurring
    name: 'Phone + Chat Bundle',
  },
  chatbot: {
    setup_price: 'price_1TYvXULldgJv5lq6u20AujjT',    // $299 one-time
    monthly_price: 'price_1TYvXULldgJv5lq6URjPGT5d',  // $100/mo recurring
    name: 'Website Chatbot',
  },
};

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'Stripe is not configured yet. Please contact us at hello@apextoolsai.com.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const tier = body.tier;
  const lang = body.lang === 'es' ? 'es' : 'en';
  const config = TIERS[tier];
  if (!config) {
    return json({ error: 'Invalid tier' }, 400);
  }

  // Build URLs based on language
  const origin = new URL(request.url).origin;
  const success_url = `${origin}/thank-you.html?session_id={CHECKOUT_SESSION_ID}&tier=${tier}&lang=${lang}`;
  const cancel_url = lang === 'es' ? `${origin}/es/#pricing` : `${origin}/#pricing`;

  // Build form body for Stripe API
  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('success_url', success_url);
  params.append('cancel_url', cancel_url);

  // Two line items: one-time setup + recurring monthly
  params.append('line_items[0][price]', config.setup_price);
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[1][price]', config.monthly_price);
  params.append('line_items[1][quantity]', '1');

  // Collect customer info
  params.append('billing_address_collection', 'required');
  params.append('phone_number_collection[enabled]', 'true');
  params.append('customer_creation', 'always');

  // Allow promo codes (you can disable this later by removing this line)
  params.append('allow_promotion_codes', 'true');

  // Metadata for our records
  params.append('metadata[tier]', tier);
  params.append('metadata[language]', lang);
  params.append('metadata[source]', 'website');

  // Subscription metadata too (will appear on the subscription object)
  params.append('subscription_data[metadata][tier]', tier);
  params.append('subscription_data[metadata][source]', 'website');

  // Locale for the checkout page itself
  params.append('locale', lang === 'es' ? 'es' : 'en');

  let stripeResponse;
  try {
    stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch (e) {
    return json({ error: 'Stripe request failed: ' + e.message }, 500);
  }

  const session = await stripeResponse.json();

  if (session.error) {
    return json({ error: session.error.message || 'Stripe error', details: session.error }, 500);
  }

  if (!session.url) {
    return json({ error: 'Stripe returned no checkout URL', session }, 500);
  }

  return json({ url: session.url, sessionId: session.id });
}
