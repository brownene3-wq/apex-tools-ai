// POST /api/chat — public website chatbot for apextoolsai.com
import { json, newId, sendEmail } from '../_lib.js';

const buildSystemPrompt = (language, ctx) => {
  const nowET = new Date(Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York' });
  return `You are Apex AI — the sales concierge AND live demo for Apex Tools AI, a SaaS that builds bilingual (English+Spanish) AI phone receptionists and website chatbots for dental practices and med spas. The visitor is shopping for this product. Job: educate, qualify, capture the lead.

Current time (ET): ${nowET}.
Detected language: ${language === 'es' ? 'SPANISH' : 'ENGLISH'}. Respond ONLY in ${language === 'es' ? 'Spanish' : 'English'}.

# HARD RULES
1. 2-4 sentences max per reply. Never longer. People scan.
2. No markdown headers (# or ##) in visible text. Plain prose only.
3. Always quote exact prices: Phone $995 setup + $400/mo. Bundle $995 setup + $450/mo. Chatbot-only $299 setup + $100/mo. Founding Client: $500 off setup (first 50).
4. Always quote real ROI math when price comes up: patient lifetime value $300-$600, AI captures 5-10 missed calls/month = $1,500-$6,000/month recovered.
5. Never claim to be human. If asked: "I'm Apex's AI chatbot — exactly what we'd build for your practice."
6. End every reply with markers (see MARKERS section).

# WHAT APEX TOOLS AI DOES

Bilingual AI receptionist for dental practices, med spas, medical, chiropractic. Three products:

AI Phone Receptionist — $995 setup + $400/month. Answers every incoming call 24/7 in EN+ES, books appointments in Google Calendar / NexHealth / Calendly (workarounds for Open Dental, Dentrix, Eaglesoft), texts the practice owner for urgent calls.

Phone + Chat Bundle — $995 setup + $450/month. MOST POPULAR. Phone Receptionist + website chatbot (you're using it now).

AI Website Chatbot only — $299 setup + $100/month. Bilingual chat widget for the practice site.

Founding Client special: First 50 practices get $500 off setup. Lifetime locked monthly rate. Month-to-month, no contract, 30-day money-back guarantee.

# WHY US
- Bilingual EN/ES auto-detect — 70% of South Florida patients are bilingual or Spanish-only.
- Books in your real calendar (Google Calendar, NexHealth, Calendly).
- Urgent calls trigger SMS to practice owner in real time.
- Live in 5 business days.
- 30-day money-back guarantee.
- Demo line: (954) 475-6922 — free, 24/7, EN or ES.
- Book a walkthrough: https://cal.com/apextoolsai/discovery

# DISCOVERY (FIRST 2-3 TURNS)
Learn: practice type, size, call volume, language mix, role (owner/manager/staff). Weave into conversation. Emit QUAL: {} when you have a slice.

# OBJECTIONS — NEAR-VERBATIM

"Too expensive" / cheaper competitor: "Quick math: one new patient is worth $300-$600 lifetime. Our AI captures 5-10 missed calls a month — that's $1,500-$6,000/month in recovered revenue. The $400 fee is paid back the moment ONE patient books. Most answering services just take a message; ours books the appointment live, in your calendar, while the caller is still on the phone."

"I already have a receptionist": "She's probably amazing. But does she work 24/7? Catch 8pm Friday calls? Handle 3 calls at once? Speak Spanish to your 70% Spanish-speaking patients? Apex is the safety net for everything she can't catch."

"Don't trust AI": "Fair concern. Easiest answer: call (954) 475-6922 right now and talk to it yourself — 60 seconds. If you'd be embarrassed to put it on your line, don't sign up. 30-day money-back guarantee either way."

"HIPAA?": "The AI handles scheduling and lead capture — names, phones, appointment times — not protected health info like diagnoses or treatment notes. PHI never enters the chat or call flow. If you need a signed BAA for fully-clinical interactions, our team handles that case-by-case. Want me to have someone email you the details?"

"What if it makes a mistake?": "Three safety nets. One — every call is recorded and transcribed; you see everything in your dashboard. Two — urgent callers trigger an instant SMS to your phone so you can call them back within minutes. Three — 30-day money-back guarantee."

"Integration with [PMS]?": "Direct integrations: Google Calendar, NexHealth, Calendly. Open Dental / Dentrix / Eaglesoft we connect through NexHealth or via calendar sync. We can walk through your specific setup on a 15-min call."

"How long is setup?": "Five business days. You fill out one short form, we build and test, you approve. We give you a temporary number for the first week so you can A/B test before porting your real one."

"Send me info": "Happy to. What's the best email and phone? I'll have someone follow up with pricing, integrations, ROI math, and a calendar link for a 15-min walkthrough. While I have you — what kind of practice and roughly how many calls a day?"

# MARKERS (end of every reply)

SUGGEST: ["chip1", "chip2", "chip3"] — REQUIRED on every reply. 2-3 short chips (max 5 words each).
CTA: "call_demo" | "book" | "pricing" — when a button helps.
LEAD_CAPTURE: {"name":"...","email":"...","phone":"...","practice":"...","interest":"phone|bundle|chatbot|unsure"} — when contact info collected.
QUAL: {"practice_type":"dental|medspa|medical","practice_size":"...","call_volume":"...","languages":"en|es|both","decision_maker":"owner|manager|staff","urgency":"now|soon|exploring"} — when practice details learned.

# FEW-SHOT EXAMPLES

A — Visitor: "How much?"
Reply: "Phone Receptionist is $995 setup plus $400/month. Bundle (phone + website chatbot) is $995 setup plus $450/month. Chatbot-only is $299 setup plus $100/month. Founding Client (first 50 practices) gets $500 off setup. Want the full breakdown?"
CTA: "pricing"
SUGGEST: ["What's the Founding deal?", "What's included?", "Book a 15-min call"]

B — Visitor: "Dental office in Hollywood, 30 calls/day"
Reply: "Hollywood is our backyard. With 30 calls a day, most practices we work with lose 8-12 of those — that's $2,400-$7,200/month in missed new-patient revenue. Quick question: are most of your patients English-speaking, Spanish, or both?"
QUAL: {"practice_type":"dental","call_volume":"medium 20-50","urgency":"exploring"}
SUGGEST: ["Both languages", "Mostly Spanish", "Mostly English"]

C — Visitor: "Too expensive, my service is $150/mo"
Reply: "Fair pushback. Quick math: one new patient is worth $300-$600 lifetime. If our AI captures 5-10 missed calls a month, that's $1,500-$6,000/month in recovered revenue. Your answering service takes messages; ours books the appointment live in your calendar. The fee is paid back by ONE booking."
CTA: "call_demo"
SUGGEST: ["Try the demo", "Show me the ROI", "Book a 15-min call"]

D — Visitor: "owner@hollywood.com, 305-555-1234, Albert"
Reply: "Awesome, Albert. Someone will reach out today with pricing, integrations, and a calendar link for a 15-min walkthrough. While I have you — about how many calls a day and what's your current scheduling system?"
LEAD_CAPTURE: {"name":"Albert","email":"owner@hollywood.com","phone":"3055551234","interest":"unsure"}
CTA: "book"
SUGGEST: ["About 30 calls/day", "We use Google Calendar", "Book the call now"]

# OPENING (if first message is a greeting)
EN: "Hey 👋 I'm Apex's AI assistant — and a live demo of the bilingual chatbot we'd build for your practice. What kind of practice are you running?"
ES: "¡Hola! 👋 Soy el asistente AI de Apex — una demo en vivo del chatbot bilingüe que armaríamos para su consultorio. ¿Qué tipo de consultorio tiene?"

# FORBIDDEN
- No competitors (Smile.io, Modento, RingCentral).
- No invented integrations.
- No prices outside the table.
- No long replies. 2-4 sentences max.
- No markdown headers in visible text.

Context: ${ctx.messageCount > 0 ? `Turn ${(ctx.messageCount/2)+1} of an ongoing conversation. Use prior context.` : 'First user message. Open warmly and start discovery.'}`;
};

const detectLanguage = (text) => {
  if (!text) return 'en';
  const t = text.toLowerCase();
  if (/\b(hola|qué|que|gracias|por favor|sí|cita|consultorio|información|precio|cuánto|cuanto|necesito|quiero|para|cómo|como|funciona|español|tengo|estoy|buenas|disculpe|cuándo|dónde|ayuda)\b/.test(t)) return 'es';
  if (/[áéíóúñ¿¡]/.test(t)) return 'es';
  return 'en';
};

const _rateLimit = new Map();
const checkRate = (ip) => {
  const now = Date.now();
  const arr = (_rateLimit.get(ip) || []).filter(t => now - t < 60000);
  if (arr.length >= 20) return false;
  arr.push(now);
  _rateLimit.set(ip, arr);
  return true;
};

const safeStr = (v, max = 500) => (v == null ? null : String(v).slice(0, max));

const inferMarkers = (reply, userMessage, lang) => {
  const lower = (reply || '').toLowerCase();
  const userLower = (userMessage || '').toLowerCase();
  const combined = lower + ' ' + userLower;
  const T = lang === 'es' ? {
    pricing: ['Ver precios completos', 'Llamar la demo', 'Agendar llamada de 15 min'],
    objection: ['Llamar la demo ahora', 'Ver ROI completo', 'Agendar llamada'],
    demo: ['Llamar (954) 475-6922', 'Agendar llamada de 15 min', 'Ver precios'],
    book: ['Sí, agéndame', 'Llamar la demo primero', 'Mandar email'],
    discovery_size: ['1-3 sillas', '4-8 sillas', '9+ sillas'],
    discovery_lang: ['Inglés y español', 'Solo inglés', 'Solo español'],
    integrations: ['Usamos Google Calendar', 'Usamos NexHealth', 'Usamos Open Dental'],
    hipaa: ['Solo necesito agendar', 'Mandar email', 'Agendar llamada'],
    generic: ['Ver precios', 'Llamar la demo', 'Agendar llamada de 15 min'],
  } : {
    pricing: ['See full pricing', 'Call the demo line', 'Book a 15-min call'],
    objection: ['Call the demo right now', 'Show me the ROI math', 'Book a 15-min call'],
    demo: ['Call (954) 475-6922', 'Book a 15-min call', 'See pricing'],
    book: ['Yes, book me', 'Try the demo first', 'Email me'],
    discovery_size: ['1-3 chairs', '4-8 chairs', '9+ chairs'],
    discovery_lang: ['English and Spanish', 'English only', 'Spanish only'],
    integrations: ['We use Google Calendar', 'We use NexHealth', 'We use Open Dental'],
    hipaa: ['I just need scheduling', 'Email me details', 'Book a call'],
    generic: ['See pricing', 'Call the demo', 'Book a 15-min call'],
  };
  let suggest = null, cta = null;
  if (/hipaa|baa|protected health|phi|compliance/i.test(combined)) { suggest = T.hipaa; cta = 'book'; }
  else if (/expensive|too much|too high|cheaper|150\/month|answering service|150 a month|recovered revenue|\broi\b|return on/i.test(combined)) { suggest = T.objection; cta = 'call_demo'; }
  else if (/954.*475.*6922|demo line|try the demo|live demo|llamar.*demo/i.test(lower)) { suggest = T.demo; cta = 'call_demo'; }
  else if (/15.?min|cal\.com|book a call|schedule a call|discovery call|walkthrough/i.test(lower)) { suggest = T.book; cta = 'book'; }
  else if (/\$\d|setup|monthly|pricing|cost|tier|bundle|founding/i.test(lower)) { suggest = T.pricing; cta = 'pricing'; }
  else if (/how many|practice size|chairs|operatories|sillas|cuánt/i.test(lower)) { suggest = T.discovery_size; }
  else if (/spanish.speaking|english.speaking|bilingual|language|patient.*speak|hispanohablantes|idioma|patient mix/i.test(lower)) { suggest = T.discovery_lang; }
  else if (/integration|calendar|nexhealth|open dental|dentrix|eaglesoft|google cal|\bpms\b|scheduling system/i.test(lower)) { suggest = T.integrations; }
  return { suggest: suggest || T.generic, cta };
};

const parseMarkers = (text) => {
  const markers = { leadCapture: null, qual: null, suggest: null, cta: null };
  let clean = text;
  const leadM = clean.match(/LEAD_CAPTURE:\s*(\{[^}]+\})/);
  if (leadM) { try { markers.leadCapture = JSON.parse(leadM[1]); } catch {} clean = clean.replace(leadM[0], ''); }
  const qualM = clean.match(/QUAL:\s*(\{[^}]+\})/);
  if (qualM) { try { markers.qual = JSON.parse(qualM[1]); } catch {} clean = clean.replace(qualM[0], ''); }
  const sugM = clean.match(/SUGGEST:\s*(\[[^\]]+\])/);
  if (sugM) {
    try {
      const arr = JSON.parse(sugM[1]);
      if (Array.isArray(arr)) markers.suggest = arr.slice(0, 3).map(s => String(s).slice(0, 60));
    } catch {}
    clean = clean.replace(sugM[0], '');
  }
  const ctaM = clean.match(/CTA:\s*"?(call_demo|book|pricing)"?/);
  if (ctaM) { markers.cta = ctaM[1]; clean = clean.replace(ctaM[0], ''); }
  return { reply: clean.trim(), markers };
};

const scoreLeadHeat = (chat, markers) => {
  let score = 0;
  const lead = markers.leadCapture;
  if (lead?.email && lead?.phone) score += 4;
  else if (lead?.email || lead?.phone) score += 2;
  if (lead?.practice) score += 1;
  if (lead?.interest && lead.interest !== 'unsure') score += 1;
  const qual = markers.qual;
  if (qual?.decision_maker === 'owner') score += 2;
  if (qual?.decision_maker === 'manager') score += 1;
  if (qual?.urgency === 'now') score += 3;
  if (qual?.urgency === 'soon') score += 1;
  if (qual?.call_volume === 'high 50+' || qual?.call_volume === 'medium 20-50') score += 1;
  if (qual?.languages === 'both' || qual?.languages === 'es') score += 1;
  if (chat.message_count >= 6) score += 1;
  if (score >= 7) return 'hot';
  if (score >= 3) return 'warm';
  return 'cold';
};

const sendHotLeadSms = async (env, leadData) => {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) return;
  let toPhone = env.HOT_LEAD_PHONE;
  if (!toPhone) {
    try {
      const admin = await env.DB.prepare("SELECT escalation_phone FROM clients WHERE is_admin = 1 AND escalation_phone IS NOT NULL LIMIT 1").first();
      toPhone = admin?.escalation_phone;
    } catch {}
  }
  if (!toPhone) return;
  const body = `🔥 HOT chatbot lead: ${leadData.name || '(no name)'} from ${leadData.practice || '(unknown)'} — ${leadData.email || ''} ${leadData.phone || ''}. Interest: ${leadData.interest || 'unsure'}.`;
  try {
    const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: toPhone, From: env.TWILIO_FROM_NUMBER, Body: body.slice(0, 1500) }).toString(),
    });
  } catch (e) { console.error('hot lead SMS:', e?.message); }
};

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const sessionId = safeStr(body.sessionId, 64) || newId('cs');
  const userMessage = safeStr(body.message, 2000);
  const requestedLang = body.language === 'es' || body.language === 'en' ? body.language : null;
  const pageUrl = safeStr(body.pageUrl, 500);
  const referrer = safeStr(body.referrer, 500);

  if (!userMessage || userMessage.trim().length === 0) {
    return json({ error: 'message required' }, 400);
  }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  if (!checkRate(ip)) {
    return json({ error: 'Too many messages — please slow down.' }, 429);
  }

  let chat = await env.DB.prepare('SELECT * FROM website_chats WHERE session_id = ?').bind(sessionId).first().catch(() => null);
  const now = Date.now();
  let language = requestedLang || chat?.language || detectLanguage(userMessage);
  if (chat && !requestedLang) {
    const detected = detectLanguage(userMessage);
    if (detected !== chat.language) {
      const strongSwitch = /\b(english please|in english|hablo inglés|en español|spanish please|in spanish|en inglés|en ingles)\b/i.test(userMessage);
      language = strongSwitch ? detected : chat.language;
    } else {
      language = chat.language;
    }
  }

  if (!chat) {
    const id = newId('wc');
    const country = request.cf?.country || request.headers.get('cf-ipcountry') || null;
    await env.DB.prepare(
      `INSERT INTO website_chats (id, session_id, started_at, last_activity_at, language, message_count, status, visitor_ip, visitor_country, visitor_user_agent, referrer, page_url)
       VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?)`
    ).bind(id, sessionId, now, now, language, ip.slice(0, 64), country, safeStr(request.headers.get('user-agent'), 300), referrer, pageUrl).run();
    chat = { id, session_id: sessionId, language, message_count: 0 };
  }

  const historyRows = await env.DB.prepare(
    'SELECT role, content FROM website_chat_messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 16'
  ).bind(chat.id).all();
  const history = (historyRows.results || []).reverse();

  await env.DB.prepare(
    'INSERT INTO website_chat_messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(newId('m'), chat.id, 'user', userMessage, now).run();

  if (!env.OPENAI_API_KEY) {
    return json({
      reply: language === 'es' ? 'Lo siento — el chatbot no está configurado correctamente.' : "Sorry — the chatbot isn't configured yet.",
      language, sessionId, suggest: null, cta: null,
    }, 200);
  }

  const ctx = { messageCount: chat.message_count || 0 };
  const messages = [
    { role: 'system', content: buildSystemPrompt(language, ctx) },
    ...history.map(h => ({ role: h.role === 'bot' ? 'assistant' : 'user', content: h.content })),
    { role: 'user', content: userMessage },
  ];

  let rawReply = '';
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.5, max_tokens: 500, messages }),
    });
    const data = await r.json();
    rawReply = data?.choices?.[0]?.message?.content || '';
  } catch (e) {
    rawReply = language === 'es' ? 'Disculpe — tuve un problema técnico. Intente de nuevo.' : 'Sorry — I had a hiccup. Try again.';
  }

  const { reply, markers } = parseMarkers(rawReply);

  if (!markers.suggest || markers.suggest.length === 0) {
    const inferred = inferMarkers(reply, userMessage, language);
    markers.suggest = inferred.suggest;
    if (!markers.cta) markers.cta = inferred.cta;
  } else if (!markers.cta) {
    const inferred = inferMarkers(reply, userMessage, language);
    markers.cta = inferred.cta;
  }

  await env.DB.prepare(
    'INSERT INTO website_chat_messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(newId('m'), chat.id, 'bot', reply, Date.now()).run();

  const updates = ['last_activity_at = ?', 'message_count = message_count + 2', 'language = ?'];
  const values = [Date.now(), language];
  const lead = markers.leadCapture;
  if (lead) {
    if (lead.name) { updates.push('lead_name = COALESCE(lead_name, ?)'); values.push(safeStr(lead.name, 200)); }
    if (lead.email) { updates.push('lead_email = COALESCE(lead_email, ?)'); values.push(safeStr(lead.email, 200)); }
    if (lead.phone) { updates.push('lead_phone = COALESCE(lead_phone, ?)'); values.push(safeStr(lead.phone, 50)); }
    if (lead.practice) { updates.push('lead_practice = COALESCE(lead_practice, ?)'); values.push(safeStr(lead.practice, 200)); }
    if (lead.interest) { updates.push('lead_interest = COALESCE(lead_interest, ?)'); values.push(safeStr(lead.interest, 50)); }
    updates.push('converted_at = COALESCE(converted_at, ?)'); values.push(Date.now());
  }
  if (markers.qual) {
    const prev = chat.notes ? (() => { try { return JSON.parse(chat.notes); } catch { return {}; } })() : {};
    const merged = { ...prev, ...markers.qual };
    updates.push('notes = ?'); values.push(JSON.stringify(merged).slice(0, 2000));
  }
  values.push(chat.id);
  await env.DB.prepare(`UPDATE website_chats SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const wasNewLead = lead && (lead.email || lead.phone) && !chat.lead_email && !chat.lead_phone;
  if (wasNewLead) {
    const refreshed = await env.DB.prepare('SELECT * FROM website_chats WHERE id = ?').bind(chat.id).first();
    const heat = scoreLeadHeat({ ...refreshed, message_count: (chat.message_count || 0) + 2 }, markers);
    if (heat === 'hot') await sendHotLeadSms(env, lead);
    if (env.RESEND_API_KEY) {
      const transcriptHtml = [...history, { role: 'user', content: userMessage }, { role: 'bot', content: reply }]
        .map(m => `<div style="margin:6px 0;"><strong style="color:${m.role === 'user' ? '#ea580c' : '#0a1628'};">${m.role === 'user' ? 'Visitor' : 'AI'}:</strong> ${(m.content || '').replace(/</g, '&lt;')}</div>`)
        .join('');
      const heatBadge = { hot: '#dc2626', warm: '#f59e0b', cold: '#64748b' }[heat] || '#64748b';
      const html = `<div style="font-family:Inter,system-ui,sans-serif;max-width:600px;">
        <h2>${heat === 'hot' ? '🔥 ' : ''}New website chatbot lead <span style="background:${heatBadge};color:white;padding:2px 8px;border-radius:8px;font-size:11px;text-transform:uppercase;">${heat}</span></h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <tr><td style="padding:4px 8px;color:#64748b;">Name</td><td style="padding:4px 8px;">${lead.name || '(not given)'}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b;">Email</td><td style="padding:4px 8px;">${lead.email || '(not given)'}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b;">Phone</td><td style="padding:4px 8px;">${lead.phone || '(not given)'}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b;">Practice</td><td style="padding:4px 8px;">${lead.practice || '(not given)'}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b;">Interest</td><td style="padding:4px 8px;">${lead.interest || '(unsure)'}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b;">Language</td><td style="padding:4px 8px;">${language.toUpperCase()}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b;">Page</td><td style="padding:4px 8px;">${pageUrl || '(unknown)'}</td></tr>
        </table>
        <h3>Conversation</h3>
        <div style="background:#f8fafc;padding:12px;border-radius:8px;font-size:13px;line-height:1.5;">${transcriptHtml}</div>
        <p><a href="https://apextoolsai.com/admin/#chats" style="background:#ea580c;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">View in dashboard →</a></p>
      </div>`;
      try {
        await sendEmail(env, {
          to: 'hello@apextoolsai.com',
          subject: `${heat === 'hot' ? '🔥 HOT' : 'New'} website lead: ${lead.name || lead.email || lead.phone}`,
          html,
        });
      } catch (e) { console.error('lead email:', e?.message); }
    }
  }

  return json({
    reply, language, sessionId,
    leadCaptured: !!lead,
    suggest: markers.suggest || null,
    cta: markers.cta || null,
  });
}
      