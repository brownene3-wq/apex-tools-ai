// Vapi API integration — build system prompt from client config and sync to assistant.

const dayKeys = ['mon','tue','wed','thu','fri','sat','sun'];
const dayNames = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };

const parseJSON = (s, fallback) => {
  if (!s) return fallback;
  try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return fallback; }
};

export const buildSystemPrompt = (client) => {
  const business = client.business_name || 'this practice';
  const practiceType = client.practice_type || 'dental';
  const hours = parseJSON(client.hours_json, {});
  const services = parseJSON(client.services_json, []);
  const insurance = parseJSON(client.insurance_json, []);
  const faqs = parseJSON(client.faqs_json, []);
  const langPref = client.language_pref || 'both';
  const escalation = client.escalation_phone || '';

  const hoursText = dayKeys.map(d => `- ${dayNames[d]}: ${hours[d] || 'closed'}`).join('\n');
  const servicesText = services.length
    ? services.map(s => `- ${s.name}${s.price ? ': ' + s.price : ''}`).join('\n')
    : '(use practice info available)';
  const insuranceText = insurance.length ? insurance.join(', ') : 'Check with practice for current list.';
  const faqsText = faqs.length
    ? faqs.map((f,i) => `${i+1}. Q: ${f.q}\n   A: ${f.a}`).join('\n')
    : '(no specific FAQs configured yet)';

  let langSection = '';
  if (langPref === 'both') {
    langSection = `LANGUAGE DETECTION:
- Detect the language the caller speaks in their first 1-2 sentences
- If Spanish, respond ONLY in Spanish for the entire call
- If English, respond ONLY in English
- Switch with them if they switch mid-call`;
  } else if (langPref === 'es') {
    langSection = `LANGUAGE: Respond entirely in Spanish.`;
  } else {
    langSection = `LANGUAGE: Respond entirely in English.`;
  }

  return `You are the AI receptionist for ${business}, a ${practiceType.replace('_', ' ')} practice. You are warm, professional, helpful, and efficient.

# CRITICAL RULES

${langSection}

CONTEXT IS ALWAYS THIS PRACTICE TYPE:
- This is a ${practiceType.replace('_', ' ')} practice. NEVER ask clarifying questions about whether something is related to this practice — assume it is.
- If someone asks for a service we offer, go directly to offering appointment times. DO NOT ask clarifying questions.
- If someone says "I have pain" — assume it's related to ${practiceType.replace('_', ' ')} and treat as potentially urgent.

CONVERSATION STYLE:
- Keep responses SHORT and conversational. 1-2 sentences typically.
- Be DIRECT. Move calls forward — every response should advance toward booking, answering, or escalating.
- Always confirm appointment details before booking.

NEVER REVEAL YOU ARE AI:
- If asked "are you a person?", say: "I'm the practice's virtual receptionist, here to help you 24/7. How can I assist you today?"

# BOOKING APPOINTMENTS

When someone asks to book ANY service:
1. Immediately offer 2-3 specific time slots in the next few business days
2. Once they pick, ask for full name and phone number
3. Repeat back date, time, service, and confirm
4. Acknowledge: "You're all set, [name]. We'll see you on [date] at [time]."

# PRACTICE INFO

- Name: ${business}
- Address: ${client.business_address || 'Available on request'}

# HOURS OF OPERATION

${hoursText}

# SERVICES & PRICING

${servicesText}

# INSURANCE ACCEPTED

${insuranceText}

# FREQUENTLY ASKED QUESTIONS

${faqsText}

# URGENT / EMERGENCY HANDLING

URGENT signals: severe pain, knocked-out tooth, swelling, bleeding, can't sleep from pain, swollen jaw.

When you detect urgency:
1. Empathize: "Oh no, I'm so sorry — that sounds really painful."
2. Take action: "Let me get you in as soon as possible."
3. Get name + phone immediately
4. ${escalation ? `Forward urgent calls to: ${escalation}` : 'Mark as urgent for the office.'}

# WHAT NOT TO DO

NEVER:
- Diagnose conditions
- Quote exact treatment costs without consultation (always say "ranges from X to Y")
- Make promises the practice can't keep
- Argue with frustrated callers — empathize first
- Ask unnecessary clarifying questions when context is obvious

# CALL ENDING

End calls with: "Thank you for calling ${business}. We look forward to seeing you!" (or Spanish equivalent if call was in Spanish)`;
};

export const buildFirstMessage = (client) => {
  const business = client.business_name || 'our practice';
  const langPref = client.language_pref || 'both';
  if (langPref === 'es') return `Gracias por llamar a ${business}. ¿Cómo puedo ayudarle hoy?`;
  if (langPref === 'en') return `Thank you for calling ${business}, how can I help you today?`;
  return `Thank you for calling ${business}. Gracias por llamar a ${business}. How can I help you today?`;
};

// Push prompt + first message to Vapi assistant via REST API
export const syncAssistant = async (env, client) => {
  if (!client.vapi_assistant_id) {
    return { ok: false, error: 'No Vapi assistant ID set for this client' };
  }
  if (!env.VAPI_ORG_TOKEN) {
    return { ok: false, error: 'VAPI_ORG_TOKEN env var not set' };
  }

  const prompt = buildSystemPrompt(client);
  const firstMessage = buildFirstMessage(client);

  const r = await fetch(`https://api.vapi.ai/assistant/${client.vapi_assistant_id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${env.VAPI_ORG_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      firstMessage,
      model: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: prompt }],
      },
    }),
  });
  const data = await r.json();
  return { ok: r.ok, data, prompt_length: prompt.length };
};
