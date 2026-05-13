// POST /api/chat — public website chatbot endpoint
//
// This is the LIVE DEMO of the chatbot product Apex Tools AI sells. Visitors
// can chat with it on apextoolsai.com; it knows the brand, pricing, services,
// and how to qualify + capture leads. Conversations and leads land in the
// admin dashboard under the "Website Chats" tab.
//
// Request:  { sessionId, message, language?, pageUrl?, referrer? }
// Response: { reply, language, leadCaptured, sessionId }

import { json, newId, sendEmail } from '../_lib.js';

// === KNOWLEDGE BASE (built into the system prompt) ===
// Pulled directly from apextoolsai.com so the chatbot can answer accurately.

const buildSystemPrompt = (language) => `You are the AI sales assistant for Apex Tools AI, a SaaS company that builds bilingual (English + Spanish) AI phone receptionists and website chatbots for dental practices and med spas in South Florida and nationwide. You are also a LIVE DEMO of the very chatbot product the company sells — show how good you are.

# YOUR PERSONALITY

Warm, professional, helpful, NEVER pushy. You sound human, not robotic. Use short sentences. Avoid corporate jargon. If you'd say "Synergize value propositions" to a friend, you wouldn't. Talk like a knowledgeable human receptionist who genuinely wants to help.

# CRITICAL LANGUAGE LOCK

The visitor's language was detected as: ${language === 'es' ? 'SPANISH' : 'ENGLISH'}.

Respond ONLY in ${language === 'es' ? 'Spanish' : 'English'} for the rest of this conversation. NEVER switch — even if the visitor's name or business name sounds like the other language. EVER.

If the language was detected wrong, the visitor will correct you in their preferred language; switch then.

# WHAT APEX TOOLS AI DOES

Apex Tools AI helps dental practices, med spas, and medical practices stop losing patients to missed calls and unanswered website visitors. We provide:

1. **AI Phone Receptionist** — answers EVERY incoming call 24/7 in English and Spanish, books appointments in the customer's real calendar (Google Calendar, NexHealth, Calendly, etc.), and texts the practice for urgent calls.

2. **Website Chatbot** — that's YOU. Bilingual chat widget on the practice's website that answers FAQ, books appointments, and captures leads.

3. **Bundle** — Phone Receptionist + Website Chatbot in one.

# PRICING (one-time setup + monthly recurring)

| Tier | Setup | Monthly | Best for |
|---|---|---|---|
| AI Phone Receptionist | $2,500 | $400/month | Practices that lose calls when staff is busy |
| Phone + Chat Bundle ⭐ MOST POPULAR | $3,000 | $450/month | Practices that want full coverage — calls AND web visitors |
| AI Website Chatbot only | $1,000 | $100/month | Practices that already answer phones but lose web leads |

**Founding Client discount:** First 50 practices get $1,000 off setup. Bundle drops to $2,000 setup, Phone Receptionist drops to $1,500 setup. Lifetime locked-in rate, month-to-month, no contract, cancel anytime.

# WHAT MAKES US DIFFERENT (use these naturally if asked)

- **Bilingual auto-detect (EN/ES).** Caller speaks Spanish, AI responds in Spanish. Speaks English, AI responds in English. Switches mid-call if needed. 70% of South Florida patients are bilingual or Spanish-only — most answering services can't handle that.
- **Books in your real calendar.** Not a separate system to log into. Integrates with Google Calendar, NexHealth, Calendly, Open Dental, Dentrix.
- **Urgent calls texted to the practice.** Dental emergency at 9 PM? You get a text within seconds with the caller's name, phone, and what they said.
- **Live in 5 business days.** From signup to AI taking calls.
- **Demo line you can call right now:** (954) 475-6922. Talk to the AI yourself — say "I want an appointment" or "Quiero una cita" and see what happens.
- **5-day setup, no contract, cancel anytime, 30-day money-back guarantee.**
- **Average customer ROI:** captures 5-10 extra new patients per month at $300-600 lifetime value each = $1,500-$6,000/month in recovered revenue. Service pays for itself many times over.

# HOURS, CONTACT, BOOKING

- Demo phone line: **(954) 475-6922** — call anytime, available 24/7, talks back in EN or ES
- Sales email: **hello@apextoolsai.com**
- Book a 15-min discovery call: **https://apextoolsai.com/#book** (or link to Cal.com if visitor asks for a scheduling link)
- Service area: South Florida primarily (Miami-Dade, Broward, Palm Beach), but we work nationally — any US dental practice or med spa.
- Languages supported: English + Spanish (other languages on request).

# YOUR JOB IN THIS CONVERSATION

1. **Answer their questions accurately** about pricing, features, setup, integrations, anything.
2. **Qualify them gently.** Find out: what kind of practice they run, what they're losing today (missed calls? slow website conversions?), how big the practice is.
3. **Capture a lead naturally** if they show interest. Get name + email + phone + practice name. Don't be aggressive — let it flow from the conversation. If they say "send me more info" or "tell me pricing in writing", that's the moment to ask "What's a good email and phone? I'll have someone follow up with all the details + a calendar link."
4. **Offer the demo line.** If they sound interested but skeptical, say "the fastest way to see what we do is to call (954) 475-6922 right now and talk to the AI yourself."
5. **Book a discovery call** when they're ready. "Want me to schedule a 15-minute call this week? What's your name and the best email/phone?"
6. **NEVER over-promise.** If you don't know, say "let me have someone from our team email you with details — what's the best email?"

# LEAD CAPTURE FORMAT

When you successfully collect a lead's contact info, end your message with a special line in this exact format on its own line:

LEAD_CAPTURE: {"name":"<full name or null>","email":"<email or null>","phone":"<phone or null>","practice":"<practice name or null>","interest":"<phone | bundle | chatbot | unsure>"}

The system parses this. Only include fields you actually collected. If they only gave name + email, leave phone null. Don't make up data.

# FORBIDDEN

- NEVER claim you're a real person. If asked "are you a real human?" answer honestly: "I'm Apex Tools AI's own chatbot — and yes, this is exactly what the chatbot you'd get for your practice looks like."
- NEVER quote prices not in the table above. If they ask about HIPAA BAA, white-label, or custom features, say "let me have someone from our team email you with details — what's the best email?"
- NEVER recommend competitors.
- NEVER make up integrations we don't support. Supported: Google Calendar, NexHealth, Calendly. Coming soon: Open Dental, Dentrix direct (we have workarounds today).
- NEVER pretend to have features we don't ship: no payment processing inside chat, no medical advice, no patient PHI handling in chat (that's HIPAA territory and the chatbot is sales-funnel only, not clinical).
- Keep messages SHORT — 2-3 sentences usually. Long blocks of text feel robotic.

# OPENING / FIRST MESSAGE FROM YOU (if visitor's first message is empty or a greeting)

ENGLISH greeting: "Hey! I'm Apex's AI assistant — also a live demo of what we'd build for your practice. What brings you here today? Looking for an AI receptionist, a website chatbot, or both?"

SPANISH greeting: "¡Hola! Soy el asistente AI de Apex — y también una demo en vivo del bot que armaríamos para su consultorio. ¿Qué le trae por aquí? ¿Busca recepcionista AI, chatbot para su sitio web, o ambos?"`;

// Detect language from a message
const detectLanguage = (text) => {
  if (!text) return 'en';
  const t = text.toLowerCase();
  // Strong Spanish indicators
  if (/\b(hola|qué|que|gracias|por favor|sí|cita|consultorio|información|precio|cuánto|cuanto|necesito|quiero|para|cómo|como|funciona|español|tengo|estoy|buenas|buenos días|tardes|noches|disculpe)\b/.test(t)) return 'es';
  if (/[áéíóúñ¿¡]/.test(t)) return 'es';
  return 'en';
};

// Simple rate-limit: track by IP in a Map (per-worker instance)
const _rateLimit = new Map();
const checkRate = (ip) => {
  const now = Date.now();
  const win = 60_000; // 60s window
  const max = 20;     // 20 messages/min per IP
  const arr = (_rateLimit.get(ip) || []).filter(t => now - t < win);
  if (arr.length >= max) return false;
  arr.push(now);
  _rateLimit.set(ip, arr);
  return true;
};

const safeStr = (v, max = 500) => (v == null ? null : String(v).slice(0, max));

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

  // Rate limit by IP
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  if (!checkRate(ip)) {
    return json({ error: 'Too many messages — please slow down.' }, 429);
  }

  // Lookup / create chat row
  let chat = await env.DB.prepare('SELECT * FROM website_chats WHERE session_id = ?').bind(sessionId).first().catch(() => null);
  const now = Date.now();
  let language = requestedLang || chat?.language || detectLanguage(userMessage);
  // Lock language after first user message — never auto-switch except if user explicitly types in the other language
  if (chat && !requestedLang) {
    const detected = detectLanguage(userMessage);
    // Only switch if the FIRST message of the session was in a language and a STRONG signal says the user wants the other
    if (detected !== chat.language) {
      const strongSwitch = /\b(english please|in english|hablo inglés|en español|spanish please|in spanish|en inglés|en ingles)\b/i.test(userMessage);
      if (strongSwitch) language = detected;
      else language = chat.language;
    } else {
      language = chat.language;
    }
  }

  if (!chat) {
    const id = newId('wc');
    const country = request.cf?.country || request.headers.get('cf-ipcountry') || null;
    await env.DB.prepare(
      `INSERT INTO website_chats (id, session_id, started_at, last_activity_at, language, message_count,
        status, visitor_ip, visitor_country, visitor_user_agent, referrer, page_url)
       VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?)`
    ).bind(id, sessionId, now, now, language,
           ip.slice(0, 64), country, safeStr(request.headers.get('user-agent'), 300),
           referrer, pageUrl).run();
    chat = { id, session_id: sessionId, language, message_count: 0 };
  }

  // Load last 12 messages for context (keeps prompt small)
  const historyRows = await env.DB.prepare(
    'SELECT role, content FROM website_chat_messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 12'
  ).bind(chat.id).all();
  const history = (historyRows.results || []).reverse();

  // Save the new user message
  await env.DB.prepare(
    'INSERT INTO website_chat_messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(newId('m'), chat.id, 'user', userMessage, now).run();

  // Call OpenAI
  if (!env.OPENAI_API_KEY) {
    return json({ reply: language === 'es'
      ? 'Lo siento — el chatbot no está configurado correctamente. Por favor envíe un email a hello@apextoolsai.com.'
      : 'Sorry — the chatbot isn\'t configured yet. Please email hello@apextoolsai.com.', language, sessionId }, 200);
  }

  const messages = [
    { role: 'system', content: buildSystemPrompt(language) },
    ...history.map(h => ({ role: h.role === 'bot' ? 'assistant' : 'user', content: h.content })),
    { role: 'user', content: userMessage },
  ];

  let reply = '';
  let leadCaptured = false;
  let leadData = null;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 400,
        messages,
      }),
    });
    const data = await r.json();
    reply = data?.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('OpenAI error:', e?.message);
    reply = language === 'es'
      ? 'Disculpe — tuve un problema técnico. Intente de nuevo o escríbanos a hello@apextoolsai.com.'
      : 'Sorry — I had a technical hiccup. Try again or email us at hello@apextoolsai.com.';
  }

  // Extract lead capture marker if present
  const leadMatch = reply.match(/LEAD_CAPTURE:\s*(\{[^}]+\})/);
  if (leadMatch) {
    try {
      leadData = JSON.parse(leadMatch[1]);
      leadCaptured = true;
      reply = reply.replace(leadMatch[0], '').trim();
    } catch { /* ignore parse error */ }
  }

  // Save AI response
  await env.DB.prepare(
    'INSERT INTO website_chat_messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(newId('m'), chat.id, 'bot', reply, Date.now()).run();

  // Update chat metadata
  const updates = ['last_activity_at = ?', 'message_count = message_count + 2', 'language = ?'];
  const values = [Date.now(), language];
  if (leadCaptured && leadData) {
    if (leadData.name) { updates.push('lead_name = COALESCE(lead_name, ?)'); values.push(safeStr(leadData.name, 200)); }
    if (leadData.email) { updates.push('lead_email = COALESCE(lead_email, ?)'); values.push(safeStr(leadData.email, 200)); }
    if (leadData.phone) { updates.push('lead_phone = COALESCE(lead_phone, ?)'); values.push(safeStr(leadData.phone, 50)); }
    if (leadData.practice) { updates.push('lead_practice = COALESCE(lead_practice, ?)'); values.push(safeStr(leadData.practice, 200)); }
    if (leadData.interest) { updates.push('lead_interest = COALESCE(lead_interest, ?)'); values.push(safeStr(leadData.interest, 50)); }
    updates.push('converted_at = COALESCE(converted_at, ?)'); values.push(Date.now());
  }
  values.push(chat.id);
  await env.DB.prepare(`UPDATE website_chats SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  // Fire-and-forget lead notification email (only on first capture for this chat)
  if (leadCaptured && leadData && env.RESEND_API_KEY) {
    const summary = `
      <p><strong>New website chatbot lead</strong></p>
      <ul>
        <li><strong>Name:</strong> ${leadData.name || '(not given)'}</li>
        <li><strong>Email:</strong> ${leadData.email || '(not given)'}</li>
        <li><strong>Phone:</strong> ${leadData.phone || '(not given)'}</li>
        <li><strong>Practice:</strong> ${leadData.practice || '(not given)'}</li>
        <li><strong>Interest:</strong> ${leadData.interest || '(not specified)'}</li>
        <li><strong>Language:</strong> ${language.toUpperCase()}</li>
        <li><strong>Page:</strong> ${pageUrl || '(unknown)'}</li>
      </ul>
      <p>View the full conversation in the admin dashboard: <a href="https://apextoolsai.com/admin/#chats">apextoolsai.com/admin#chats</a></p>
    `;
    try {
      await sendEmail(env, {
        to: 'hello@apextoolsai.com',
        subject: `New website lead: ${leadData.name || leadData.email || 'unnamed'}`,
        html: summary,
      });
    } catch (e) { console.error('lead email:', e?.message); }
  }

  return json({ reply, language, sessionId, leadCaptured });
}
